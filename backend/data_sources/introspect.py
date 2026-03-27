"""Build metadata.json-shaped catalogs from live databases."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def _pg_type_to_meta(pg_type: str) -> str:
    t = (pg_type or "").lower()
    if t in ("integer", "bigint", "smallint", "serial", "bigserial"):
        return "INTEGER"
    if t in ("numeric", "decimal", "real", "double precision", "money"):
        return "NUMERIC"
    if t == "boolean":
        return "BOOLEAN"
    if "timestamp" in t or t == "time without time zone":
        return "TIMESTAMP"
    if t == "date":
        return "DATE"
    if t == "jsonb" or t == "json":
        return "STRING"
    return "STRING"


def introspect_postgres(
    schema: str,
    *,
    connection_url: str | None = None,
    connect_kwargs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    import psycopg2
    from psycopg2.extras import RealDictCursor

    if (connection_url is None) == (connect_kwargs is None):
        raise ValueError("Pass exactly one of connection_url or connect_kwargs")
    if connect_kwargs is not None:
        kw = dict(connect_kwargs)
        if kw.get("port") is not None:
            kw["port"] = int(kw["port"])
        conn = psycopg2.connect(**kw)
    else:
        conn = psycopg2.connect(connection_url)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = %s
                ORDER BY table_name, ordinal_position
                """,
                (schema,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    tables_map: dict[str, list[dict]] = {}
    for r in rows:
        tname = r["table_name"]
        tables_map.setdefault(tname, []).append(
            {
                "name": r["column_name"],
                "type": _pg_type_to_meta(r["data_type"]),
                "description": "",
            }
        )
    out_tables = [
        {
            "name": name,
            "description": f"Table `{name}` in schema {schema}.",
            "columns": cols,
        }
        for name, cols in sorted(tables_map.items())
    ]
    return {
        "dataset": schema,
        "description": f"PostgreSQL schema `{schema}` (introspected).",
        "tables": out_tables,
        "relationships": [],
    }


def introspect_bigquery(project_id: str, dataset_id: str, client: Any) -> dict[str, Any]:
    from google.cloud import bigquery

    if not isinstance(client, bigquery.Client):
        client = bigquery.Client(project=project_id)

    tables_out: list[dict] = []
    ds_ref = f"{project_id}.{dataset_id}"
    for t in client.list_tables(ds_ref):
        table = client.get_table(f"{ds_ref}.{t.table_id}")
        cols = []
        for field in table.schema:
            cols.append(
                {
                    "name": field.name,
                    "type": (field.field_type or "STRING").upper(),
                    "description": field.description or "",
                }
            )
        tables_out.append(
            {
                "name": t.table_id,
                "description": f"BigQuery table `{dataset_id}.{t.table_id}`.",
                "columns": cols,
            }
        )
    tables_out.sort(key=lambda x: x["name"])
    return {
        "dataset": dataset_id,
        "description": f"BigQuery dataset `{project_id}.{dataset_id}` (introspected).",
        "tables": tables_out,
        "relationships": [],
    }


def schema_fingerprint(catalog: dict[str, Any]) -> str:
    parts: list[str] = []
    for t in sorted(catalog.get("tables") or [], key=lambda x: x.get("name") or ""):
        tn = t.get("name") or ""
        for c in sorted(t.get("columns") or [], key=lambda x: x.get("name") or ""):
            parts.append(f"{tn}.{c.get('name')}:{c.get('type')}")
    blob = "\n".join(parts).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:40]
