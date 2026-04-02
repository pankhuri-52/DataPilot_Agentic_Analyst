"""
BigQuery connector implementation.
"""
import base64
import binascii
import json
import logging
import os
from decimal import Decimal
from datetime import date, datetime
from pathlib import Path
from typing import Any

from core.request_metrics import increment_counter
from db.connector import DatabaseConnector

logger = logging.getLogger("datapilot")

# Full service account JSON (e.g. Vercel env). Prefer GCP_SERVICE_ACCOUNT_JSON_B64 if the dashboard mangles JSON.
_SERVICE_ACCOUNT_JSON_ENV = "GCP_SERVICE_ACCOUNT_JSON"
_SERVICE_ACCOUNT_JSON_B64_ENV = "GCP_SERVICE_ACCOUNT_JSON_B64"


def _is_service_account_dict(data: dict[str, Any]) -> bool:
    """True if dict looks like a GCP service account key (not e.g. `{}` or random JSON)."""
    pk = data.get("private_key")
    if not isinstance(pk, str) or "PRIVATE KEY" not in pk:
        return False
    return bool(data.get("client_email") or data.get("client_id"))


def _parse_service_account_json(raw: str, *, source_label: str) -> dict[str, Any] | None:
    """Parse JSON object; accept double-encoded JSON string (common when pasting into env UIs)."""
    raw = raw.strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("Invalid JSON (%s): %s", source_label, e)
        return None
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            logger.warning("Invalid nested JSON (%s): %s", source_label, e)
            return None
    if not isinstance(data, dict):
        logger.warning("Expected JSON object (%s)", source_label)
        return None
    return data


def _decode_b64_service_account_json(b64: str) -> dict[str, Any] | None:
    """Decode standard or URL-safe base64; strip whitespace/newlines from pasted values."""
    cleaned = "".join(b64.split())
    if not cleaned:
        return None
    pad = (-len(cleaned)) % 4
    padded = cleaned + ("=" * pad)
    raw_bytes: bytes | None = None
    try:
        raw_bytes = base64.b64decode(padded)
    except (binascii.Error, ValueError):
        try:
            raw_bytes = base64.urlsafe_b64decode(padded)
        except (binascii.Error, ValueError) as e:
            logger.warning("Invalid base64 in %s: %s", _SERVICE_ACCOUNT_JSON_B64_ENV, e)
            return None
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as e:
        logger.warning("Invalid UTF-8 after base64 in %s: %s", _SERVICE_ACCOUNT_JSON_B64_ENV, e)
        return None
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    return _parse_service_account_json(text, source_label=_SERVICE_ACCOUNT_JSON_B64_ENV)


def load_service_account_dict_from_env() -> dict[str, Any] | None:
    """
    Parse service account JSON from env.
    - GCP_SERVICE_ACCOUNT_JSON: raw JSON (single line recommended).
    - GCP_SERVICE_ACCOUNT_JSON_B64: base64 of the UTF-8 JSON file (recommended on Vercel).

    If JSON env is set but invalid or not a service account key, we still try B64 (common misconfig).
    """
    json_raw = os.getenv(_SERVICE_ACCOUNT_JSON_ENV, "").strip()
    if json_raw:
        parsed = _parse_service_account_json(json_raw, source_label=_SERVICE_ACCOUNT_JSON_ENV)
        if parsed and _is_service_account_dict(parsed):
            return parsed
        logger.warning(
            "%s is set but is not valid service account JSON; trying %s",
            _SERVICE_ACCOUNT_JSON_ENV,
            _SERVICE_ACCOUNT_JSON_B64_ENV,
        )

    b64 = os.getenv(_SERVICE_ACCOUNT_JSON_B64_ENV, "").strip()
    if b64:
        parsed = _decode_b64_service_account_json(b64)
        if parsed and _is_service_account_dict(parsed):
            return parsed
        if b64:
            logger.warning(
                "%s decoded but missing private_key/client_email; check the key file",
                _SERVICE_ACCOUNT_JSON_B64_ENV,
            )

    return None


def get_credential_diagnostics() -> dict[str, Any]:
    """Return non-secret diagnostic info about available BigQuery credential methods."""
    diag: dict[str, Any] = {}

    # Method 1: raw JSON env var
    json_raw = os.getenv(_SERVICE_ACCOUNT_JSON_ENV, "").strip()
    if json_raw:
        parsed = _parse_service_account_json(json_raw, source_label=_SERVICE_ACCOUNT_JSON_ENV)
        if parsed and _is_service_account_dict(parsed):
            email = parsed.get("client_email", "")
            diag["GCP_SERVICE_ACCOUNT_JSON"] = {"set": True, "valid": True, "client_email": email}
        else:
            diag["GCP_SERVICE_ACCOUNT_JSON"] = {"set": True, "valid": False}
    else:
        diag["GCP_SERVICE_ACCOUNT_JSON"] = {"set": False}

    # Method 2: base64 env var
    b64 = os.getenv(_SERVICE_ACCOUNT_JSON_B64_ENV, "").strip()
    if b64:
        parsed = _decode_b64_service_account_json(b64)
        if parsed and _is_service_account_dict(parsed):
            email = parsed.get("client_email", "")
            diag["GCP_SERVICE_ACCOUNT_JSON_B64"] = {"set": True, "valid": True, "client_email": email}
        else:
            diag["GCP_SERVICE_ACCOUNT_JSON_B64"] = {"set": True, "valid": False}
    else:
        diag["GCP_SERVICE_ACCOUNT_JSON_B64"] = {"set": False}

    # Method 3: file path
    raw_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    if raw_path:
        creds_path = _credentials_file_path()
        diag["GOOGLE_APPLICATION_CREDENTIALS"] = {
            "set": True,
            "raw_value": raw_path,
            "file_exists": creds_path is not None,
        }
    else:
        diag["GOOGLE_APPLICATION_CREDENTIALS"] = {"set": False}

    # Summary
    has_valid = any(
        v.get("valid") or v.get("file_exists")
        for v in diag.values()
        if isinstance(v, dict)
    )
    diag["resolved"] = has_valid

    return diag


def _bigquery_credentials_unavailable_message() -> str:
    return (
        "BigQuery credentials missing. On Vercel set GCP_SERVICE_ACCOUNT_JSON (minified JSON) or "
        "GCP_SERVICE_ACCOUNT_JSON_B64 (base64 of the JSON file), then redeploy. "
        "Locally you can use GOOGLE_APPLICATION_CREDENTIALS pointing at a JSON file."
    )


def _credentials_file_path() -> Path | None:
    """Resolved path for GOOGLE_APPLICATION_CREDENTIALS if set and file exists."""
    _resolve_credentials_path()
    path = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if not path:
        return None
    p = Path(path)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent.parent / path
    p = p.resolve()
    return p if p.is_file() else None


def build_bigquery_client(project_id: str):
    """
    Build a BigQuery client with explicit credentials.
    Resolves auth at construction time so missing credentials fail here, not on the first query().
    """
    from google.cloud import bigquery
    from google.oauth2 import service_account

    tried: list[str] = []

    # 1. Env-var JSON / B64
    info = load_service_account_dict_from_env()
    if info:
        try:
            creds = service_account.Credentials.from_service_account_info(info)
        except Exception as e:
            raise RuntimeError(
                "Could not load credentials from GCP_SERVICE_ACCOUNT_JSON / GCP_SERVICE_ACCOUNT_JSON_B64. "
                "Check the key is a full service account JSON (with private_key and client_email)."
            ) from e
        return bigquery.Client(project=project_id, credentials=creds)

    # Record why env-var methods didn't work
    json_set = bool(os.getenv(_SERVICE_ACCOUNT_JSON_ENV, "").strip())
    b64_set = bool(os.getenv(_SERVICE_ACCOUNT_JSON_B64_ENV, "").strip())
    if json_set:
        tried.append(f"{_SERVICE_ACCOUNT_JSON_ENV}: set but not valid service-account JSON")
    if b64_set:
        tried.append(f"{_SERVICE_ACCOUNT_JSON_B64_ENV}: set but decode/validation failed")
    if not json_set and not b64_set:
        tried.append("GCP_SERVICE_ACCOUNT_JSON and GCP_SERVICE_ACCOUNT_JSON_B64: not set")

    # 2. File path
    creds_path = _credentials_file_path()
    if creds_path is not None:
        creds = service_account.Credentials.from_service_account_file(str(creds_path))
        return bigquery.Client(project=project_id, credentials=creds)

    raw_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    if raw_path:
        tried.append(f"GOOGLE_APPLICATION_CREDENTIALS={raw_path!r}: file does not exist")
    else:
        tried.append("GOOGLE_APPLICATION_CREDENTIALS: not set")

    # 3. ADC fallback
    try:
        import google.auth
        from google.auth.exceptions import DefaultCredentialsError

        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    except (DefaultCredentialsError, Exception) as e:
        tried.append(f"Application Default Credentials: {e}")
        detail = "\n".join(f"  - {t}" for t in tried)
        raise RuntimeError(
            f"BigQuery credentials could not be resolved. Methods tried:\n{detail}\n\n"
            "On Vercel, set the env var GCP_SERVICE_ACCOUNT_JSON_B64 to the base64-encoded "
            "contents of your service-account JSON file, then redeploy."
        ) from e

    return bigquery.Client(project=project_id, credentials=creds)


def bigquery_client(project_id: str):
    """Build a BigQuery client using env JSON, service account file, or Application Default Credentials."""
    return build_bigquery_client(project_id)


def _resolve_credentials_path():
    """Resolve GOOGLE_APPLICATION_CREDENTIALS to absolute path; clear if file missing."""
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not path:
        return
    p = Path(path)
    if not p.is_absolute():
        project_root = Path(__file__).resolve().parent.parent.parent
        p = project_root / path
    resolved = p.resolve()
    if resolved.is_file():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(resolved)
    else:
        logger.warning(
            "GOOGLE_APPLICATION_CREDENTIALS=%s resolved to %s which does not exist; "
            "clearing env var so ADC is not confused",
            path, resolved,
        )
        os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)


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
        if credentials_info is not None:
            self._credentials_info = credentials_info
        else:
            self._credentials_info = load_service_account_dict_from_env()
        if not self._credentials_info:
            _resolve_credentials_path()

    def _client(self):
        from google.cloud import bigquery
        from google.oauth2 import service_account

        if self._credentials_info:
            creds = service_account.Credentials.from_service_account_info(self._credentials_info)
            return bigquery.Client(project=self.project_id, credentials=creds)
        return build_bigquery_client(self.project_id)

    @property
    def dialect(self) -> str:
        return "bigquery"

    def execute(self, sql: str) -> list[dict[str, Any]]:
        from google.cloud import bigquery

        client = self._client()
        increment_counter("bigquery_query_calls", 1)
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
        increment_counter("bigquery_query_calls", 1)
        query_job = client.query(sql, job_config=job_config)
        bytes_processed = query_job.total_bytes_processed or 0
        # $5 per TiB = $5 / (1024**4) per byte
        cost_usd = (bytes_processed / (1024**4)) * 5.0
        return bytes_processed, cost_usd

    def run_date_range_diagnostic(self, schema: dict) -> tuple[dict | None, str | None]:
        date_cols = _get_date_columns(schema)
        if not date_cols:
            return None, "No date columns found in schema for diagnostic."
        max_diag_cols = max(1, int(os.getenv("DATAPILOT_DIAGNOSTIC_MAX_DATE_COLUMNS", "6")))
        date_cols = date_cols[:max_diag_cols]

        from google.cloud import bigquery

        client = self._client()
        all_ranges = []

        for table_name, col_name in date_cols:
            table_ref = f"`{self.project_id}.{self.dataset_id}.{table_name}`"
            try:
                diag_sql = f"SELECT MIN({col_name}) as min_val, MAX({col_name}) as max_val FROM {table_ref}"
                increment_counter("bigquery_query_calls", 1)
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
            f"The query returned no rows. Date values in this warehouse span roughly "
            f"{data_range['min']} through {data_range['max']} (min/max across main DATE/TIMESTAMP columns). "
            f"If you used filters or joins, try broadening them; for returns, reason_code values are lowercase "
            f"(e.g. defective, changed_mind)."
        )
        return data_range, reason
