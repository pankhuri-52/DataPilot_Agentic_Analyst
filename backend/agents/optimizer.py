"""
Optimizer Agent – generates SQL per dialect, validates, estimates cost (BigQuery), and asks user to confirm before execution.
Uses official BigQuery/Postgres SQL docs best practices. Calls interrupt() for execute confirmation.

Split into prepare + gate nodes so LangGraph resume does not re-run the whole optimizer: after HITL approval,
only optimizer_gate restarts (cheap); SQL generation and dry-run stay in optimizer_prepare (runs once).
"""
import os
import json
import re
from datetime import datetime, timezone
from langgraph.types import interrupt

from llm import get_gemini, invoke_with_retry
from langfuse_setup import get_prompt
from langfuse import observe, get_client as _get_langfuse_client
from agents.state import TraceEntry
from agents.context import get_effective_connector, get_effective_schema
from agents.schema_utils import plan_result_limit_display, sql_row_limit_rule_5
from agents.trace_stream import append_trace
from agents.sql_allowlist import extract_known_metadata_tables, validate_sql_against_schema
from db.bigquery_connector import format_bigquery_cost_estimate_for_user


FORBIDDEN_SQL_PATTERNS = re.compile(
    r"\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)

_DIALECT_DOCS = {
    "bigquery": "https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax",
    "postgres": "https://www.postgresql.org/docs/current/sql-select.html",
}

_FEW_SHOT_BIGQUERY = """Few-shot examples:
Input intent: "Average order value by month for completed orders in 2024"
Output SQL:
SELECT
  DATE_TRUNC(order_date, MONTH) AS month,
  AVG(total_amount) AS avg_order_value
FROM `{project}.{dataset}.orders`
WHERE status = 'completed' AND order_date >= DATE '2024-01-01' AND order_date < DATE '2025-01-01'
GROUP BY month
ORDER BY month;
"""

_FEW_SHOT_POSTGRES = """Few-shot examples:
Input intent: "Average order value by month for completed orders in 2024"
Output SQL:
SELECT
  DATE_TRUNC('month', order_date) AS month,
  AVG(total_amount) AS avg_order_value
FROM "{schema}".orders
WHERE status = 'completed' AND order_date >= DATE '2024-01-01' AND order_date < DATE '2025-01-01'
GROUP BY month
ORDER BY month;
"""

OPTIMIZER_PROMPT_BIGQUERY = """Generate a BigQuery SQL query following official BigQuery best practices.
Reference: https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}
- Result row limit: {result_limit_display}

Schema (dataset: {dataset}):
{schema_json}

{few_shot}

Rules:
1. Use standard BigQuery SQL. Table names: `{project}.{dataset}.table_name`
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs. The schema JSON includes a top-level `relationships` array (foreign keys such as products.brand_id -> brands.brand_id) — follow it for join paths.
4. For date filters, use EXTRACT or DATE functions. If period is "last_quarter", use DATE_SUB and DATE_TRUNC. Respect `data_range` on date columns in the schema when filtering.
5. {row_limit_rule_5}
6. Match SQL function to intent. If user asks for averages/mean, use AVG() (never SUM()).
7. Return ONLY the SQL query, no explanation. No markdown code blocks.
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

{few_shot}

Rules:
1. Use standard PostgreSQL SQL. Table names: "{schema}".table_name or schema.table_name
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs. The schema JSON includes a top-level `relationships` array — follow it for join paths.
4. For date filters, use DATE_TRUNC, INTERVAL, or CURRENT_DATE. If period is "last_quarter", use DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '1 quarter'. Respect `data_range` on date columns in the schema when filtering.
5. {row_limit_rule_5}
6. Match SQL function to intent. If user asks for averages/mean, use AVG() (never SUM()).
7. Return ONLY the SQL query, no explanation. No markdown code blocks.
"""


@observe(name="bq-dry-run-estimate", as_type="span")
def _bq_dry_run(connector, sql: str):
    _get_langfuse_client().update_current_span(
        input={"sql": sql, "dialect": "bigquery"},
    )
    bytes_scanned, estimated_cost = connector.dry_run_estimate(sql)
    _get_langfuse_client().update_current_span(
        output={"bytes_scanned": bytes_scanned, "estimated_cost_usd": estimated_cost},
    )
    return bytes_scanned, estimated_cost


@observe(name="postgres-size-estimate", as_type="span")
def _postgres_estimate_bytes(connector, sql: str, schema: dict) -> int | None:
    """Estimate total bytes by summing pg_total_relation_size for tables in the SQL."""
    tables = extract_known_metadata_tables(sql, schema)
    if not tables:
        return None
    total = 0
    try:
        with connector.engine.connect() as conn:
            for tbl in tables:
                row = conn.execute(
                    __import__("sqlalchemy").text(
                        "SELECT pg_total_relation_size(:t) AS b"
                    ),
                    {"t": tbl},
                ).fetchone()
                if row and row[0]:
                    total += int(row[0])
    except Exception:
        return None
    return total if total > 0 else None


def _csv_estimate_bytes(schema: dict) -> int | None:
    """Estimate CSV size from row_count * avg_row_bytes heuristic stored in schema."""
    tables = schema.get("tables") or []
    total = 0
    for t in tables:
        if not isinstance(t, dict):
            continue
        rows = t.get("row_count") or 0
        cols = len(t.get("columns") or [])
        # Rough estimate: 30 bytes per cell
        total += int(rows) * max(cols, 1) * 30
    return total if total > 0 else None


def clean_sql_text(raw_sql: str) -> str:
    sql = (raw_sql or "").strip()
    if sql.startswith("```"):
        sql = re.sub(r"^```\w*\n?", "", sql)
        sql = re.sub(r"\n?```$", "", sql)
    return sql.strip()


def repair_sql_with_feedback(
    *,
    llm,
    dialect: str,
    original_prompt: str,
    bad_sql: str,
    schema_json: str,
    validation_error: str,
) -> str:
    docs = _DIALECT_DOCS.get(dialect, "")
    correction_prompt = f"""You are fixing SQL for {dialect}.
Dialect reference: {docs}

Validation error:
{validation_error}

Original SQL generation prompt:
{original_prompt}

Schema JSON:
{schema_json}

Invalid SQL:
{bad_sql}

Return corrected SQL only. Keep semantics intact and stay SELECT-only."""
    response = invoke_with_retry(llm, correction_prompt)
    return clean_sql_text(response.content if hasattr(response, "content") else str(response))


def run_optimizer_prepare(state: dict) -> dict:
    """Generate SQL, validate, dry-run estimate. Persists pending_* for optimizer_gate (no interrupt here)."""
    plan = state.get("plan")
    nearest_plan = state.get("nearest_plan")
    data_feasibility = state.get("data_feasibility", "none")
    trace = state.get("trace", [])
    regen_hint = (state.get("optimizer_regenerate_hint") or "").strip()
    user_query = (state.get("query") or "").strip()

    append_trace(
        trace,
        TraceEntry(agent="optimizer", status="info", message="Generating SQL from analysis plan...").model_dump(),
    )

    if data_feasibility == "none":
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="info", message="Skipped – no feasible data").model_dump(),
        )
        return _clear_regen_hint_if_retry(regen_hint, {"trace": trace})

    effective_plan = nearest_plan if data_feasibility == "partial" and nearest_plan else plan
    if not effective_plan:
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message="No plan available").model_dump(),
        )
        return _clear_regen_hint_if_retry(regen_hint, {"trace": trace})

    connector = get_effective_connector(state)

    if not connector:
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message="No database configured.").model_dump(),
        )
        return _clear_regen_hint_if_retry(regen_hint, {"trace": trace})

    schema = get_effective_schema(state)
    schema_json = json.dumps(schema, indent=2)
    metrics = effective_plan.get("metrics", [])
    dimensions = effective_plan.get("dimensions", [])
    filters = effective_plan.get("filters", {})
    rld = plan_result_limit_display(effective_plan)
    rlr = sql_row_limit_rule_5(effective_plan)

    try:
        llm = get_gemini()
        dialect = connector.dialect
        hints = state.get("runtime_connection_hints") or {}
        if dialect == "postgres":
            schema_name = hints.get("postgres_schema") or os.getenv("POSTGRES_SCHEMA", "public")
            prompt = get_prompt("datapilot-optimizer-postgres", OPTIMIZER_PROMPT_POSTGRES).format(
                metrics=metrics,
                dimensions=dimensions,
                filters=json.dumps(filters),
                result_limit_display=rld,
                row_limit_rule_5=rlr,
                schema_json=schema_json,
                schema=schema_name,
                few_shot=_FEW_SHOT_POSTGRES.format(schema=schema_name),
            )
        else:
            project_id = hints.get("bigquery_project") or os.getenv("BIGQUERY_PROJECT_ID")
            dataset_id = hints.get("bigquery_dataset") or os.getenv("BIGQUERY_DATASET", "retail_data")
            prompt = get_prompt("datapilot-optimizer-bigquery", OPTIMIZER_PROMPT_BIGQUERY).format(
                metrics=metrics,
                dimensions=dimensions,
                filters=json.dumps(filters),
                result_limit_display=rld,
                row_limit_rule_5=rlr,
                schema_json=schema_json,
                project=project_id,
                dataset=dataset_id,
                few_shot=_FEW_SHOT_BIGQUERY.format(project=project_id, dataset=dataset_id),
            )
        if regen_hint:
            qline = f"\nOriginal user question: {user_query}\n" if user_query else ""
            prompt = f"{prompt}\n\nCorrection — the user declined the previous SQL without running it:{qline}{regen_hint}\n"
        relevance_hint = (state.get("relevance_check_hint") or "").strip()
        if relevance_hint:
            append_trace(
                trace,
                TraceEntry(
                    agent="optimizer",
                    status="info",
                    message="Rewriting SQL — previous results failed relevance check...",
                ).model_dump(),
            )
            prompt = (
                f"{prompt}\n\n"
                f"RELEVANCE FAILURE — CORRECTION REQUIRED:\n"
                f"The previous SQL executed successfully but its results did not answer the user's question. "
                f"{relevance_hint}\n"
            )

        execution_error = (state.get("execution_error") or "").strip()
        if execution_error:
            retry_num = state.get("executor_retry_count", 1)
            append_trace(
                trace,
                TraceEntry(
                    agent="optimizer",
                    status="info",
                    message=f"Rewriting SQL to fix execution error (retry {retry_num})...",
                ).model_dump(),
            )
            prompt = (
                f"{prompt}\n\n"
                f"EXECUTION FAILURE — CORRECTION REQUIRED (retry {retry_num}):\n"
                f"The SQL below was executed against the live database and was rejected. "
                f"Rewrite it to fix the error while still answering the original question.\n\n"
                f"{execution_error}\n"
            )
        response = invoke_with_retry(llm, prompt)
        sql = clean_sql_text(response.content if hasattr(response, "content") else str(response))

        if FORBIDDEN_SQL_PATTERNS.search(sql):
            append_trace(
                trace,
                TraceEntry(
                    agent="optimizer",
                    status="error",
                    message="Generated SQL contains forbidden operations",
                ).model_dump(),
            )
            return _clear_regen_hint_if_retry(regen_hint, {"trace": trace})

        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="info", message="SQL generated, validating...").model_dump(),
        )
        valid, validation_error = validate_sql_against_schema(sql, schema)
        if not valid:
            append_trace(
                trace,
                TraceEntry(
                    agent="optimizer",
                    status="info",
                    message=f"Schema validation failed, applying one correction pass: {validation_error}",
                ).model_dump(),
            )
            sql = repair_sql_with_feedback(
                llm=llm,
                dialect=dialect,
                original_prompt=prompt,
                bad_sql=sql,
                schema_json=schema_json,
                validation_error=validation_error or "unknown validation issue",
            )
            valid, validation_error = validate_sql_against_schema(sql, schema)
            if not valid:
                append_trace(
                    trace,
                    TraceEntry(
                        agent="optimizer",
                        status="error",
                        message=f"SQL failed schema validation after correction: {validation_error}",
                    ).model_dump(),
                )
                return _clear_regen_hint_if_retry(regen_hint, {"trace": trace})

        bytes_scanned = None
        estimated_cost = None
        if dialect == "bigquery" and hasattr(connector, "dry_run_estimate"):
            try:
                bytes_scanned, estimated_cost = _bq_dry_run(connector, sql)
                cost_msg = format_bigquery_cost_estimate_for_user(bytes_scanned, estimated_cost)
                append_trace(
                    trace,
                    TraceEntry(
                        agent="optimizer",
                        status="info",
                        message=cost_msg,
                        output={
                            "bytes_scanned": bytes_scanned,
                            "estimated_cost": estimated_cost,
                            "cost_summary": cost_msg,
                        },
                    ).model_dump(),
                )
            except Exception as e:
                append_trace(
                    trace,
                    TraceEntry(agent="optimizer", status="info", message=f"Dry run skipped: {e}").model_dump(),
                )
        elif dialect == "postgres":
            try:
                bytes_scanned = _postgres_estimate_bytes(connector, sql, schema)
                if bytes_scanned is not None:
                    estimated_cost = bytes_scanned / (1024 ** 3) * 0.00023  # ~$0.23/GB comparable rate
                    mb = bytes_scanned / (1024**2)
                    usd = f"{max(estimated_cost, 0.0):.4f}"
                    b_fmt = f"{bytes_scanned:,}"
                    pg_msg = (
                        f"~{mb:.2f} MB referenced ({b_fmt} bytes, heuristic).\n"
                        f"Estimated comparable charge: ${usd} USD (display only — not a live warehouse dry run).\n"
                        "How: sum of referenced table sizes × ~$0.23/GiB as a rough scale; your provider may bill differently."
                    )
                    append_trace(
                        trace,
                        TraceEntry(
                            agent="optimizer",
                            status="info",
                            message=pg_msg,
                            output={
                                "bytes_scanned": bytes_scanned,
                                "estimated_cost": estimated_cost,
                                "cost_summary": pg_msg,
                            },
                        ).model_dump(),
                    )
            except Exception as e:
                append_trace(
                    trace,
                    TraceEntry(agent="optimizer", status="info", message=f"Size estimate skipped: {e}").model_dump(),
                )
        elif dialect in ("csv", "csv_upload"):
            try:
                bytes_scanned = _csv_estimate_bytes(schema)
                if bytes_scanned is not None:
                    append_trace(
                        trace,
                        TraceEntry(
                            agent="optimizer",
                            status="info",
                            message=f"File size estimate: ~{bytes_scanned / (1024**2):.2f} MB",
                            output={"bytes_scanned": bytes_scanned, "estimated_cost": 0.0},
                        ).model_dump(),
                    )
                    estimated_cost = 0.0
            except Exception:
                pass

        out: dict = {
            "trace": trace,
            "pending_execute_sql": sql,
            "pending_execute_bytes": bytes_scanned,
            "pending_execute_cost": estimated_cost,
            "pending_execute_dialect": dialect,
            # Stamped here so the checkpoint carries the interrupt creation time;
            # graph_manager uses its own registry for fast O(1) lookups.
            "interrupt_created_at": datetime.now(timezone.utc).isoformat(),
            # Clear relevance hint once consumed so it doesn't re-trigger on subsequent passes.
            "relevance_check_hint": None,
        }
        return _clear_regen_hint_if_retry(regen_hint, out)

    except Exception as e:
        err_type = type(e).__name__
        err_str = str(e)
        if "Interrupt" in err_type or "interrupt" in err_str.lower():
            raise
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message=str(e)).model_dump(),
        )
        return _clear_regen_hint_if_retry(regen_hint, {"trace": trace})


def _clear_pending_execute() -> dict:
    return {
        "pending_execute_sql": None,
        "pending_execute_bytes": None,
        "pending_execute_cost": None,
        "pending_execute_dialect": None,
    }


def _clear_regen_hint_if_retry(regen_hint: str, update: dict) -> dict:
    """Avoid optimizer_prepare ↔ gate loops if regeneration fails mid-prepare."""
    if regen_hint:
        update["optimizer_regenerate_hint"] = None
    return update


def run_optimizer_gate(state: dict) -> dict:
    """Human-in-the-loop: interrupt for execute approval. Runs alone on resume so LLM/dry-run are not repeated."""
    trace = state.get("trace", [])
    sql = state.get("pending_execute_sql")
    if not sql:
        return {}

    bytes_scanned = state.get("pending_execute_bytes")
    estimated_cost = state.get("pending_execute_cost")
    dialect = (state.get("pending_execute_dialect") or "bigquery").strip() or "bigquery"

    # ── Max cost ceiling ─────────────────────────────────────────────────────────
    _max_cost = float(os.getenv("MAX_QUERY_COST_USD", "10.0"))
    if estimated_cost is not None and estimated_cost > _max_cost:
        append_trace(
            trace,
            TraceEntry(
                agent="optimizer",
                status="error",
                message=(
                    f"Query blocked: estimated cost ${estimated_cost:.2f} exceeds the "
                    f"${_max_cost:.2f} limit. Try narrowing your date range or filters."
                ),
            ).model_dump(),
        )
        return {
            "trace": trace,
            **_clear_pending_execute(),
            "optimizer_decline_count": 0,
            "optimizer_regenerate_hint": None,
        }

    # Auto-approve when the optimizer is rewriting SQL after an execution failure.
    # We already asked the user once; interrupting them again for every correction attempt
    # is poor UX.  The cost ceiling above still applies even in auto-approve mode.
    execution_retry = bool((state.get("execution_error") or "").strip())
    skip_hil = os.getenv("DATAPILOT_SKIP_INTERRUPTS", "").strip().lower() in ("1", "true", "yes")
    if skip_hil or execution_retry:
        approved = True
    else:
        cost_summary = None
        if dialect == "bigquery" and bytes_scanned is not None and estimated_cost is not None:
            cost_summary = format_bigquery_cost_estimate_for_user(bytes_scanned, estimated_cost)
        elif dialect == "postgres" and bytes_scanned is not None and estimated_cost is not None:
            mb = bytes_scanned / (1024**2)
            usd = f"{max(estimated_cost, 0.0):.4f}"
            b_fmt = f"{bytes_scanned:,}"
            cost_summary = (
                f"~{mb:.2f} MB referenced ({b_fmt} bytes, heuristic).\n"
                f"Estimated comparable charge: ${usd} USD (display only — not a live dry run).\n"
                "How: referenced table sizes × ~$0.23/GiB for scale; not Postgres-specific billing."
            )
        interrupt_payload = {
            "reason": "execute_query",
            "sql": sql,
            "bytes_scanned": bytes_scanned,
            "estimated_cost": estimated_cost,
            "dialect": dialect,
            "cost_summary": cost_summary,
        }
        approved = interrupt(interrupt_payload)

    if not approved:
        declines = int(state.get("optimizer_decline_count") or 0) + 1
        if declines >= 2:
            append_trace(
                trace,
                TraceEntry(
                    agent="optimizer",
                    status="success",
                    message=(
                        "Stopped: you chose not to run the query again. "
                        "Start a new message or rephrase your question if you need a different approach."
                    ),
                ).model_dump(),
            )
            return {
                "trace": trace,
                **_clear_pending_execute(),
                "optimizer_decline_count": declines,
                "optimizer_regenerate_hint": None,
            }
        append_trace(
            trace,
            TraceEntry(
                agent="optimizer",
                status="info",
                message="You declined this SQL — generating a revised query aligned with your question…",
            ).model_dump(),
        )
        return {
            "trace": trace,
            **_clear_pending_execute(),
            "optimizer_decline_count": declines,
            "optimizer_regenerate_hint": (
                "The user rejected the proposed SQL without executing it. Re-read the original question and fix "
                "aggregations and labels (e.g. average/mean/per-unit → AVG(...); total/sum → SUM(...); count → COUNT(...)). "
                "Match the plan's metrics and dimensions. Return only a single corrected SELECT statement."
            ),
        }

    append_trace(
        trace,
        TraceEntry(
            agent="optimizer",
            status="success",
            message="User approved – proceeding to execution",
        ).model_dump(),
    )

    update: dict = {
        "sql": sql,
        "trace": trace,
        **_clear_pending_execute(),
        "optimizer_decline_count": 0,
        "optimizer_regenerate_hint": None,
    }
    if bytes_scanned is not None:
        update["bytes_scanned"] = bytes_scanned
    if estimated_cost is not None:
        update["estimated_cost"] = estimated_cost
    return update
