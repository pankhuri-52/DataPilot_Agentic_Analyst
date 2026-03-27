"""
Query knowledge base: semantic match before planner; interrupt for Re-run vs Adapt.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from langgraph.types import interrupt

from agents.query_kb_helpers import (
    kb_embedding_match_text,
    resolve_kb_user_question_for_index,
    schema_fingerprint_from_schema,
)
from agents.context import get_effective_connector, get_effective_schema
from agents.state import TraceEntry
from agents.trace_stream import append_trace

logger = logging.getLogger("datapilot.query_kb")


def _enabled() -> bool:
    return os.getenv("QUERY_KB_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def _parse_resume(raw: Any) -> str | None:
    if isinstance(raw, dict):
        if raw.get("kind") == "query_cache_hit":
            act = raw.get("action")
            if act in ("full_pipeline", "use_cached_sql"):
                return act
        act = raw.get("action")
        if act in ("full_pipeline", "use_cached_sql"):
            return act
    return None


def run_query_kb(state: dict) -> dict:
    """
    Entry node: optional vector match → interrupt with cache hit, or continue to planner.
    Resume payload: { "kind": "query_cache_hit", "action": "full_pipeline" | "use_cached_sql" }.
    """
    trace = state.get("trace", [])
    query = (state.get("query") or "").strip()
    hist = state.get("conversation_history") or []
    if not isinstance(hist, list):
        hist = []
    match_query = resolve_kb_user_question_for_index(query, hist)

    if not _enabled():
        return {}

    if not match_query.strip():
        return {}

    connector = get_effective_connector(state)

    if not connector:
        append_trace(
            trace,
            TraceEntry(
                agent="query_kb",
                status="info",
                message="Query KB skipped — no database connector.",
            ).model_dump(),
        )
        return {"trace": trace}

    dialect = connector.dialect
    try:
        schema = get_effective_schema(state)
        fingerprint = schema_fingerprint_from_schema(schema)
    except Exception as e:
        logger.warning("query_kb: could not load schema: %s", e)
        append_trace(
            trace,
            TraceEntry(agent="query_kb", status="info", message="Query KB skipped — schema error.").model_dump(),
        )
        return {"trace": trace}

    match_text = kb_embedding_match_text(match_query)

    append_trace(
        trace,
        TraceEntry(agent="query_kb", status="info", message="Checking learned queries…").model_dump(),
    )

    try:
        from embeddings import embed_text
        from query_kb_store import match_similar_queries_with_relaxation

        # Same task type as _maybe_index_query_kb so query and stored rows live in one space.
        q_vec = embed_text(match_text, task_type="RETRIEVAL_QUERY")
        rows, match_tag = match_similar_queries_with_relaxation(q_vec, dialect, fingerprint)
    except Exception as e:
        logger.warning("query_kb lookup failed: %s", e)
        append_trace(
            trace,
            TraceEntry(agent="query_kb", status="info", message=f"Query KB lookup skipped: {e}").model_dump(),
        )
        return {"trace": trace}

    if match_tag == "rpc_error":
        append_trace(
            trace,
            TraceEntry(
                agent="query_kb",
                status="error",
                message=(
                    "Query KB RPC missing in Supabase (PostgREST PGRST202). Run SQL migrations "
                    "000_query_kb_entries.sql then 003_query_kb.sql, then reload API schema — see backend logs."
                ),
            ).model_dump(),
        )
        return {"trace": trace}

    if not rows:
        logger.info(
            "query_kb: no KB match (dialect=%r fingerprint=%s… rows need same dialect + fingerprint as this app; "
            "re-import KB after metadata.json changes; check QUERY_KB_MIN_SIMILARITY).",
            dialect,
            fingerprint[:16],
        )
        append_trace(
            trace,
            TraceEntry(agent="query_kb", status="success", message="No similar past query found.").model_dump(),
        )
        return {"trace": trace}

    if match_tag == "relaxed":
        sim0 = float(rows[0].get("similarity") or 0)
        logger.warning(
            "query_kb: using relaxed similarity match (%.3f) — tighten QUERY_KB_MIN_SIMILARITY or re-embed KB rows if this is wrong",
            sim0,
        )

    best = rows[0]
    similarity = float(best.get("similarity") or 0)
    matched_question = (best.get("user_question") or "").strip()
    sql_cached = (best.get("sql") or "").strip()
    plan_snapshot = best.get("plan_snapshot")
    if not isinstance(plan_snapshot, dict):
        plan_snapshot = {}
    tables_used = best.get("tables_used") or []
    if not isinstance(tables_used, list):
        tables_used = []
    tables_used = [str(t) for t in tables_used]
    executed_at = best.get("executed_at")
    if hasattr(executed_at, "isoformat"):
        executed_at_str = executed_at.isoformat()
    else:
        executed_at_str = str(executed_at) if executed_at else ""

    append_trace(
        trace,
        TraceEntry(
            agent="query_kb",
            status="success",
            message=f"Similar past query found (similarity {similarity:.2f}).",
            output={"similarity": similarity, "matched_question": matched_question},
        ).model_dump(),
    )

    interrupt_payload = {
        "reason": "query_cache_hit",
        "similarity": similarity,
        "matched_question": matched_question,
        "sql": sql_cached,
        "result_preview": best.get("result_preview") or {},
        "executed_at": executed_at_str,
    }

    raw_resume = interrupt(interrupt_payload)
    action = _parse_resume(raw_resume)

    if action == "full_pipeline":
        append_trace(
            trace,
            TraceEntry(
                agent="query_kb",
                status="info",
                message="User chose Re-run — full analysis from planner.",
            ).model_dump(),
        )
        return {"trace": trace}

    if action == "use_cached_sql":
        append_trace(
            trace,
            TraceEntry(
                agent="query_kb",
                status="info",
                message="User chose Adapt — reusing saved SQL.",
            ).model_dump(),
        )
        return {
            "trace": trace,
            "sql": sql_cached,
            "plan": plan_snapshot,
            "data_feasibility": "full",
            "tables_used": tables_used,
            "nearest_plan": None,
            "missing_explanation": None,
            "from_query_cache_adapt": True,
            "kb_result_preview": best.get("result_preview") or {},
        }

    append_trace(
        trace,
        TraceEntry(agent="query_kb", status="info", message="Query KB resume cancelled or unknown — continuing to planner.").model_dump(),
    )
    return {"trace": trace}
