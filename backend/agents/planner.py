"""
Planning Agent – validates query and produces structured analysis plan.
Checks data availability early: if the user asks for a time period outside the database range,
stops and asks if they want to proceed with the available range instead.
"""
import json
from llm import get_gemini
from agents.state import AnalysisPlan, TraceEntry
from agents.schema_utils import load_schema, extract_data_ranges


PLANNER_PROMPT = """You are a data analytics planning agent. A business user has asked a question about their data.

User question: {query}

{CONVERSATION_HISTORY_SECTION}

{DATA_AVAILABILITY_SECTION}

Your job:
1. Determine if the question is valid and analyzable (e.g. about sales, revenue, orders, products, customers, regions, segments).
2. If the question asks for a time period (e.g. "last month", "last quarter", "last year", specific dates): check whether that period falls within the DATA AVAILABILITY above. If the requested period is OUTSIDE the available range (e.g. user asks for "last month" but data only spans 2024-01-01 to 2024-02-15), set is_valid=false and add a clarifying_question that:
   (a) States that the data for the requested period is not available in the database.
   (b) States the available range (e.g. "We have data from 2024-01-01 to 2024-02-15").
   (c) Offers to answer the same question for the available range (e.g. "Would you like to get total sales by region for this available period instead?").
3. If VALID and time range is within availability: produce a structured analysis plan with:
   - metrics: what to measure (e.g. revenue, total_amount, units_sold, count of orders)
   - dimensions: what to group by (e.g. region, category, segment, product, date)
   - filters: any constraints (e.g. date range, status, region)
4. If INVALID for other reasons (too vague, off-topic, unclear): set is_valid=false and provide clarifying_questions to help the user refine.

Rules:
- Only analytics questions about business data (sales, orders, products, customers) are valid.
- Use lowercase for metric/dimension names that could map to database columns.
- For date filters, use keys like "start_date", "end_date" or "period" (e.g. "last_quarter").
- Keep clarifying questions concise and actionable.
- When data is outside range, ALWAYS include the exact min and max dates from DATA AVAILABILITY in your clarifying_question.

CONVERSATIONAL CONTEXT (when conversation history is provided):
- If the user's current message is a brief affirmation (e.g. "Sure", "Yes", "Okay", "Yes please", "Go ahead", "That works") AND the previous assistant message contained a clarifying question offering to answer for the available data range, treat the user as agreeing.
- In that case: produce a VALID plan that answers the ORIGINAL user question (from the history) but with filters set to the available date range (start_date and end_date from DATA AVAILABILITY). Set is_valid=true and include the appropriate filters.
"""


def _build_conversation_history_section(history: list[dict]) -> str:
    """Format conversation history for prompt. Keeps last N turns for context."""
    if not history:
        return ""
    max_turns = 10  # Last 5 user + 5 assistant
    recent = history[-max_turns:] if len(history) > max_turns else history
    lines = []
    for msg in recent:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        meta = msg.get("metadata") or {}
        # Use clarifying_questions from metadata (saved when assistant asked) for full context
        clarifying = meta.get("clarifying_questions") or (meta.get("plan") or {}).get("clarifying_questions")
        if clarifying and isinstance(clarifying, list):
            content = content or ("; ".join(clarifying) if clarifying and isinstance(clarifying[0], str) else str(clarifying))
        lines.append(f"- {role}: {content[:500]}{'...' if len(content) > 500 else ''}")
    return "Recent conversation (for context):\n" + "\n".join(lines) + "\n\n"


def run_planner(state: dict) -> dict:
    """Planning Agent: validate query, produce plan or clarifying questions.
    Checks data availability early; stops with clarifying question if requested period is outside range.
    Uses conversation history for conversational context (e.g. user says 'Sure' to proceed with available range)."""
    query = state.get("query", "")
    trace = state.get("trace", [])
    history = state.get("conversation_history") or []

    trace.append(
        TraceEntry(agent="planner", status="info", message="Analyzing your query...").model_dump()
    )

    if not query or not query.strip():
        trace.append(TraceEntry(agent="planner", status="error", message="Empty query").model_dump())
        return {
            "plan": AnalysisPlan(
                metrics=[],
                dimensions=[],
                filters={},
                is_valid=False,
                clarifying_questions=["Please enter a question about your data (e.g. sales, revenue, orders)."],
            ).model_dump(),
            "trace": trace,
        }

    trace.append(
        TraceEntry(agent="planner", status="info", message="Checking if question is valid and answerable...").model_dump()
    )

    try:
        schema = load_schema()
        data_ranges_str = extract_data_ranges(schema)
        data_section = (
            f"DATA AVAILABILITY (use this to validate time-based questions):\n{data_ranges_str}\n\n"
            if "available from" in data_ranges_str
            else ""
        )
        trace.append(
            TraceEntry(
                agent="planner",
                status="info",
                message="Validating time range against available data...",
                output={"data_availability": data_ranges_str[:200] + "..." if len(data_ranges_str) > 200 else data_ranges_str},
            ).model_dump()
        )

        history_section = _build_conversation_history_section(history)
        llm = get_gemini()
        structured_llm = llm.with_structured_output(AnalysisPlan, method="json_mode")
        prompt = PLANNER_PROMPT.format(
            query=query,
            CONVERSATION_HISTORY_SECTION=history_section or "",
            DATA_AVAILABILITY_SECTION=data_section or "No date-range metadata available; skip time-range validation.",
        )
        plan = structured_llm.invoke(prompt)

        plan_dict = plan.model_dump() if hasattr(plan, "model_dump") else plan
        if plan_dict.get("is_valid"):
            trace.append(
                TraceEntry(
                    agent="planner",
                    status="success",
                    message="Plan created – query is valid and within data range",
                    output={"is_valid": True, "metrics": plan_dict.get("metrics", []), "dimensions": plan_dict.get("dimensions", []), "filters": plan_dict.get("filters", {})},
                ).model_dump()
            )
        else:
            trace.append(
                TraceEntry(
                    agent="planner",
                    status="success",
                    message="Clarifying questions generated – data not available for requested period or query needs refinement",
                    output={"is_valid": False, "clarifying_questions": plan_dict.get("clarifying_questions", [])},
                ).model_dump()
            )

        return {"plan": plan_dict, "trace": trace}
    except Exception as e:
        trace.append(TraceEntry(agent="planner", status="error", message=str(e)).model_dump())
        return {
            "plan": AnalysisPlan(
                metrics=[],
                dimensions=[],
                filters={},
                is_valid=False,
                clarifying_questions=[f"Sorry, I couldn't process that. Please try rephrasing. Error: {e}"],
            ).model_dump(),
            "trace": trace,
        }
