"""
BigQuery connector implementation.
"""
import os
from decimal import Decimal
from datetime import date, datetime
from pathlib import Path
from typing import Any

from db.connector import DatabaseConnector


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
            if col_type in ("DATE", "TIMESTAMP", "DATETIME"):
                result.append((tname, col_name))
    return result


def _serialize(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


_TIB_BYTES = 1024**4


def format_bigquery_cost_estimate_for_user(bytes_processed: int, cost_usd: float) -> str:
    """
    Multi-line text for traces / execute-confirm UI: fixed 4-decimal USD and explicit $5/TiB formula.
    """
    if bytes_processed <= 0:
        return (
            "Dry run: 0 billable bytes — no on-demand charge from this estimate.\n"
            "Pricing note: BigQuery on-demand is about $5.00 per tebibyte (TiB) scanned."
        )
    mb = bytes_processed / (1024**2)
    usd = f"{max(cost_usd, 0.0):.4f}"
    b_fmt = f"{bytes_processed:,}"
    tib_fmt = f"{_TIB_BYTES:,}"
    return (
        f"~{mb:.2f} MB scanned ({b_fmt} bytes).\n"
        f"Estimated on-demand charge: ${usd} USD.\n"
        f"How we calculated it: (bytes scanned ÷ 1 TiB) × $5/TiB → "
        f"({b_fmt} ÷ {tib_fmt}) × $5.00 ≈ ${usd}. "
        f"Billing is for bytes scanned, not how many rows are returned."
    )


class BigQueryConnector(DatabaseConnector):
    """BigQuery database connector."""

    def __init__(self, project_id: str, dataset_id: str, credentials_info: dict | None = None):
        self.project_id = project_id
        self.dataset_id = dataset_id
        self._credentials_info = credentials_info
        if not credentials_info:
            _resolve_credentials_path()

    def _client(self):
        from google.cloud import bigquery

        if self._credentials_info:
            from google.oauth2 import service_account

            creds = service_account.Credentials.from_service_account_info(self._credentials_info)
            return bigquery.Client(project=self.project_id, credentials=creds)
        _resolve_credentials_path()
        return bigquery.Client(project=self.project_id)

    @property
    def dialect(self) -> str:
        return "bigquery"

    def execute(self, sql: str) -> list[dict[str, Any]]:
        from google.cloud import bigquery

        client = self._client()
        query_job = client.query(sql)
        rows = list(query_job.result(max_results=1000))
        return [{k: _serialize(v) for k, v in dict(row).items()} for row in rows]

    def dry_run_estimate(self, sql: str) -> tuple[int, float]:
        """
        Run a dry run to estimate bytes scanned and cost.
        Returns (bytes_scanned, estimated_cost_usd).
        BigQuery on-demand: ~$5 per TiB processed.
        """
        from google.cloud import bigquery

        client = self._client()
        job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        query_job = client.query(sql, job_config=job_config)
        bytes_processed = query_job.total_bytes_processed or 0
        # $5 per TiB = $5 / (1024**4) per byte
        cost_usd = (bytes_processed / (1024**4)) * 5.0
        return bytes_processed, cost_usd

    def run_date_range_diagnostic(self, schema: dict) -> tuple[dict | None, str | None]:
        date_cols = _get_date_columns(schema)
        if not date_cols:
            return None, "No date columns found in schema for diagnostic."

        from google.cloud import bigquery

        client = self._client()
        all_ranges = []

        for table_name, col_name in date_cols:
            table_ref = f"`{self.project_id}.{self.dataset_id}.{table_name}`"
            try:
                diag_sql = f"SELECT MIN({col_name}) as min_val, MAX({col_name}) as max_val FROM {table_ref}"
                job = client.query(diag_sql)
                rows = list(job.result(max_results=1))
                if rows and rows[0].min_val is not None and rows[0].max_val is not None:
                    min_val = rows[0].min_val
                    max_val = rows[0].max_val
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
