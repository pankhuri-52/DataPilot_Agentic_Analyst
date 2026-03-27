"""Load a small CSV into Supabase Postgres (dedicated schema) for demos."""
from __future__ import annotations

import csv
import io
import re
import uuid
from typing import Any


def _sanitize_col(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_]", "_", (name or "").strip())
    if not s:
        s = "col"
    if s[0].isdigit():
        s = "c_" + s
    return s[:63].lower()


def load_csv_into_schema(
    file_bytes: bytes,
    *,
    connection_url: str,
    upload_schema: str,
    table_label: str,
    max_rows: int = 50_000,
) -> tuple[str, dict[str, Any]]:
    """
    Create schema if needed, create one TEXT-column table, COPY rows.
    Returns (table_name, metadata catalog for that single table).
    """
    import psycopg2

    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise ValueError("CSV is empty")
    header = [_sanitize_col(h) for h in rows[0]]
    if len(set(header)) != len(header):
        seen: dict[str, int] = {}
        uniq = []
        for h in header:
            k = h
            n = seen.get(k, 0)
            seen[k] = n + 1
            if n:
                k = f"{h}_{n}"
            uniq.append(k)
        header = uniq
    data_rows = rows[1 : max_rows + 1]

    table_name = f"csv_{uuid.uuid4().hex[:12]}"
    col_defs = ", ".join(f'"{c}" TEXT' for c in header)
    ddl_create_schema = f'CREATE SCHEMA IF NOT EXISTS "{upload_schema}";'
    ddl_table = f'CREATE TABLE "{upload_schema}"."{table_name}" ({col_defs});'

    conn = psycopg2.connect(connection_url)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(ddl_create_schema)
            cur.execute(ddl_table)
        conn.autocommit = False
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        for r in data_rows:
            w.writerow([(r[i] if i < len(r) else "") for i in range(len(header))])
        buf.seek(0)
        col_list = ",".join(f'"{c}"' for c in header)
        copy_sql = f'COPY "{upload_schema}"."{table_name}" ({col_list}) FROM STDIN WITH (FORMAT csv)'
        with conn.cursor() as cur:
            cur.copy_expert(copy_sql, buf)
        conn.commit()
    finally:
        conn.close()

    catalog: dict[str, Any] = {
        "dataset": upload_schema,
        "description": f"Uploaded CSV: {table_label}",
        "tables": [
            {
                "name": table_name,
                "description": table_label,
                "columns": [{"name": c, "type": "STRING", "description": ""} for c in header],
            }
        ],
        "relationships": [],
    }
    return table_name, catalog
