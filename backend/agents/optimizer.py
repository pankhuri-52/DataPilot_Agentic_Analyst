"""
Optimizer Agent – generates SQL per dialect, validates, estimates cost (BigQuery), and asks user to confirm before execution.
Uses official BigQuery/Postgres SQL docs best practices. Calls interrupt() for execute confirmation.

Split into prepare + gate nodes so LangGraph resume does not re-run the whole optimizer: after HITL approval,
only optimizer_gate restarts (cheap); SQL generation and dry-run stay in optimizer_prepare (runs once).
"""
import os
import json
import re
from langgraph.types import interrupt

from llm import get_gemini, invoke_with_retry
from agents.state import TraceEntry
from agents.context import get_effective_connector, get_effective_schema
from agents.schema_utils import plan_result_limit_display, sql_row_limit_rule_5
from agents.trace_stream import append_trace


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


def _extract_main_tables(sql: str, schema: dict) -> list[str]:
    """Best-effort extraction of table names referenced in SQL (lowercase, unquoted)."""
    known = {t["name"].lower() for t in (schema.get("tables") or []) if isinstance(t, dict) and t.get("name")}
    found = []
    for token in re.findall(r'(?:FROM|JOIN)\s+"?(\w+)"?', sql, re.IGNORECASE):
        t = token.strip('"').lower()
        if t in known and t not in found:
            found.append(t)
    return found


def _postgres_estimate_bytes(connector, sql: str, schema: dict) -> int | None:
    """Estimate total bytes by summing pg_total_relation_size for tables in the SQL."""
    tables = _extract_main_tables(sql, schema)
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


def _schema_table_columns(schema: dict) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for t in schema.get("tables") or []:
        if not isinstance(t, dict):
            continue
        tname = str(t.get("name") or "").strip().lower()
        cols = t.get("columns")
        if not tname or not isinstance(cols, list):
            continue
        colset: set[str] = set()
        for c in cols:
            if not isinstance(c, dict):
                continue
            cname = str(c.get("name") or "").strip().lower()
            if cname:
                colset.add(cname)
        out[tname] = colset
    return out


def validate_sql_against_schema(sql: str, schema: dict) -> tuple[bool, str | None]:
    table_cols = _schema_table_columns(schema)
    if not table_cols:
        return False, "Schema catalog is empty; no tables available."

    alias_map: dict[str, str] = {}
    table_hits = 0
    for m in re.finditer(
        r"\b(?:FROM|JOIN)\s+([`\"\w\.\-]+)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?",
        sql,
        re.IGNORECASE,
    ):
        raw_table = (m.group(1) or "").strip()
        alias = (m.group(2) or "").strip().lower()
        base_table = raw_table.replace("`", "").replace('"', "").split(".")[-1].lower()
        if base_table not in table_cols:
            return False, f"Unknown table referenced: {base_table}"
        table_hits += 1
        alias_map[base_table] = base_table
        if alias:
            alias_map[alias] = base_table

    if table_hits == 0:
        return False, "SQL has no FROM/JOIN table references."

    for alias, col in re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b", sql):
        a = alias.lower()
        c = col.lower()
        if a in alias_map:
            table_name = alias_map[a]
            if c not in table_cols.get(table_name, set()):
                return False, f"Unknown column '{col}' on table '{table_name}'."
        elif a in table_cols and c not in table_cols[a]:
            return False, f"Unknown column '{col}' on table '{a}'."
    return True, None


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

    append_trace(
        trace,
        TraceEntry(agent="optimizer", status="info", message="Generating SQL from analysis plan...").model_dump(),
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

    connector = get_effective_connector(state)

    if not connector:
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message="No database configured.").model_dump(),
        )
        return {"trace": trace}

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
            prompt = OPTIMIZER_PROMPT_POSTGRES.format(
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
            prompt = OPTIMIZER_PROMPT_BIGQUERY.format(
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
            return {"trace": trace}

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
                return {"trace": trace}

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
        elif dialect == "postgres":
            try:
                bytes_scanned = _postgres_estimate_bytes(connector, sql, schema)
                if bytes_scanned is not None:
                    estimated_cost = bytes_scanned / (1024 ** 3) * 0.00023  # ~$0.23/GB comparable rate
                    append_trace(
                        trace,
                        TraceEntry(
                            agent="optimizer",
                            status="info",
                            message=f"Size estimate: ~{bytes_scanned / (1024**2):.2f} MB",
                            output={"bytes_scanned": bytes_scanned, "estimated_cost": estimated_cost},
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

        return {
            "trace": trace,
            "pending_execute_sql": sql,
            "pending_execute_bytes": bytes_scanned,
            "pending_execute_cost": estimated_cost,
            "pending_execute_dialect": dialect,
        }

    except Exception as e:
        err_type = type(e).__name__
        err_str = str(e)
        if "Interrupt" in err_type or "interrupt" in err_str.lower():
            raise
        append_trace(
            trace,
            TraceEntry(agent="optimizer", status="error", message=str(e)).model_dump(),
        )
        return {"trace": trace}


def _clear_pending_execute() -> dict:
    return {
        "pending_execute_sql": None,
        "pending_execute_bytes": None,
        "pending_execute_cost": None,
        "pending_execute_dialect": None,
    }


def run_optimizer_gate(state: dict) -> dict:
    """Human-in-the-loop: interrupt for execute approval. Runs alone on resume so LLM/dry-run are not repeated."""
    trace = state.get("trace", [])
    sql = state.get("pending_execute_sql")
    if not sql:
        return {}

    bytes_scanned = state.get("pending_execute_bytes")
    estimated_cost = state.get("pending_execute_cost")
    dialect = (state.get("pending_execute_dialect") or "bigquery").strip() or "bigquery"

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
        return {"trace": trace, **_clear_pending_execute()}

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
    }
    if bytes_scanned is not None:
        update["bytes_scanned"] = bytes_scanned
    if estimated_cost is not None:
        update["estimated_cost"] = estimated_cost
    return update
