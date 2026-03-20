"""
Visualization & Explanation Agent – chart spec and natural language summary.
"""
from pydantic import BaseModel, Field
from llm import get_gemini
from agents.state import TraceEntry


class VisualizationOutput(BaseModel):
    """Output from Visualization Agent."""
    chart_type: str = Field(description="bar | line | pie | area | table")
    x_field: str | None = Field(default=None, description="Column name for x-axis")
    y_field: str | None = Field(default=None, description="Column name for y-axis")
    title: str | None = Field(default=None, description="Chart title")
    explanation: str = Field(description="Natural language summary of the data for the user")


VIZ_PROMPT = """You are a data visualization agent. Given query results and the analysis plan, produce a chart specification and explanation.

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
"""


def run_visualization(state: dict) -> dict:
    """Visualization Agent: produce chart_spec and explanation."""
    query = state.get("query", "")
    plan = state.get("plan", {})
    raw_results = state.get("raw_results")
    trace = state.get("trace", [])
    data_range = state.get("data_range")
    empty_result_reason = state.get("empty_result_reason")

    trace.append(
        TraceEntry(agent="visualization", status="info", message="Preparing chart and explanation...").model_dump()
    )

    if not raw_results:
        trace.append(TraceEntry(agent="visualization", status="info", message="No results to visualize").model_dump())
        # Use contextual explanation when data_range or empty_result_reason is available
        if data_range or empty_result_reason:
            data_range_info = (
                f"Data spans from {data_range['min']} to {data_range['max']}"
                if data_range and data_range.get("min") and data_range.get("max")
                else (empty_result_reason or "Unknown")
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
                result = structured_llm.invoke(prompt)
                result_dict = result.model_dump() if hasattr(result, "model_dump") else result
                explanation = result_dict.get("explanation", empty_result_reason or "No data was returned for this query.")
            except Exception:
                explanation = empty_result_reason or "No data was returned for this query."
        else:
            explanation = "No data was returned for this query."
        return {
            "chart_spec": {"chart_type": "table", "title": "No data", "x_field": None, "y_field": None},
            "explanation": explanation,
            "trace": trace,
            "data_range": data_range,
            "empty_result_reason": empty_result_reason,
        }

    trace.append(
        TraceEntry(agent="visualization", status="info", message="Choosing chart type and generating explanation...").model_dump()
    )

    metrics = plan.get("metrics", [])
    dimensions = plan.get("dimensions", [])
    columns = list(raw_results[0].keys()) if raw_results else []
    results_sample = str(raw_results[:20])

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
        result = structured_llm.invoke(prompt)

        result_dict = result.model_dump() if hasattr(result, "model_dump") else result
        chart_spec = {
            "chart_type": result_dict.get("chart_type", "table"),
            "x_field": result_dict.get("x_field"),
            "y_field": result_dict.get("y_field"),
            "title": result_dict.get("title", "Results"),
        }
        explanation = result_dict.get("explanation", "Here are the results.")

        trace.append(
            TraceEntry(
                agent="visualization",
                status="success",
                message="Chart spec and explanation generated",
                output={"chart_type": chart_spec["chart_type"]},
            ).model_dump()
        )

        return {"chart_spec": chart_spec, "explanation": explanation, "trace": trace}
    except Exception as e:
        trace.append(TraceEntry(agent="visualization", status="error", message=str(e)).model_dump())
        return {
            "chart_spec": {"chart_type": "table", "title": "Results", "x_field": None, "y_field": None},
            "explanation": f"Here are the results. (Visualization error: {e})",
            "trace": trace,
        }
