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
        return float(os.getenv("QUERY_KB_MIN_SIMILARITY", "0.85"))
    except ValueError:
        return 0.85


def _match_count() -> int:
    try:
        return max(1, min(10, int(os.getenv("QUERY_KB_MATCH_COUNT", "3"))))
    except ValueError:
        return 3


def vector_param(vec: list[float]) -> str:
    """Pgvector text input for RPC cast to vector."""
    return json.dumps(vec)


def match_similar_queries(
    query_embedding: list[float],
    dialect: str,
    schema_fingerprint: str,
) -> list[dict[str, Any]]:
    """Return rows from match_query_kb RPC, ordered by similarity (best first)."""
    if not _kb_enabled():
        return []

    def _run():
        from supabase_service import _get_service_client

        client = _get_service_client()
        res = client.rpc(
            "match_query_kb",
            {
                "p_query_embedding": vector_param(query_embedding),
                "p_match_threshold": _min_similarity(),
                "p_match_count": _match_count(),
                "p_dialect": dialect,
                "p_fingerprint": schema_fingerprint,
            },
        ).execute()
        rows = res.data or []
        return [dict(r) for r in rows]

    try:
        return retry_sync("supabase.match_query_kb", _run)
    except Exception:
        logger.exception("match_query_kb failed")
        return []


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
    except Exception:
        logger.exception("insert_query_kb_entry failed")
        return None
