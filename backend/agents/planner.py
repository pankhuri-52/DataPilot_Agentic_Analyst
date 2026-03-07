"""
Planning Agent – validates query and produces structured analysis plan.
"""
import json
from llm import get_gemini
from agents.state import AnalysisPlan, TraceEntry


PLANNER_PROMPT = """You are a data analytics planning agent. A business user has asked a question about their data.

User question: {query}

Your job:
1. Determine if the question is valid and analyzable (e.g. about sales, revenue, orders, products, customers, regions, segments).
2. If VALID: produce a structured analysis plan with:
   - metrics: what to measure (e.g. revenue, total_amount, units_sold, count of orders)
   - dimensions: what to group by (e.g. region, category, segment, product, date)
   - filters: any constraints (e.g. date range, status, region)
3. If INVALID (too vague, off-topic, or unclear): set is_valid=false and provide clarifying_questions to help the user refine.

Rules:
- Only analytics questions about business data (sales, orders, products, customers) are valid.
- Use lowercase for metric/dimension names that could map to database columns.
- For date filters, use keys like "start_date", "end_date" or "period" (e.g. "last_quarter").
- Keep clarifying questions concise and actionable.
"""


def run_planner(state: dict) -> dict:
    """Planning Agent: validate query, produce plan or clarifying questions."""
    query = state.get("query", "")
    trace = state.get("trace", [])

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

    try:
        llm = get_gemini()
        structured_llm = llm.with_structured_output(AnalysisPlan, method="json_mode")
        prompt = PLANNER_PROMPT.format(query=query)
        plan = structured_llm.invoke(prompt)

        plan_dict = plan.model_dump() if hasattr(plan, "model_dump") else plan
        trace.append(
            TraceEntry(
                agent="planner",
                status="success",
                message="Plan created" if plan_dict.get("is_valid") else "Clarifying questions generated",
                output={"is_valid": plan_dict.get("is_valid"), "metrics": plan_dict.get("metrics", [])},
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
