"""
PostgreSQL connector implementation.
"""
from decimal import Decimal
from datetime import date, datetime
from typing import Any

from db.connector import DatabaseConnector


# Metadata columns that record when rows were inserted/updated, not business dates
_METADATA_DATE_COLUMNS = frozenset({"created_at", "updated_at", "modified_at"})


def _get_date_columns(schema: dict) -> list[tuple[str, str]]:
    """Return list of (table_name, column_name) for business date columns only.
    Excludes metadata timestamps (created_at, updated_at) which reflect insert time, not sales data.
    """
    result = []
    for table in schema.get("tables", []):
        tname = table.get("name", "")
        for col in table.get("columns", []):
            col_name = col.get("name", "")
            if col_name.lower() in _METADATA_DATE_COLUMNS:
                continue
            col_type = (col.get("type") or "").upper()
            if col_type in ("DATE", "TIMESTAMP", "TIMESTAMPTZ", "DATETIME"):
                result.append((tname, col_name))
    return result


def _serialize(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


class PostgresConnector(DatabaseConnector):
    """PostgreSQL database connector."""

    def __init__(self, connection_url: str, schema: str = "public"):
        self.connection_url = connection_url
        self.schema = schema

    @property
    def dialect(self) -> str:
        return "postgres"

    def execute(self, sql: str) -> list[dict[str, Any]]:
        import psycopg2
        from psycopg2.extras import RealDictCursor
        conn = psycopg2.connect(self.connection_url)
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql)
                rows = cur.fetchmany(1000)
                return [{k: _serialize(v) for k, v in dict(row).items()} for row in rows]
        finally:
            conn.close()

    def run_date_range_diagnostic(self, schema: dict) -> tuple[dict | None, str | None]:
        date_cols = _get_date_columns(schema)
        if not date_cols:
            return None, "No date columns found in schema for diagnostic."

        import psycopg2
        from psycopg2.extras import RealDictCursor
        conn = psycopg2.connect(self.connection_url)
        all_ranges = []

        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                for table_name, col_name in date_cols:
                    try:
                        full_table = f'"{self.schema}"."{table_name}"' if self.schema else f'"{table_name}"'
                        cur.execute(
                            f'SELECT MIN("{col_name}") as min_val, MAX("{col_name}") as max_val FROM {full_table}'
                        )
                        row = cur.fetchone()
                        if row and row["min_val"] is not None and row["max_val"] is not None:
                            min_val = row["min_val"]
                            max_val = row["max_val"]
                            if hasattr(min_val, "isoformat"):
                                min_val = min_val.isoformat()[:10]
                            if hasattr(max_val, "isoformat"):
                                max_val = max_val.isoformat()[:10]
                            all_ranges.append({
                                "table": table_name,
                                "column": col_name,
                                "min": str(min_val),
                                "max": str(max_val),
                            })
                    except Exception:
                        continue
        finally:
            conn.close()

        if not all_ranges:
            return None, "Could not determine date range from database."

        primary = all_ranges[0]
        data_range = {
            "min": primary["min"],
            "max": primary["max"],
            "table": primary["table"],
            "column": primary["column"],
        }
        if len(all_ranges) > 1:
            data_range["min"] = min(r["min"] for r in all_ranges)
            data_range["max"] = max(r["max"] for r in all_ranges)

        reason = (
            f"No data found for the requested period. Available data spans from "
            f"{data_range['min']} to {data_range['max']}. Try asking for a time range within this period."
        )
        return data_range, reason
