"""
Query knowledge base: semantic match before planner; interrupt for Re-run vs Adapt.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from langgraph.types import interrupt

from agents.query_kb_helpers import (
    build_query_side_index_text,
    guess_columns_from_sql,
    schema_fingerprint_from_schema,
)
from agents.schema_utils import load_schema
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

    if not _enabled():
        return {}

    if not query:
        return {}

    try:
        from db.factory import get_connector

        connector = get_connector()
    except Exception:
        connector = None

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
        schema = load_schema()
        fingerprint = schema_fingerprint_from_schema(schema)
    except Exception as e:
        logger.warning("query_kb: could not load schema: %s", e)
        append_trace(
            trace,
            TraceEntry(agent="query_kb", status="info", message="Query KB skipped — schema error.").model_dump(),
        )
        return {"trace": trace}

    index_text = build_query_side_index_text(query, schema)

    append_trace(
        trace,
        TraceEntry(agent="query_kb", status="info", message="Checking learned queries…").model_dump(),
    )

    try:
        from embeddings import embed_text
        from query_kb_store import match_similar_queries

        q_vec = embed_text(index_text, task_type="RETRIEVAL_QUERY")
        rows = match_similar_queries(q_vec, dialect, fingerprint)
    except Exception as e:
        logger.warning("query_kb lookup failed: %s", e)
        append_trace(
            trace,
            TraceEntry(agent="query_kb", status="info", message=f"Query KB lookup skipped: {e}").model_dump(),
        )
        return {"trace": trace}

    if not rows:
        append_trace(
            trace,
            TraceEntry(agent="query_kb", status="success", message="No similar past query found.").model_dump(),
        )
        return {"trace": trace}

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
        }

    append_trace(
        trace,
        TraceEntry(agent="query_kb", status="info", message="Query KB resume cancelled or unknown — continuing to planner.").model_dump(),
    )
    return {"trace": trace}
