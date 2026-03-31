"""
Data Discovery Agent – checks if the analysis plan can be fulfilled with available data.
Proceeds automatically when feasibility is full or partial (no user approval).
"""
import json

from llm import get_gemini, invoke_with_retry
from langfuse_setup import get_prompt
from agents.state import DataFeasibility, TraceEntry
from agents.context import get_effective_schema
from agents.schema_utils import extract_data_ranges
from agents.time_window_guard import plan_time_window_unavailable_message
from agents.trace_stream import append_trace


DISCOVERY_PROMPT = """You are a data discovery agent. You have an analysis plan and a database schema.

Analysis plan:
- Metrics to measure: {metrics}
- Dimensions to group by: {dimensions}
- Filters: {filters}

Database schema (tables and columns):
{schema_json}

{data_ranges_section}

{user_csv_note}
Your job:
1. Check if the requested metrics and dimensions can be satisfied with the available tables and columns.
2. If the plan has date filters (e.g. start_date, end_date, period like "last_month", "last_quarter"), check whether the requested time range falls within the available data_range above. If the requested period is outside the known range, set feasibility to "partial" or "none" and explain in missing_explanation. Quote the actual min and max dates from the data availability section above (illustrative wording only: e.g. orders/sales_daily often align with roughly 2024-03-01 to 2025-03-01 in the enriched dataset — use the real values from the schema text above; return_dates may extend slightly later).
3. Return feasibility:
   - "full": All requested metrics and dimensions exist, and date filters (if any) fall within available data. We can answer the question exactly.
   - "partial": Some metrics/dimensions exist, or date range may be outside available data. We can answer a nearest possible version. Explain what's missing.
   - "none": The data does not support this analysis. Explain what's missing.

4. If "partial", provide nearest_plan: an adjusted plan with only the metrics/dimensions we CAN provide.
5. If "partial" or "none", provide missing_explanation: what columns or tables are missing, or if the date range is outside available data.
6. List tables_used: which tables will be used for the (possibly adjusted) plan.

Column mapping hints (align with schema tables: brands, sales_reps, warehouses, campaigns, products, customers, orders, order_items, shipments, return_items, order_campaigns, sales_daily):
- revenue, total_amount, line_total -> orders.total_amount, order_items.line_total, sales_daily.revenue
- units_sold, quantity -> order_items.quantity, sales_daily.units_sold
- region, segment -> customers.region, customers.segment; sales_reps.region; warehouses.region
- category -> products.category
- brand -> brands.name JOIN products ON products.brand_id = brands.brand_id
- date, order_date -> orders.order_date, sales_daily.date, shipments.ship_date, return_items.return_date (each may have a different data_range)
- product, product_id -> products, order_items.product_id
- rep, sales rep -> sales_reps.full_name, customers.sales_rep_id
- refund, returns -> return_items.refund_amount, return_items.reason_code
- campaign, marketing channel, attribution -> campaigns, order_campaigns (bridge to orders.order_id)
- warehouse, carrier, fulfillment -> shipments, warehouses, shipments.carrier
"""


def run_discovery(state: dict) -> dict:
    """Data Discovery Agent: check feasibility against schema."""
    plan = state.get("plan")
    trace = state.get("trace", [])

    append_trace(
        trace,
        TraceEntry(agent="discovery", status="info", message="Loading schema and data availability...").model_dump()
    )

    if not plan or not plan.get("is_valid"):
        append_trace(
            trace,
            TraceEntry(agent="discovery", status="info", message="Skipped – invalid plan").model_dump(),
        )
        return {"data_feasibility": "none", "trace": trace}

    schema = get_effective_schema(state)
    schema_json = json.dumps(schema, indent=2)
    data_ranges = extract_data_ranges(schema)
    data_ranges_section = data_ranges
    user_csv_note = ""
    if (schema.get("source_kind") or "").strip().lower() == "user_csv":
        user_csv_note = (
            "SCOPE: User-uploaded spreadsheet only. Use only tables and columns in the schema JSON. "
            "Retail mapping hints below apply only if those tables appear in the JSON.\n\n"
        )

    append_trace(
        trace,
        TraceEntry(agent="discovery", status="info", message="Checking if metrics and dimensions exist in schema...").model_dump()
    )

    metrics = plan.get("metrics", [])
    dimensions = plan.get("dimensions", [])
    filters = plan.get("filters", {})

    append_trace(
        trace,
        TraceEntry(agent="discovery", status="info", message="Validating requested time range against available data...").model_dump()
    )

    try:
        llm = get_gemini()
        structured_llm = llm.with_structured_output(DataFeasibility, method="json_mode")
        prompt = get_prompt("datapilot-discovery", DISCOVERY_PROMPT).format(
            metrics=metrics,
            dimensions=dimensions,
            filters=json.dumps(filters),
            schema_json=schema_json,
            data_ranges_section=data_ranges_section,
            user_csv_note=user_csv_note,
        )
        result = invoke_with_retry(structured_llm, prompt)

        result_dict = result.model_dump() if hasattr(result, "model_dump") else result
        feasibility = result_dict.get("feasibility", "none")

        tw_msg = plan_time_window_unavailable_message(state.get("query", ""), plan, schema)
        if tw_msg:
            feasibility = "none"
            result_dict["feasibility"] = "none"
            result_dict["missing_explanation"] = tw_msg
            result_dict["nearest_plan"] = None

        tables_used = result_dict.get("tables_used", [])

        feasibility_messages = {
            "full": "All requested metrics and dimensions are available in your connected data.",
            "partial": "We can answer a close version of your question; some parts were adjusted to match your data.",
            "none": "Your connected data does not support this analysis as requested.",
        }
        user_message = feasibility_messages.get(
            feasibility, f"Data check result: {feasibility}"
        )
        append_trace(
            trace,
            TraceEntry(
                agent="discovery",
                status="success",
                message=user_message,
                output={"feasibility": feasibility, "tables_used": tables_used},
            ).model_dump(),
        )

        update = {
            "data_feasibility": feasibility,
            "tables_used": tables_used,
            "trace": trace,
        }
        if feasibility == "partial" and result_dict.get("nearest_plan"):
            update["nearest_plan"] = result_dict["nearest_plan"]
        if result_dict.get("missing_explanation"):
            update["missing_explanation"] = result_dict["missing_explanation"]

        return update
    except Exception as e:
        append_trace(
            trace,
            TraceEntry(agent="discovery", status="error", message=str(e)).model_dump(),
        )
        return {
            "data_feasibility": "none",
            "missing_explanation": str(e),
            "trace": trace,
        }
