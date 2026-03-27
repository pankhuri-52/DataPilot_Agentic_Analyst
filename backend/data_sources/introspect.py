"""Build metadata.json-shaped catalogs from live databases."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from core.postgres_dsn import sanitize_postgres_uri_for_psycopg2

_SAFE_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _safe_pg_table_name(name: str) -> bool:
    return bool(name and _SAFE_IDENT.match(name))


def _samples_from_row_dicts(
    rows: list[dict[str, Any]],
    column_names: list[str],
    *,
    max_per_col: int = 5,
    max_val_len: int = 72,
) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {c: [] for c in column_names}
    seen: dict[str, set[str]] = {c: set() for c in column_names}
    for row in rows:
        for c in column_names:
            if len(out[c]) >= max_per_col:
                continue
            v = row.get(c)
            if v is None:
                continue
            s = str(v).strip()
            if not s:
                continue
            if s in seen[c]:
                continue
            seen[c].add(s)
            out[c].append(s[:max_val_len])
    return out


def _pg_column_comments(conn: Any, schema: str) -> dict[tuple[str, str], str]:
    import psycopg2.extras

    out: dict[tuple[str, str], str] = {}
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT c.relname AS table_name, a.attname AS column_name,
                   pg_catalog.col_description(c.oid, a.attnum) AS col_description
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = %s
              AND c.relkind = 'r'
              AND a.attnum > 0
              AND NOT a.attisdropped
            """,
            (schema,),
        )
        for r in cur.fetchall():
            t, col, desc = r["table_name"], r["column_name"], r["col_description"]
            if desc and str(desc).strip():
                out[(t, col)] = str(desc).strip()
    return out


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
    include_samples: bool = False,
    sample_row_limit: int = 50,
    max_tables_sampled: int = 20,
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
        conn = psycopg2.connect(sanitize_postgres_uri_for_psycopg2(connection_url))
    rows: list[Any] = []
    comments: dict[tuple[str, str], str] = {}
    out_tables: list[dict[str, Any]] = []
    try:
        try:
            comments = _pg_column_comments(conn, schema)
        except Exception:
            comments = {}

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

        tables_map: dict[str, list[dict]] = {}
        for r in rows:
            tname = r["table_name"]
            cname = r["column_name"]
            desc = comments.get((tname, cname), "")
            tables_map.setdefault(tname, []).append(
                {
                    "name": cname,
                    "type": _pg_type_to_meta(r["data_type"]),
                    "description": desc,
                }
            )
        out_tables[:] = [
            {
                "name": name,
                "description": f"Table `{name}` in schema {schema}.",
                "columns": cols,
            }
            for name, cols in sorted(tables_map.items())
        ]

        if include_samples and out_tables:
            sampled = 0
            try:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    for tbl in out_tables:
                        if sampled >= max_tables_sampled:
                            break
                        tname = tbl["name"]
                        if not _safe_pg_table_name(tname):
                            continue
                        cols = tbl.get("columns") or []
                        col_names = [c["name"] for c in cols if c.get("name")]
                        if not col_names:
                            continue
                        q = 'SELECT * FROM "{}"."{}" LIMIT %s'.format(schema, tname)
                        try:
                            cur.execute(q, (int(sample_row_limit),))
                            data_rows = cur.fetchall()
                        except Exception:
                            continue
                        if not data_rows:
                            sampled += 1
                            continue
                        samples = _samples_from_row_dicts(data_rows, col_names)
                        for c in cols:
                            cn = c.get("name")
                            if cn and samples.get(cn):
                                c["sample_values"] = samples[cn]
                        sampled += 1
            except Exception:
                pass
    finally:
        try:
            conn.close()
        except Exception:
            pass

    return {
        "dataset": schema,
        "description": f"PostgreSQL schema `{schema}` (introspected).",
        "tables": out_tables,
        "relationships": [],
    }


def introspect_bigquery(
    project_id: str,
    dataset_id: str,
    client: Any,
    *,
    include_samples: bool = False,
    sample_row_limit: int = 50,
    max_tables_sampled: int = 25,
) -> dict[str, Any]:
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

    if include_samples and tables_out:
        sampled = 0
        for tbl in tables_out:
            if sampled >= max_tables_sampled:
                break
            tid = tbl["name"]
            cols = tbl.get("columns") or []
            col_names = [c["name"] for c in cols if c.get("name")]
            if not col_names:
                sampled += 1
                continue
            fq = f"`{project_id}.{dataset_id}.{tid}`"
            job_config = bigquery.QueryJobConfig(maximum_bytes_billed=500_000_000)
            try:
                job = client.query(f"SELECT * FROM {fq} LIMIT {int(sample_row_limit)}", job_config=job_config)
                data_rows = [{k: r[k] for k in r.keys()} for r in job.result()]
            except Exception:
                sampled += 1
                continue
            if not data_rows:
                sampled += 1
                continue
            samples = _samples_from_row_dicts(data_rows, col_names)
            for c in cols:
                cn = c.get("name")
                if cn and samples.get(cn):
                    c["sample_values"] = samples[cn]
            sampled += 1

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
