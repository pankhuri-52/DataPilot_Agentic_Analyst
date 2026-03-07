"""
Visualization & Explanation Agent – chart spec and natural language summary.
"""
from pydantic import BaseModel, Field
from llm import get_gemini
from agents.state import TraceEntry


class VisualizationOutput(BaseModel):
    """Output from Visualization Agent."""
    chart_type: str = Field(description="bar | line | pie | table")
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

Your job:
1. Choose the best chart type: "bar" for categorical comparison, "line" for trends over time, "pie" for proportions (max ~8 slices), "table" for detailed data.
2. Set x_field and y_field to column names from the results. For pie charts, use one value column.
3. Write a concise, business-friendly explanation (2-4 sentences) summarizing the key insights.
4. Set title to a short, descriptive chart title.
"""


def run_visualization(state: dict) -> dict:
    """Visualization Agent: produce chart_spec and explanation."""
    query = state.get("query", "")
    plan = state.get("plan", {})
    raw_results = state.get("raw_results")
    trace = state.get("trace", [])

    if not raw_results:
        trace.append(TraceEntry(agent="visualization", status="info", message="No results to visualize").model_dump())
        return {
            "chart_spec": {"chart_type": "table", "title": "No data", "x_field": None, "y_field": None},
            "explanation": "No data was returned for this query.",
            "trace": trace,
        }

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
