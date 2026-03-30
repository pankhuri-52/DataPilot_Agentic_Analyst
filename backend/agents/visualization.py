"""
Visualization & Explanation Agent – chart spec and natural language summary.
"""
from pydantic import BaseModel, Field
from llm import get_gemini, invoke_with_retry
from agents.state import TraceEntry
from agents.trace_stream import append_trace


class VisualizationOutput(BaseModel):
    """Output from Visualization Agent."""
    chart_type: str = Field(description="bar | line | pie | area | table")
    x_field: str | None = Field(default=None, description="Column name for x-axis")
    y_field: str | None = Field(default=None, description="Column name for y-axis")
    title: str | None = Field(default=None, description="Chart title")
    explanation: str = Field(description="Natural language summary of the data for the user")
    answer_summary: str = Field(
        description="1-3 sentences that directly answer the user's original question using the results",
    )
    follow_up_suggestions: list[str] = Field(
        default_factory=list,
        description="2-3 short, concrete follow-up questions the user could ask next about this data",
    )


VIZ_PROMPT = """You are a data visualization agent. Given query results and the analysis plan, produce a chart specification and explanation.

Context: rows are from a retail/B2B warehouse query (e.g. sales, products, customers, regions). Use only column names that appear in the results below.

User question: {query}

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}

Query results (first 20 rows):
{results_sample}

Column names in results: {columns}

CHART TYPE SELECTION (choose based on the question and data shape – do NOT default to bar):
- "line" or "area": Time-series, trends over dates, growth over time. Use when x-axis is date/time or sequential. Area for cumulative or filled trends.
- "bar": Categorical comparison only (e.g. "sales by region", "top 5 products"). Use when comparing discrete categories, NOT for time trends.
- "pie": Part-of-whole, proportions, share of total. Max ~8 slices. Use for "what percentage", "breakdown by".
- "table": Raw lists, many columns, detailed lookup. Use when user needs to see exact values or many dimensions.

Examples:
- "Sales over last quarter" → line or area (time trend)
- "Revenue by region" → bar (categorical)
- "Market share by segment" → pie (proportions)
- "Top 10 products by revenue" → bar (ranking)
- "Monthly trend" → line (time)

Your job:
1. Analyze the user question and data. Pick chart_type that best fits the question type (time → line/area, categories → bar, proportions → pie).
2. Set x_field and y_field to column names from the results. For pie charts, use one value column.
3. Write a concise, business-friendly explanation (2-4 sentences) summarizing the key insights.
4. Set title to a short, descriptive chart title.
5. answer_summary: 1-3 sentences that directly answer the user's question (not generic chart commentary).
6. follow_up_suggestions: exactly 2-3 short questions (each under 120 characters) they could ask next about this dataset (e.g. drill-downs, time comparisons).
"""

VIZ_PROMPT_EMPTY = """You are a data visualization agent. The query returned NO data (0 rows). Your job is to produce a helpful explanation for the user.

User question: {query}

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}

Data available: {data_range_info}

Your job:
1. Set chart_type to "table", x_field and y_field to null, title to something like "No data" or "No results".
2. Write a concise, user-friendly explanation (2-3 sentences) that:
   - Explains that no data was found for the requested period (e.g., last month).
   - If data_range_info is provided, mention: "Available data spans from {min_date} to {max_date}. Try asking for a time range within this period."
   - Be helpful and suggest what the user could try instead.
3. answer_summary: 1-2 sentences stating clearly that there were no rows and what to try next.
4. follow_up_suggestions: 2-3 short alternative questions (e.g. different date range, broader filters).
"""


def run_visualization(state: dict) -> dict:
    """Visualization Agent: produce chart_spec and explanation."""
    query = state.get("query", "")
    plan = state.get("plan", {})
    raw_results = state.get("raw_results")
    trace = state.get("trace", [])
    data_range = state.get("data_range")
    empty_result_reason = state.get("empty_result_reason")

    append_trace(
        trace,
        TraceEntry(agent="visualization", status="info", message="Preparing chart and explanation...").model_dump()
    )

    # Adapt path: if live execute returned no rows, use KB-stored preview so charts/summary still render.
    live_rows: list[dict] = list(raw_results) if raw_results else []
    kb_preview = state.get("kb_result_preview") or {}
    preview_rows_raw = kb_preview.get("rows") if isinstance(kb_preview, dict) else None
    preview_rows: list[dict] = (
        [dict(r) for r in preview_rows_raw if isinstance(r, dict)]
        if isinstance(preview_rows_raw, list)
        else []
    )
    used_kb_preview = bool(
        state.get("from_query_cache_adapt") and not live_rows and preview_rows
    )
    effective_results: list[dict] = preview_rows if used_kb_preview else live_rows
    if used_kb_preview:
        append_trace(
            trace,
            TraceEntry(
                agent="visualization",
                status="info",
                message=(
                    "Live query returned no rows; using stored result preview from the knowledge base for "
                    "visualization (verify SQL and warehouse data if this looks outdated)."
                ),
            ).model_dump(),
        )

    if not effective_results:
        append_trace(
            trace,
            TraceEntry(agent="visualization", status="info", message="No results to visualize").model_dump(),
        )
        explanation = "No data was returned for this query."
        answer_summary = (
            "No rows from the warehouse and no saved preview in the knowledge base for this Adapt path. "
            "Try Re-run or fix the SQL / project id."
            if state.get("from_query_cache_adapt") and not preview_rows
            else explanation
        )
        follow_up: list[str] = []
        # Always run empty-state LLM when possible so users get causes + follow-ups (diagnostics may still be missing).
        if data_range and data_range.get("min") and data_range.get("max"):
            data_range_info = (
                f"Data spans from {data_range['min']} to {data_range['max']} "
                f"(warehouse column {data_range.get('table', '?')}.{data_range.get('column', '?')})."
            )
        elif empty_result_reason:
            data_range_info = empty_result_reason
        else:
            data_range_info = (
                "The warehouse returned zero rows. Common causes: filters match no data, INNER JOIN eliminated "
                "all rows, GROUP BY with no matching groups, or HAVING removed aggregate rows. For return_items, "
                "use return_date and lowercase reason_code (defective, changed_mind, not_as_described, duplicate_order)."
            )
        try:
            llm = get_gemini()
            structured_llm = llm.with_structured_output(VisualizationOutput, method="json_mode")
            prompt = VIZ_PROMPT_EMPTY.format(
                query=query,
                metrics=plan.get("metrics", []),
                dimensions=plan.get("dimensions", []),
                filters=plan.get("filters", {}),
                data_range_info=data_range_info,
                min_date=data_range.get("min", "?") if data_range else "?",
                max_date=data_range.get("max", "?") if data_range else "?",
            )
            result = invoke_with_retry(structured_llm, prompt)
            result_dict = result.model_dump() if hasattr(result, "model_dump") else result
            explanation = result_dict.get(
                "explanation", empty_result_reason or "No data was returned for this query."
            )
            answer_summary = result_dict.get("answer_summary") or explanation
            raw_fu = result_dict.get("follow_up_suggestions") or []
            follow_up = [str(x) for x in raw_fu if x][:5]
        except Exception:
            if state.get("from_query_cache_adapt") and not preview_rows:
                explanation = answer_summary
            else:
                explanation = empty_result_reason or data_range_info
                answer_summary = explanation
            follow_up = []
        out_empty = {
            "chart_spec": {"chart_type": "table", "title": "No data", "x_field": None, "y_field": None},
            "explanation": explanation,
            "answer_summary": answer_summary,
            "follow_up_suggestions": follow_up,
            "trace": trace,
            "data_range": data_range,
            "empty_result_reason": empty_result_reason,
        }
        return out_empty

    append_trace(
        trace,
        TraceEntry(agent="visualization", status="info", message="Choosing chart type and generating explanation...").model_dump()
    )

    metrics = plan.get("metrics", [])
    dimensions = plan.get("dimensions", [])
    columns = list(effective_results[0].keys()) if effective_results else []
    results_sample = str(effective_results[:20])

    try:
        llm = get_gemini()
        structured_llm = llm.with_structured_output(VisualizationOutput, method="json_mode")
        prompt = VIZ_PROMPT.format(
            query=query,
            metrics=metrics,
            dimensions=dimensions,
            results_sample=results_sample,
            columns=columns,
        )
        result = invoke_with_retry(structured_llm, prompt)

        result_dict = result.model_dump() if hasattr(result, "model_dump") else result
        chart_spec = {
            "chart_type": result_dict.get("chart_type", "table"),
            "x_field": result_dict.get("x_field"),
            "y_field": result_dict.get("y_field"),
            "title": result_dict.get("title", "Results"),
        }
        explanation = result_dict.get("explanation", "Here are the results.")
        answer_summary = result_dict.get("answer_summary") or explanation
        raw_fu = result_dict.get("follow_up_suggestions") or []
        follow_up = [str(x) for x in raw_fu if x][:5]

        append_trace(
            trace,
            TraceEntry(
                agent="visualization",
                status="success",
                message="Chart spec and explanation generated",
                output={"chart_type": chart_spec["chart_type"]},
            ).model_dump(),
        )

        out: dict = {
            "chart_spec": chart_spec,
            "explanation": explanation,
            "answer_summary": answer_summary,
            "follow_up_suggestions": follow_up,
            "trace": trace,
        }
        if used_kb_preview:
            out["raw_results"] = effective_results
        return out
    except Exception as e:
        append_trace(
            trace,
            TraceEntry(agent="visualization", status="error", message=str(e)).model_dump(),
        )
        err_expl = f"Here are the results. (Visualization error: {e})"
        return {
            "chart_spec": {"chart_type": "table", "title": "Results", "x_field": None, "y_field": None},
            "explanation": err_expl,
            "answer_summary": err_expl,
            "follow_up_suggestions": [],
            "trace": trace,
        }
