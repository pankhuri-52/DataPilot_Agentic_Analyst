"""
Query Execution Agent – generates SQL and executes on BigQuery.
"""
import os
import json
import re
from decimal import Decimal
from datetime import date, datetime
from pathlib import Path
from llm import get_gemini
from agents.state import TraceEntry


def _load_schema() -> dict:
    """Load static schema metadata."""
    backend_dir = Path(__file__).resolve().parent.parent
    schema_path = backend_dir / "schema" / "metadata.json"
    with open(schema_path, encoding="utf-8") as f:
        return json.load(f)


def _resolve_credentials_path():
    """Resolve GOOGLE_APPLICATION_CREDENTIALS to absolute path."""
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not path:
        return
    p = Path(path)
    if not p.is_absolute():
        project_root = Path(__file__).resolve().parent.parent.parent
        p = project_root / path
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(p.resolve())


# Block DDL, DML, and dangerous operations
FORBIDDEN_SQL_PATTERNS = re.compile(
    r"\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)


EXECUTOR_PROMPT = """Generate a BigQuery SQL query for the following analysis plan.

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


def run_executor(state: dict) -> dict:
    """Query Execution Agent: generate SQL, validate, execute on BigQuery."""
    plan = state.get("plan")
    nearest_plan = state.get("nearest_plan")
    data_feasibility = state.get("data_feasibility", "none")
    trace = state.get("trace", [])

    if data_feasibility == "none":
        trace.append(TraceEntry(agent="executor", status="info", message="Skipped – no feasible data").model_dump())
        return {"trace": trace}

    # Use nearest_plan if partial, else plan
    effective_plan = nearest_plan if data_feasibility == "partial" and nearest_plan else plan
    if not effective_plan:
        trace.append(TraceEntry(agent="executor", status="error", message="No plan available").model_dump())
        return {"trace": trace}

    project_id = os.getenv("BIGQUERY_PROJECT_ID")
    dataset_id = os.getenv("BIGQUERY_DATASET", "retail_data")
    if not project_id or project_id == "your-gcp-project-id":
        trace.append(TraceEntry(agent="executor", status="error", message="BigQuery not configured").model_dump())
        return {"trace": trace}

    _resolve_credentials_path()
    schema = _load_schema()
    schema_json = json.dumps(schema, indent=2)

    metrics = effective_plan.get("metrics", [])
    dimensions = effective_plan.get("dimensions", [])
    filters = effective_plan.get("filters", {})

    try:
        llm = get_gemini()
        prompt = EXECUTOR_PROMPT.format(
            metrics=metrics,
            dimensions=dimensions,
            filters=json.dumps(filters),
            schema_json=schema_json,
            project=project_id,
            dataset=dataset_id,
        )
        response = llm.invoke(prompt)
        sql = (response.content if hasattr(response, "content") else str(response)).strip()
        # Remove markdown code blocks if present
        if sql.startswith("```"):
            sql = re.sub(r"^```\w*\n?", "", sql)
            sql = re.sub(r"\n?```$", "", sql)
        sql = sql.strip()

        if FORBIDDEN_SQL_PATTERNS.search(sql):
            trace.append(TraceEntry(agent="executor", status="error", message="Generated SQL contains forbidden operations").model_dump())
            return {"trace": trace}

        from google.cloud import bigquery
        client = bigquery.Client(project=project_id)
        query_job = client.query(sql)
        rows = list(query_job.result(max_results=1000))

        def _serialize(v):
            if isinstance(v, Decimal):
                return float(v)
            if isinstance(v, (date, datetime)):
                return v.isoformat()
            return v

        raw_results = [{k: _serialize(v) for k, v in dict(row).items()} for row in rows]

        trace.append(
            TraceEntry(
                agent="executor",
                status="success",
                message=f"Executed query, {len(raw_results)} rows",
                output={"sql": sql, "row_count": len(raw_results)},
            ).model_dump()
        )

        return {"sql": sql, "raw_results": raw_results, "trace": trace}
    except Exception as e:
        trace.append(TraceEntry(agent="executor", status="error", message=str(e)).model_dump())
        return {"trace": trace}
