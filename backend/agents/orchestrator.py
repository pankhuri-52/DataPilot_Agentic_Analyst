"""
Orchestrator Agent – the dynamic "brain" of the DataPilot pipeline.

Instead of hardcoded routing functions, this LLM-powered node receives the full
pipeline state after every agent run and decides in real-time which agent to call
next. This makes the system a genuinely autonomous multi-agent architecture where
routing authority lives with the LLM, not with static Python conditionals.
"""
import os

from pydantic import BaseModel, Field

from agents.state import DataPilotState, TraceEntry
from agents.trace_stream import append_trace
from llm import get_gemini, invoke_with_retry
from langfuse_setup import get_prompt
from langfuse import get_client as _get_langfuse_client


class OrchestratorDecision(BaseModel):
    next: str = Field(
        description=(
            "The name of the agent to call next. Must be one of: "
            "query_kb, planner, discovery, optimizer_prepare, optimizer_gate, "
            "executor, validator, visualization, END"
        )
    )
    reasoning: str = Field(
        description="1-2 sentences explaining why this agent was chosen based on the current pipeline state."
    )


_AVAILABLE_AGENTS = {
    "query_kb": (
        "Check the knowledge base for a cached similar query. "
        "If a cache hit is found with existing SQL, the pipeline can skip planning entirely."
    ),
    "planner": (
        "Parse the user's question, extract analytical intent (metrics, dimensions, filters), "
        "and validate whether it can be answered. Returns is_valid=true/false."
    ),
    "discovery": (
        "Validate the analysis plan against the database schema. "
        "Determines data feasibility: 'full' (all data available), 'partial' (some missing), or 'none' (cannot answer)."
    ),
    "optimizer_prepare": (
        "Generate SQL from the analysis plan, validate it against the schema, "
        "and estimate query cost. Populates pending_execute_sql for user review."
    ),
    "optimizer_gate": (
        "Present the generated SQL and cost estimate to the user for approval before execution. "
        "This is the human-in-the-loop safety checkpoint — always required after optimizer_prepare."
    ),
    "executor": (
        "Execute the approved SQL query against the database and return raw results."
    ),
    "validator": (
        "Check whether the query results are relevant and actually answer the user's original question. "
        "Runs an LLM relevance check on the returned data."
    ),
    "visualization": (
        "Generate a chart specification and natural language explanation summarizing the results. "
        "This is the final agent before the pipeline completes."
    ),
    "END": (
        "Terminate the pipeline. Use when the pipeline has successfully completed (visualization done), "
        "or when it cannot continue (invalid query, infeasible data, user cancelled)."
    ),
}

_ORCHESTRATOR_PROMPT = """You are the orchestrator of an autonomous data analytics pipeline called DataPilot.
Your sole responsibility is to decide which agent to activate next, based on the current state of the pipeline.

## Available Agents
{agents_description}

## Current Pipeline State
User query: "{query}"

Agents already executed (in order): {agents_run}

State snapshot:
- KB cache hit (SQL ready to reuse): {from_cache}
- Analysis plan valid: {plan_valid}
- Data feasibility: {data_feasibility}
- SQL generated (pending approval): {has_pending_sql}
- SQL approved by user: {sql_approved}
- User declined SQL (regenerate hint set): {has_regenerate_hint}
- Query executed, raw results available: {has_results}
- Results passed validation: {validation_ok}
- Final explanation generated: {has_explanation}
- Execution error (SQL failed): {execution_error}
- SQL retry attempts used: {executor_retry_count}/2
- Relevance retry hint set: {has_relevance_hint}
- Relevance retry attempts used: {validator_retry_count}/1

## Decision Guidelines
Reason through the state carefully and choose the most logical next step:
1. If no agents have run yet, start with query_kb to check for cached results.
2. After query_kb: if KB cache hit is true, jump to executor; otherwise go to planner.
3. After planner: if plan is valid, proceed to discovery; if invalid, terminate with END.
4. After discovery: if feasibility is "full" or "partial", proceed to optimizer_prepare; if "none", terminate with END.
5. After optimizer_prepare: always route to optimizer_gate — SQL must be approved before execution.
6. After optimizer_gate: if SQL is approved (sql_approved=true), proceed to executor; if user declined and regenerate hint is set, go back to optimizer_prepare; otherwise END.
7. After executor: if results are available, proceed to validator; if SQL failed and retries remain (retry count < 2), go back to optimizer_prepare for self-correction; if retries exhausted, END.
8. After validator: if validation passed OR relevance retries are exhausted (retry count >= 1), proceed to visualization; if validation failed and hint is set and retries remain, go back to optimizer_prepare.
9. After visualization: always output END — the pipeline is complete.

Output your decision as JSON with "next" (agent name or "END") and "reasoning" (1-2 sentences).
"""


def run_orchestrator(state: DataPilotState) -> dict:
    """Orchestrator Agent: LLM-powered dynamic routing between pipeline agents."""
    trace = list(state.get("trace") or [])
    query = state.get("query") or ""
    max_hops = max(4, int(os.getenv("DATAPILOT_MAX_PIPELINE_HOPS", "18")))
    orchestrator_hops = sum(1 for entry in trace if entry.get("agent") == "orchestrator")

    # Extract which agents have already run from the trace (excluding orchestrator itself)
    agents_run = []
    for entry in trace:
        agent = entry.get("agent", "")
        if agent and agent != "orchestrator" and agent not in agents_run:
            agents_run.append(agent)

    # Build agents description block
    agents_description = "\n".join(
        f"- {name}: {desc}" for name, desc in _AVAILABLE_AGENTS.items()
    )

    # Summarise current state for the LLM
    plan = state.get("plan") or {}
    plan_valid = plan.get("is_valid") if plan else None
    data_feasibility = state.get("data_feasibility") or "unknown"
    has_pending_sql = bool(state.get("pending_execute_sql"))
    sql_approved = bool(state.get("sql"))
    has_regenerate_hint = bool((state.get("optimizer_regenerate_hint") or "").strip())
    has_results = state.get("raw_results") is not None
    validation_ok = bool(state.get("validation_ok"))
    has_explanation = bool((state.get("explanation") or "").strip())
    execution_error = state.get("execution_error") or None
    executor_retry_count = int(state.get("executor_retry_count") or 0)
    has_relevance_hint = bool((state.get("relevance_check_hint") or "").strip())
    validator_retry_count = int(state.get("validator_retry_count") or 0)
    from_cache = bool(state.get("from_query_cache_adapt") and state.get("sql"))

    prompt = get_prompt("datapilot-orchestrator", _ORCHESTRATOR_PROMPT).format(
        agents_description=agents_description,
        query=query,
        agents_run=agents_run if agents_run else ["(none yet)"],
        from_cache=from_cache,
        plan_valid=plan_valid,
        data_feasibility=data_feasibility,
        has_pending_sql=has_pending_sql,
        sql_approved=sql_approved,
        has_regenerate_hint=has_regenerate_hint,
        has_results=has_results,
        validation_ok=validation_ok,
        has_explanation=has_explanation,
        execution_error=execution_error,
        executor_retry_count=executor_retry_count,
        has_relevance_hint=has_relevance_hint,
        validator_retry_count=validator_retry_count,
    )

    if orchestrator_hops >= max_hops:
        next_agent = "END"
        reasoning = (
            f"Reached orchestration safety cap ({orchestrator_hops}/{max_hops}) to prevent loop-driven retries."
        )
    else:
        llm = get_gemini()
        structured_llm = llm.with_structured_output(OrchestratorDecision, method="json_mode")
        try:
            decision: OrchestratorDecision = invoke_with_retry(structured_llm, prompt)
            next_agent = decision.next.strip()
            reasoning = decision.reasoning.strip()
        except Exception as exc:
            # Fallback: if LLM call fails, end the pipeline gracefully
            next_agent = "END"
            reasoning = f"Orchestrator error ({exc}); terminating pipeline."

    # Validate the chosen agent is a known name
    valid_names = set(_AVAILABLE_AGENTS.keys())
    if next_agent not in valid_names:
        next_agent = "END"
        reasoning = f"Orchestrator returned unknown agent name; terminating pipeline."

    try:
        _get_langfuse_client().update_current_span(
            input={
                "query": query,
                "agents_already_run": agents_run,
                "state_snapshot": {
                    "from_cache": from_cache,
                    "plan_valid": plan_valid,
                    "data_feasibility": data_feasibility,
                    "has_pending_sql": has_pending_sql,
                    "sql_approved": sql_approved,
                    "has_results": has_results,
                    "validation_ok": validation_ok,
                    "has_explanation": has_explanation,
                    "execution_error": bool(execution_error),
                    "executor_retry_count": executor_retry_count,
                },
            },
            output={"next_agent": next_agent, "reasoning": reasoning},
            metadata={"agent": "orchestrator"},
        )
    except Exception:
        pass

    # Map "END" to LangGraph's internal sentinel
    langgraph_next = "__end__" if next_agent == "END" else next_agent

    append_trace(
        trace,
        TraceEntry(
            agent="orchestrator",
            status="info",
            message=f"Routing to [{next_agent}]: {reasoning}",
        ).model_dump(),
    )

    return {
        "next_agent": langgraph_next,
        "orchestrator_reasoning": reasoning,
        "trace": trace,
    }
