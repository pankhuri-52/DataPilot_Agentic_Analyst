"""
DataPilot shared state – flows through all agents in the LangGraph.
"""
from typing import TypedDict, Optional, Any
from pydantic import BaseModel, Field


class PlanStep(BaseModel):
    """One row in the UI execution checklist; phase ties the step to the agent pipeline."""
    phase: str = Field(
        description="One of: planner, discovery, optimizer, executor, validator, visualization"
    )
    title: str = Field(description="Short user-visible label for this step")
    detail: Optional[str] = Field(
        default=None,
        description="Optional longer description; for planner step, summarize what we will measure and break down",
    )


class AnalysisPlan(BaseModel):
    """Structured plan from the Planning Agent."""
    metrics: list[str] = Field(description="What to measure (e.g. revenue, total_amount, count)")
    dimensions: list[str] = Field(description="Group by (e.g. region, category, segment)")
    filters: dict[str, Any] = Field(default_factory=dict, description="Filters (e.g. date range, status)")
    result_limit: Optional[int] = Field(
        default=None,
        description=(
            "Max rows for the final ranked/breakdown result. Use 1 when the user asks for a single winner "
            "(e.g. one brand with highest sales). Use N for explicit top-N. Omit/null for open-ended 'all' comparisons."
        ),
    )
    is_valid: bool = Field(description="Whether the query is valid and analyzable")
    clarifying_questions: list[str] = Field(default_factory=list, description="Questions to ask if invalid")
    query_scope: Optional[str] = Field(
        default=None,
        description="data_question | out_of_scope | needs_clarification — classify the user's message",
    )
    execution_steps: list[PlanStep] = Field(
        default_factory=list,
        description="When is_valid=true: exactly 6 steps in pipeline order (planner→…→visualization) for the UI checklist",
    )
    resolved_source_id: Optional[str] = Field(
        default=None,
        description=(
            "When MULTI-SOURCE SCHEMA DIGEST is present, set to the exact source id string "
            "(e.g. primary or a UUID) for the database that should answer this question."
        ),
    )


class DataFeasibility(BaseModel):
    """Output from Data Discovery Agent."""
    feasibility: str = Field(description="full | partial | none")
    nearest_plan: Optional[dict[str, Any]] = Field(default=None, description="Adjusted plan if partial (metrics, dimensions, filters)")
    missing_explanation: Optional[str] = Field(default=None, description="What fields/columns are missing")
    tables_used: list[str] = Field(default_factory=list, description="Tables that can be used")


class ChartSpec(BaseModel):
    """Chart specification from Visualization Agent."""
    chart_type: str = Field(description="bar | line | pie | table")
    x_field: Optional[str] = Field(default=None, description="Field for x-axis")
    y_field: Optional[str] = Field(default=None, description="Field for y-axis")
    title: Optional[str] = Field(default=None, description="Chart title")


class TraceEntry(BaseModel):
    """Single step in the agent trace."""
    agent: str
    status: str = Field(description="success | error | info")
    message: Optional[str] = None
    output: Optional[dict[str, Any]] = None


class DataPilotState(TypedDict, total=False):
    """Shared state flowing through all agents. Values stored as dicts for LangGraph."""
    query: str
    user_id: Optional[str]  # For resolving saved connectors (no secrets in state)
    active_source_id: Optional[str]  # "primary" or user_data_sources.id
    schema_catalog: Optional[dict[str, Any]]  # Introspected or static metadata for the active source
    runtime_connection_hints: Optional[dict[str, Any]]  # postgres_schema, bigquery_project, bigquery_dataset
    available_sources: Optional[list[dict[str, Any]]]  # Lightweight list for UI / planner context
    available_sources_summary: Optional[str]  # Prompt text: connected sources + active
    data_source_label: Optional[str]  # Human label for traces
    multi_source_schema_digest: Optional[str]  # Full multi-source schema text for planner when 2+ sources
    conversation_history: list[dict[str, Any]]  # [{role, content, metadata?}] for conversational context
    plan: Optional[dict[str, Any]]  # AnalysisPlan as dict
    data_feasibility: str  # "full" | "partial" | "none"
    nearest_plan: Optional[dict[str, Any]]  # AnalysisPlan as dict if partial
    missing_explanation: Optional[str]
    tables_used: list[str]  # From Discovery; informs SQL generation
    sql: Optional[str]  # From Optimizer when user approves execution
    # Filled by optimizer_prepare; consumed by optimizer_gate (so resume does not re-run LLM/dry-run).
    pending_execute_sql: Optional[str]
    pending_execute_bytes: Optional[int]
    pending_execute_cost: Optional[float]
    pending_execute_dialect: Optional[str]
    # Execute HITL: first decline triggers one optimizer_prepare pass with hint; second decline ends the run.
    optimizer_decline_count: int
    optimizer_regenerate_hint: Optional[str]
    bytes_scanned: Optional[int]  # BigQuery dry run estimate
    estimated_cost: Optional[float]  # BigQuery cost estimate (USD)
    raw_results: Optional[list[dict[str, Any]]]
    validation_ok: bool
    chart_spec: Optional[dict[str, Any]]
    explanation: str
    answer_summary: Optional[str]
    follow_up_suggestions: Optional[list[str]]
    trace: list[dict[str, Any]]
    data_range: Optional[dict[str, Any]]  # {"min": "YYYY-MM-DD", "max": "YYYY-MM-DD", "table": "...", "column": "..."}
    empty_result_reason: Optional[str]  # Contextual explanation when query returns 0 rows
    from_query_cache_adapt: Optional[bool]  # True when user chose Adapt (reuse cached SQL path)
    kb_result_preview: Optional[dict[str, Any]]  # {"rows": [...], "row_count": n} from KB when using Adapt
    interrupt_created_at: Optional[str]  # ISO-8601 UTC; stamped by optimizer_prepare when a HITL interrupt is pending
    # SQL self-correction loop: executor feeds failures back to optimizer_prepare for up to N retries.
    execution_error: Optional[str]  # DB error + failed SQL snippet from last execution attempt; None on success
    executor_retry_count: int  # Incremented per SQL execution failure; reset to 0 in initial_state each query
    # Result relevance check: validator feeds a hint back to optimizer_prepare when results don't answer the question.
    relevance_check_hint: Optional[str]  # Set by validator when LLM relevance check fails; cleared after optimizer consumes it
    validator_retry_count: int  # Incremented per relevance failure; capped at 1 to avoid infinite loops
    # Dynamic orchestrator: set by run_orchestrator to communicate routing decision to the graph.
    next_agent: Optional[str]  # Name of the agent to call next (or "END"); read by route_from_orchestrator
    orchestrator_reasoning: Optional[str]  # LLM's reasoning for the routing decision (surfaced in trace)
