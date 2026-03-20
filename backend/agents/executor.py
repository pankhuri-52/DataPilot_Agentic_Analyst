"""
Query Execution Agent – executes SQL via generic DB connector.
Uses SQL from Optimizer when available; otherwise generates SQL (legacy path).
"""
import os
import json
import re
from llm import get_gemini
from agents.state import TraceEntry
from agents.schema_utils import load_schema


# Block DDL, DML, and dangerous operations
FORBIDDEN_SQL_PATTERNS = re.compile(
    r"\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)


EXECUTOR_PROMPT_BIGQUERY = """Generate a BigQuery SQL query for the following analysis plan.

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}

Schema (dataset: {dataset}):
{schema_json}

Rules:
1. Use standard BigQuery SQL. Table names: `{project}.{dataset}.table_name`
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs based on schema relationships.
4. For date filters, use EXTRACT or DATE functions. If period is "last_quarter", use DATE_SUB and DATE_TRUNC.
5. Limit results to 1000 rows (add LIMIT 1000).
6. Return ONLY the SQL query, no explanation. No markdown code blocks.
"""

EXECUTOR_PROMPT_POSTGRES = """Generate a PostgreSQL SQL query for the following analysis plan.

Analysis plan:
- Metrics: {metrics}
- Dimensions: {dimensions}
- Filters: {filters}

Schema (schema: {schema}):
{schema_json}

Rules:
1. Use standard PostgreSQL SQL. Table names: "{schema}".table_name or schema.table_name
2. Only SELECT statements. No CREATE, INSERT, UPDATE, DELETE.
3. Use proper JOINs based on schema relationships.
4. For date filters, use DATE_TRUNC, INTERVAL, or CURRENT_DATE. If period is "last_quarter", use DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '1 quarter'.
5. Limit results to 1000 rows (add LIMIT 1000).
6. Return ONLY the SQL query, no explanation. No markdown code blocks.
"""


def run_executor(state: dict) -> dict:
    """Query Execution Agent: generate SQL, validate, execute on BigQuery."""
    plan = state.get("plan")
    nearest_plan = state.get("nearest_plan")
    data_feasibility = state.get("data_feasibility", "none")
    trace = state.get("trace", [])

    trace.append(
        TraceEntry(agent="executor", status="info", message="Preparing to generate and execute SQL...").model_dump()
    )

    if data_feasibility == "none":
        trace.append(TraceEntry(agent="executor", status="info", message="Skipped – no feasible data").model_dump())
        return {"trace": trace}

    # Use nearest_plan if partial, else plan
    effective_plan = nearest_plan if data_feasibility == "partial" and nearest_plan else plan
    if not effective_plan:
        trace.append(TraceEntry(agent="executor", status="error", message="No plan available").model_dump())
        return {"trace": trace}

    trace.append(
        TraceEntry(agent="executor", status="info", message="Connecting to database...").model_dump()
    )

    try:
        from db.factory import get_connector
        connector = get_connector()
    except ImportError:
        connector = None

    if not connector:
        trace.append(TraceEntry(agent="executor", status="error", message="No database configured. Set BIGQUERY_PROJECT_ID or DATABASE_TYPE=postgres with POSTGRES_URL.").model_dump())
        return {"trace": trace}

    sql = state.get("sql")
    if not sql:
        trace.append(
            TraceEntry(agent="executor", status="info", message="Generating SQL from analysis plan...").model_dump()
        )
        project_id = os.getenv("BIGQUERY_PROJECT_ID")
        dataset_id = os.getenv("BIGQUERY_DATASET", "retail_data")
        schema = load_schema()
        schema_json = json.dumps(schema, indent=2)
        metrics = effective_plan.get("metrics", [])
        dimensions = effective_plan.get("dimensions", [])
        filters = effective_plan.get("filters", {})

        llm = get_gemini()
        dialect = connector.dialect
        if dialect == "postgres":
            schema_name = os.getenv("POSTGRES_SCHEMA", "public")
            prompt = EXECUTOR_PROMPT_POSTGRES.format(
                metrics=metrics,
                dimensions=dimensions,
                filters=json.dumps(filters),
                schema_json=schema_json,
                schema=schema_name,
            )
        else:
            prompt = EXECUTOR_PROMPT_BIGQUERY.format(
                metrics=metrics,
                dimensions=dimensions,
                filters=json.dumps(filters),
                schema_json=schema_json,
                project=project_id,
                dataset=dataset_id,
            )
        response = llm.invoke(prompt)
        sql = (response.content if hasattr(response, "content") else str(response)).strip()
        if sql.startswith("```"):
            sql = re.sub(r"^```\w*\n?", "", sql)
            sql = re.sub(r"\n?```$", "", sql)
        sql = sql.strip()
    else:
        trace.append(
            TraceEntry(agent="executor", status="info", message="Using SQL from Optimizer...").model_dump()
        )
        schema = load_schema()

    try:
        if FORBIDDEN_SQL_PATTERNS.search(sql):
            trace.append(TraceEntry(agent="executor", status="error", message="SQL contains forbidden operations").model_dump())
            return {"trace": trace}

        trace.append(
            TraceEntry(agent="executor", status="info", message="Executing query on database...").model_dump()
        )

        raw_results = connector.execute(sql)

        trace.append(
            TraceEntry(
                agent="executor",
                status="success",
                message=f"Executed query, {len(raw_results)} rows",
                output={"sql": sql, "row_count": len(raw_results)},
            ).model_dump()
        )

        update = {"sql": sql, "raw_results": raw_results, "trace": trace}

        # Dynamic diagnostics: when 0 rows and plan has date filters, run diagnostic query
        if len(raw_results) == 0 and effective_plan.get("filters"):
            filters = effective_plan.get("filters", {})
            has_date_filter = any(
                k in filters for k in ("start_date", "end_date", "period", "date_range")
            )
            if has_date_filter:
                data_range, empty_result_reason = connector.run_date_range_diagnostic(schema)
                if data_range:
                    update["data_range"] = data_range
                if empty_result_reason:
                    update["empty_result_reason"] = empty_result_reason

        return update
    except Exception as e:
        trace.append(TraceEntry(agent="executor", status="error", message=str(e)).model_dump())
        return {"trace": trace}
