"""
Optimizer Agent – generates SQL per dialect, validates, estimates cost (BigQuery), and asks user to confirm before execution.
Uses official BigQuery/Postgres SQL docs best practices. Calls interrupt() for execute confirmation.
"""
import os
import json
import re
from langgraph.types import interrupt

from llm import get_gemini, invoke_with_retry
from agents.state import TraceEntry
from agents.schema_utils import load_schema, plan_result_limit_display, sql_row_limit_rule_5
from agents.trace_stream import append_trace


FORBIDDEN_SQL_PATTERNS = re.compile(
    r"\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)

OPTIMIZER_PROMPT_BIGQUERY = """Generate a BigQuery SQL query following official BigQuery best practices.
Reference: https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}
- Result row limit: {result_limit_display}

Schema (dataset: {dataset}):
{schema_json}

Rules:
1. Use standard BigQuery SQL. Table names: `{project}.{dataset}.table_name`
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs. The schema JSON includes a top-level `relationships` array (foreign keys such as products.brand_id -> brands.brand_id) — follow it for join paths.
4. For date filters, use EXTRACT or DATE functions. If period is "last_quarter", use DATE_SUB and DATE_TRUNC. Respect `data_range` on date columns in the schema when filtering.
5. {row_limit_rule_5}
6. Return ONLY the SQL query, no explanation. No markdown code blocks.
"""

OPTIMIZER_PROMPT_POSTGRES = """Generate a PostgreSQL SQL query following official PostgreSQL best practices.
Reference: https://www.postgresql.org/docs/current/sql-select.html

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}
- Result row limit: {result_limit_display}

Schema (schema: {schema}):
{schema_json}

Rules:
1. Use standard PostgreSQL SQL. Table names: "{schema}".table_name or schema.table_name
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs. The schema JSON includes a top-level `relationships` array — follow it for join paths.
4. For date filters, use DATE_TRUNC, INTERVAL, or CURRENT_DATE. If period is "last_quarter", use DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '1 quarter'. Respect `data_range` on date columns in the schema when filtering.
5. {row_limit_rule_5}
6. Return ONLY the SQL query, no explanation. No markdown code blocks.
"""


def run_optimizer(state: dict) -> dict:
    """Optimizer Agent: generate SQL, validate, estimate cost (BigQuery), interrupt for user approval."""
    plan = state.get("plan")
    nearest_plan = state.get("nearest_plan")
    data_feasibility = state.get("data_feasibility", "none")
    trace = state.get("trace", [])

    append_trace(
        trace,
        TraceEntry(agent="optimizer", status="info", message="Generating SQL from analysis plan...").model_dump()
    )

    if data_feasibility == "none":
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="info", message="Skipped – no feasible data").model_dump(),
        )
        return {"trace": trace}

    effective_plan = nearest_plan if data_feasibility == "partial" and nearest_plan else plan
    if not effective_plan:
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message="No plan available").model_dump(),
        )
        return {"trace": trace}

    try:
        from db.factory import get_connector
        connector = get_connector()
    except ImportError:
        connector = None

    if not connector:
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message="No database configured.").model_dump(),
        )
        return {"trace": trace}

    schema = load_schema()
    schema_json = json.dumps(schema, indent=2)
    metrics = effective_plan.get("metrics", [])
    dimensions = effective_plan.get("dimensions", [])
    filters = effective_plan.get("filters", {})
    rld = plan_result_limit_display(effective_plan)
    rlr = sql_row_limit_rule_5(effective_plan)

    try:
        llm = get_gemini()
        dialect = connector.dialect
        if dialect == "postgres":
            schema_name = os.getenv("POSTGRES_SCHEMA", "public")
            prompt = OPTIMIZER_PROMPT_POSTGRES.format(
                metrics=metrics,
                dimensions=dimensions,
                filters=json.dumps(filters),
                result_limit_display=rld,
                row_limit_rule_5=rlr,
                schema_json=schema_json,
                schema=schema_name,
            )
        else:
            project_id = os.getenv("BIGQUERY_PROJECT_ID")
            dataset_id = os.getenv("BIGQUERY_DATASET", "retail_data")
            prompt = OPTIMIZER_PROMPT_BIGQUERY.format(
                metrics=metrics,
                dimensions=dimensions,
                filters=json.dumps(filters),
                result_limit_display=rld,
                row_limit_rule_5=rlr,
                schema_json=schema_json,
                project=project_id,
                dataset=dataset_id,
            )
        response = invoke_with_retry(llm, prompt)
        sql = (response.content if hasattr(response, "content") else str(response)).strip()
        if sql.startswith("```"):
            sql = re.sub(r"^```\w*\n?", "", sql)
            sql = re.sub(r"\n?```$", "", sql)
        sql = sql.strip()

        if FORBIDDEN_SQL_PATTERNS.search(sql):
            append_trace(
                trace,
                TraceEntry(agent="optimizer", status="error", message="Generated SQL contains forbidden operations").model_dump(),
            )
            return {"trace": trace}

        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="info", message="SQL generated, validating...").model_dump(),
        )

        bytes_scanned = None
        estimated_cost = None
        if dialect == "bigquery" and hasattr(connector, "dry_run_estimate"):
            try:
                bytes_scanned, estimated_cost = connector.dry_run_estimate(sql)
                append_trace(
                    trace,
                    TraceEntry(
                        agent="optimizer",
                        status="info",
                        message=f"Dry run: ~{bytes_scanned / (1024**2):.2f} MB, ~${estimated_cost:.6f}",
                        output={"bytes_scanned": bytes_scanned, "estimated_cost": estimated_cost},
                    ).model_dump(),
                )
            except Exception as e:
                append_trace(
                    trace,
                    TraceEntry(agent="optimizer", status="info", message=f"Dry run skipped: {e}").model_dump(),
                )

        # Interrupt: ask user to approve execution
        skip_hil = os.getenv("DATAPILOT_SKIP_INTERRUPTS", "").strip().lower() in ("1", "true", "yes")
        if skip_hil:
            approved = True
        else:
            interrupt_payload = {
                "reason": "execute_query",
                "sql": sql,
                "bytes_scanned": bytes_scanned,
                "estimated_cost": estimated_cost,
                "dialect": dialect,
            }
            approved = interrupt(interrupt_payload)

        if not approved:
            append_trace(
                trace,
                TraceEntry(agent="optimizer", status="info", message="User declined to execute").model_dump(),
            )
            return {"trace": trace}

        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="success", message="User approved – proceeding to execution").model_dump(),
        )

        update = {"sql": sql, "trace": trace}
        if bytes_scanned is not None:
            update["bytes_scanned"] = bytes_scanned
        if estimated_cost is not None:
            update["estimated_cost"] = estimated_cost
        return update

    except Exception as e:
        # Re-raise interrupt so LangGraph can handle it (don't show raw Interrupt object to user)
        err_type = type(e).__name__
        err_str = str(e)
        if "Interrupt" in err_type or "interrupt" in err_str.lower():
            raise
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message=str(e)).model_dump(),
        )
        return {"trace": trace}
