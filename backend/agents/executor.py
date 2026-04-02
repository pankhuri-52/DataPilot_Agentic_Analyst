"""
Query Execution Agent – executes SQL via generic DB connector.
Uses SQL from Optimizer when available; otherwise generates SQL (legacy path).
"""
import os
import json
import re
from llm import coerce_ai_text, get_llm, invoke_with_retry
from langfuse_setup import get_prompt
from langfuse import observe
from langfuse_setup import safe_update_current_span
from agents.state import TraceEntry
from agents.context import get_effective_connector, get_effective_schema
from agents.schema_utils import plan_result_limit_display, sql_row_limit_rule_5
from agents.trace_stream import append_trace
from agents.optimizer import clean_sql_text, repair_sql_with_feedback
from agents.sql_allowlist import validate_sql_against_schema


# Block DDL, DML, and dangerous operations
FORBIDDEN_SQL_PATTERNS = re.compile(
    r"\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)

# How many times the optimizer may regenerate SQL after a DB execution failure.
_EXECUTOR_MAX_SQL_RETRIES = int(os.getenv("EXECUTOR_MAX_SQL_RETRIES", "2"))


def _is_sql_execution_error(exc: BaseException) -> bool:
    """Return True for SQL-level errors the optimizer might fix (syntax, bad column, type mismatch).
    Return False for infrastructure errors where new SQL will not help (connection, auth, timeout).
    """
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    if any(k in name for k in ("connection", "operational", "interface", "timeout", "ssl")):
        return False
    if any(k in msg for k in (
        "connection refused", "connection timed out", "connection reset",
        "authentication failed", "permission denied", "access denied",
        "ssl", "network error", "socket", "could not connect",
    )):
        return False
    return True

# Sample / CSV-imported KB SQL often uses this placeholder; substitute at execute time from .env.
_KB_BQ_PROJECT_PLACEHOLDER = "__BIGQUERY_PROJECT__"


def _resolve_bigquery_project_in_sql(sql: str, project_id: str) -> str:
    if _KB_BQ_PROJECT_PLACEHOLDER not in sql:
        return sql
    return sql.replace(_KB_BQ_PROJECT_PLACEHOLDER, project_id)


EXECUTOR_PROMPT_BIGQUERY = """Generate a BigQuery SQL query for the following analysis plan.

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}
- Result row limit: {result_limit_display}

Schema (dataset: {dataset}):
{schema_json}

Few-shot example:
Input intent: "Average order value by month for completed orders in 2024"
Output SQL:
SELECT
  DATE_TRUNC(order_date, MONTH) AS month,
  AVG(total_amount) AS avg_order_value
FROM `{project}.{dataset}.orders`
WHERE status = 'completed' AND order_date >= DATE '2024-01-01' AND order_date < DATE '2025-01-01'
GROUP BY month
ORDER BY month;

Rules:
1. Use standard BigQuery SQL. Table names: `{project}.{dataset}.table_name`
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs. The schema JSON includes a top-level `relationships` array — follow it for join paths.
4. For date filters, use EXTRACT or DATE functions. If period is "last_quarter", use DATE_SUB and DATE_TRUNC. Respect `data_range` on date columns in the schema when filtering.
5. {row_limit_rule_5}
6. Match SQL function to intent. If user asks for averages/mean, use AVG() (never SUM()).
7. Return ONLY the SQL query, no explanation. No markdown code blocks.
"""

EXECUTOR_PROMPT_POSTGRES = """Generate a PostgreSQL SQL query for the following analysis plan.

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}
- Result row limit: {result_limit_display}

Schema (schema: {schema}):
{schema_json}

Few-shot example:
Input intent: "Average order value by month for completed orders in 2024"
Output SQL:
SELECT
  DATE_TRUNC('month', order_date) AS month,
  AVG(total_amount) AS avg_order_value
FROM "{schema}".orders
WHERE status = 'completed' AND order_date >= DATE '2024-01-01' AND order_date < DATE '2025-01-01'
GROUP BY month
ORDER BY month;

Rules:
1. Use standard PostgreSQL SQL. Table names: "{schema}".table_name or schema.table_name
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs. The schema JSON includes a top-level `relationships` array — follow it for join paths.
4. For date filters, use DATE_TRUNC, INTERVAL, or CURRENT_DATE. If period is "last_quarter", use DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '1 quarter'. Respect `data_range` on date columns in the schema when filtering.
5. {row_limit_rule_5}
6. Match SQL function to intent. If user asks for averages/mean, use AVG() (never SUM()).
7. Return ONLY the SQL query, no explanation. No markdown code blocks.
"""


@observe(name="sql-execution", as_type="span")
def _run_sql(connector, sql: str):
    safe_update_current_span(
        input={"sql": sql, "dialect": connector.dialect},
    )
    results = connector.execute(sql)
    safe_update_current_span(
        output={"row_count": len(results)},
    )
    return results


@observe(name="date-range-diagnostic", as_type="span")
def _run_date_diagnostic(connector, schema: dict):
    data_range, reason = connector.run_date_range_diagnostic(schema)
    safe_update_current_span(
        output={"data_range": data_range, "reason": reason},
    )
    return data_range, reason


def run_executor(state: dict) -> dict:
    """Query Execution Agent: generate SQL, validate, execute on BigQuery."""
    plan = state.get("plan")
    nearest_plan = state.get("nearest_plan")
    data_feasibility = state.get("data_feasibility", "none")
    trace = state.get("trace", [])

    append_trace(
        trace,
        TraceEntry(
            agent="executor",
            status="info",
            message=(
                "Preparing to execute the approved query..."
                if state.get("sql")
                else "Preparing to generate and execute SQL..."
            ),
        ).model_dump(),
    )

    if data_feasibility == "none":
        append_trace(
            trace,
            TraceEntry(agent="executor", status="info", message="Skipped – no feasible data").model_dump(),
        )
        return {"trace": trace}

    # Use nearest_plan if partial, else plan
    effective_plan = nearest_plan if data_feasibility == "partial" and nearest_plan else plan
    if not effective_plan:
        append_trace(
            trace,
            TraceEntry(agent="executor", status="error", message="No plan available").model_dump(),
        )
        return {"trace": trace}

    ds = (state.get("data_source_label") or "").strip()
    conn_msg = "Connecting to database..."
    if ds:
        conn_msg = f"Connecting to database ({ds})..."
    append_trace(
        trace,
        TraceEntry(agent="executor", status="info", message=conn_msg).model_dump()
    )

    connector = get_effective_connector(state)

    if not connector:
        append_trace(
            trace,
            TraceEntry(
                agent="executor",
                status="error",
                message="No database configured. Set BIGQUERY_PROJECT_ID or DATABASE_TYPE=postgres with POSTGRES_URL.",
            ).model_dump(),
        )
        return {"trace": trace}

    sql = state.get("sql")
    if not sql:
        append_trace(
            trace,
            TraceEntry(agent="executor", status="info", message="Generating SQL from analysis plan...").model_dump(),
        )
        hints = state.get("runtime_connection_hints") or {}
        project_id = hints.get("bigquery_project") or os.getenv("BIGQUERY_PROJECT_ID")
        dataset_id = hints.get("bigquery_dataset") or os.getenv("BIGQUERY_DATASET", "retail_data")
        schema = get_effective_schema(state)
        schema_json = json.dumps(schema, indent=2)
        metrics = effective_plan.get("metrics", [])
        dimensions = effective_plan.get("dimensions", [])
        filters = effective_plan.get("filters", {})
        rld = plan_result_limit_display(effective_plan)
        rlr = sql_row_limit_rule_5(effective_plan)

        llm = get_llm()
        dialect = connector.dialect
        if dialect == "postgres":
            schema_name = hints.get("postgres_schema") or os.getenv("POSTGRES_SCHEMA", "public")
            prompt = get_prompt("datapilot-executor-postgres", EXECUTOR_PROMPT_POSTGRES).format(
                metrics=metrics,
                dimensions=dimensions,
                filters=json.dumps(filters),
                result_limit_display=rld,
                row_limit_rule_5=rlr,
                schema_json=schema_json,
                schema=schema_name,
            )
        else:
            prompt = get_prompt("datapilot-executor-bigquery", EXECUTOR_PROMPT_BIGQUERY).format(
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
        sql = clean_sql_text(coerce_ai_text(response))
        correction_prompt = prompt
    else:
        src = (
            "knowledge base"
            if state.get("from_query_cache_adapt")
            else "Optimizer"
        )
        append_trace(
            trace,
            TraceEntry(agent="executor", status="info", message=f"Using SQL from {src}...").model_dump(),
        )
        schema = get_effective_schema(state)
        correction_prompt = (
            f"Validate and repair this {connector.dialect} SQL against the provided schema if needed."
        )

    try:
        if FORBIDDEN_SQL_PATTERNS.search(sql):
            append_trace(
                trace,
                TraceEntry(agent="executor", status="error", message="SQL contains forbidden operations").model_dump(),
            )
            return {"trace": trace}

        valid, validation_error = validate_sql_against_schema(sql, schema)
        if not valid:
            append_trace(
                trace,
                TraceEntry(
                    agent="executor",
                    status="info",
                    message=f"Schema validation failed before execution, applying one correction pass: {validation_error}",
                ).model_dump(),
            )
            llm = get_llm()
            sql = repair_sql_with_feedback(
                llm=llm,
                dialect=connector.dialect,
                original_prompt=correction_prompt,
                bad_sql=sql,
                schema_json=json.dumps(schema, indent=2),
                validation_error=validation_error or "unknown validation issue",
            )
            valid, validation_error = validate_sql_against_schema(sql, schema)
            if not valid:
                append_trace(
                    trace,
                    TraceEntry(
                        agent="executor",
                        status="error",
                        message=f"SQL failed schema validation after correction: {validation_error}",
                    ).model_dump(),
                )
                return {"trace": trace}

        append_trace(
            trace,
            TraceEntry(agent="executor", status="info", message="Executing query on database...").model_dump(),
        )

        if connector.dialect == "bigquery" and _KB_BQ_PROJECT_PLACEHOLDER in sql:
            project_id = (getattr(connector, "project_id", None) or os.getenv("BIGQUERY_PROJECT_ID") or "").strip()
            if not project_id or project_id == "your-gcp-project-id":
                append_trace(
                    trace,
                    TraceEntry(
                        agent="executor",
                        status="error",
                        message=(
                            f"SQL contains {_KB_BQ_PROJECT_PLACEHOLDER}; set BIGQUERY_PROJECT_ID in .env "
                            "to your real GCP project id (or replace the placeholder in the knowledge base SQL)."
                        ),
                    ).model_dump(),
                )
                return {"trace": trace}
            sql = _resolve_bigquery_project_in_sql(sql, project_id)

        raw_results = _run_sql(connector, sql)

        append_trace(
            trace,
            TraceEntry(
                agent="executor",
                status="success",
                message=f"Executed query, {len(raw_results)} rows",
                output={"sql": sql, "row_count": len(raw_results)},
            ).model_dump(),
        )

        update = {"sql": sql, "raw_results": raw_results, "execution_error": None, "trace": trace}

        # When the query returns 0 rows, always load warehouse date coverage so visualization can explain
        # empty results. (Planner often encodes years only in SQL — not in plan.filters — so we must not
        # gate diagnostics on start_date/end_date/period keys.)
        if len(raw_results) == 0:
            data_range, empty_result_reason = _run_date_diagnostic(connector, schema)
            if data_range:
                update["data_range"] = data_range
            if empty_result_reason:
                update["empty_result_reason"] = empty_result_reason

        return update
    except Exception as e:
        retry_count = state.get("executor_retry_count", 0)
        err_msg = str(e)
        # Build error context: include a snippet of the failing SQL so the optimizer
        # can see exactly what it generated and what the database rejected.
        sql_preview = (sql or "")[:600] + ("..." if len(sql or "") > 600 else "")
        error_detail = (
            f"SQL that failed:\n{sql_preview}\n\nDatabase error:\n{err_msg}"
            if sql_preview
            else f"Database error:\n{err_msg}"
        )
        append_trace(
            trace,
            TraceEntry(agent="executor", status="error", message=err_msg).model_dump(),
        )
        if _is_sql_execution_error(e) and retry_count < _EXECUTOR_MAX_SQL_RETRIES:
            # SQL-level error — send back to optimizer_prepare for correction.
            append_trace(
                trace,
                TraceEntry(
                    agent="executor",
                    status="info",
                    message=(
                        f"SQL execution failed (attempt {retry_count + 1}/{_EXECUTOR_MAX_SQL_RETRIES + 1}). "
                        "Sending error back to the optimizer for correction..."
                    ),
                ).model_dump(),
            )
            return {
                "execution_error": error_detail,
                "executor_retry_count": retry_count + 1,
                "sql": None,  # Force optimizer_prepare to regenerate
                "trace": trace,
            }
        # Infrastructure error or retry limit reached — surface the error and stop.
        return {
            "execution_error": error_detail,
            "executor_retry_count": _EXECUTOR_MAX_SQL_RETRIES + 1,  # Sentinel: no more retries
            "trace": trace,
        }
