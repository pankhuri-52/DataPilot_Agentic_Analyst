"""
Supabase RPC for query knowledge base (pgvector). Service role only.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from core.retry import retry_sync

logger = logging.getLogger("datapilot.query_kb")


def _kb_enabled() -> bool:
    return os.getenv("QUERY_KB_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def _min_similarity() -> float:
    try:
        # 0.85 was too strict with real Gemini variance + legacy KB rows; 0.78 is a safer default.
        return float(os.getenv("QUERY_KB_MIN_SIMILARITY", "0.78"))
    except ValueError:
        return 0.78


def _relaxed_min_similarity() -> float | None:
    """
    Second pass when primary threshold returns no rows.
    Default 0.68; set QUERY_KB_RELAXED_MIN_SIMILARITY=none (or off) to disable.
    """
    raw = (os.getenv("QUERY_KB_RELAXED_MIN_SIMILARITY") or "0.68").strip()
    if raw.lower() in ("none", "off", "disable", "0"):
        return None
    try:
        return float(raw)
    except ValueError:
        return 0.68


def _match_count() -> int:
    try:
        return max(1, min(10, int(os.getenv("QUERY_KB_MATCH_COUNT", "3"))))
    except ValueError:
        return 3


def vector_param(vec: list[float]) -> str:
    """Pgvector text input for RPC cast to vector."""
    return json.dumps(vec)


_RPC_MISSING_HINT = (
    "Apply Supabase migrations in order: 000_query_kb_entries.sql (table + vector), then 003_query_kb.sql "
    "(match_query_kb + insert_query_kb_entry). In Dashboard: Project Settings → API → reload schema if PostgREST "
    "still returns PGRST202."
)


def _is_rpc_schema_missing(exc: BaseException) -> bool:
    code = getattr(exc, "code", None)
    if code == "PGRST202":
        return True
    msg = str(exc).lower()
    return "pgrst202" in msg or "schema cache" in msg and "function" in msg


def match_similar_queries(
    query_embedding: list[float],
    dialect: str,
    schema_fingerprint: str,
    *,
    match_threshold: float | None = None,
) -> list[dict[str, Any]] | None:
    """
    Return rows from match_query_kb RPC, ordered by similarity (best first).
    Returns None if the RPC failed (e.g. PGRST202: function not deployed); [] if no rows matched.
    """
    if not _kb_enabled():
        return []

    threshold = _min_similarity() if match_threshold is None else float(match_threshold)

    def _run(th: float):
        from supabase_service import _get_service_client

        client = _get_service_client()
        res = client.rpc(
            "match_query_kb",
            {
                "p_query_embedding": vector_param(query_embedding),
                "p_match_threshold": th,
                "p_match_count": _match_count(),
                "p_dialect": dialect.strip(),
                "p_fingerprint": schema_fingerprint.strip(),
            },
        ).execute()
        rows = res.data or []
        return [dict(r) for r in rows]

    try:
        return retry_sync("supabase.match_query_kb", lambda: _run(threshold))
    except Exception as e:
        if _is_rpc_schema_missing(e):
            logger.error(
                "Query KB disabled: PostgREST cannot find public.match_query_kb (PGRST202). %s",
                _RPC_MISSING_HINT,
            )
        else:
            logger.exception("match_query_kb failed")
        return None


def match_similar_queries_with_relaxation(
    query_embedding: list[float],
    dialect: str,
    schema_fingerprint: str,
) -> tuple[list[dict[str, Any]], str]:
    """
    Primary match at QUERY_KB_MIN_SIMILARITY, then optional relaxed pass.
    Returns (rows, tag) where tag is \"primary\" | \"relaxed\" | \"none\" | \"rpc_error\".
    """
    primary_t = _min_similarity()
    rows = match_similar_queries(
        query_embedding, dialect, schema_fingerprint, match_threshold=primary_t
    )
    if rows is None:
        return [], "rpc_error"
    if rows:
        return rows, "primary"
    relaxed_t = _relaxed_min_similarity()
    if relaxed_t is not None and relaxed_t < primary_t:
        rows = match_similar_queries(
            query_embedding, dialect, schema_fingerprint, match_threshold=relaxed_t
        )
        if rows is None:
            return [], "rpc_error"
        if rows:
            return rows, "relaxed"
    return [], "none"


def insert_kb_entry(
    *,
    executed_at: datetime,
    index_text: str,
    embedding: list[float],
    user_question: str,
    sql: str,
    dialect: str,
    schema_fingerprint: str,
    plan_snapshot: dict[str, Any],
    tables_used: list[str],
    columns_used: list[str],
    result_preview: dict[str, Any] | None,
) -> str | None:
    """Insert one KB row. Returns new id or None on failure."""
    if not _kb_enabled():
        return None

    def _run():
        from supabase_service import _get_service_client

        client = _get_service_client()
        res = client.rpc(
            "insert_query_kb_entry",
            {
                "p_executed_at": executed_at.replace(tzinfo=timezone.utc).isoformat(),
                "p_index_text": index_text,
                "p_embedding": vector_param(embedding),
                "p_user_question": user_question,
                "p_sql": sql,
                "p_dialect": dialect,
                "p_schema_fingerprint": schema_fingerprint,
                "p_plan_snapshot": plan_snapshot,
                "p_tables_used": tables_used,
                "p_columns_used": columns_used,
                "p_result_preview": result_preview or {},
            },
        ).execute()
        data = res.data
        if data is None:
            return None
        if isinstance(data, str):
            return data
        if isinstance(data, list) and len(data) == 1:
            row = data[0]
            if isinstance(row, dict):
                for k in ("insert_query_kb_entry", "id"):
                    if k in row and row[k] is not None:
                        return str(row[k])
            return str(row)
        if isinstance(data, dict):
            for k in ("insert_query_kb_entry", "id"):
                if k in data and data[k] is not None:
                    return str(data[k])
        return str(data) if data is not None else None

    try:
        return retry_sync("supabase.insert_query_kb", _run)
    except Exception as e:
        if _is_rpc_schema_missing(e):
            logger.error(
                "insert_query_kb_entry skipped: RPC missing (PGRST202). %s",
                _RPC_MISSING_HINT,
            )
        else:
            logger.exception("insert_query_kb_entry failed")
        return None
