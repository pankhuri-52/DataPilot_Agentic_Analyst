"""
Personalized question suggestions: retrieve chat history (+ optional query KB), LLM-augmented prompts.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger("datapilot.suggested_questions")

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.Lock()

_GENERIC_FALLBACK = [
    "What were total sales by region last month?",
    "Show top 10 products by revenue this quarter.",
    "How many orders per week over the last 90 days?",
    "Compare return rates by product category.",
    "Which sales reps had the highest revenue in the last month?",
]


class SuggestedQuestionsOutput(BaseModel):
    suggestions: list[str] = Field(
        description=(
            "Short analytics questions answerable with ONLY the listed warehouse columns; "
            "never invent column names (e.g. customers have segment, not industry)."
        ),
    )


def _monotonic_now() -> float:
    return time.monotonic()


def _cache_ttl_sec() -> float:
    try:
        return max(0.0, float(os.getenv("SUGGESTED_QUESTIONS_CACHE_TTL_SEC", "600")))
    except ValueError:
        return 600.0


def _feature_enabled() -> bool:
    return os.getenv("SUGGESTED_QUESTIONS_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def _include_kb_resolved(include_kb: bool | None) -> bool:
    if include_kb is not None:
        return include_kb
    return os.getenv("SUGGESTED_QUESTIONS_INCLUDE_KB", "1").strip().lower() not in ("0", "false", "no")


def _llm_enabled() -> bool:
    return os.getenv("SUGGESTED_QUESTIONS_LLM", "1").strip().lower() not in ("0", "false", "no")


def _cache_get(key: str) -> dict[str, Any] | None:
    ttl = _cache_ttl_sec()
    if ttl <= 0:
        return None
    with _CACHE_LOCK:
        ent = _CACHE.get(key)
        if not ent:
            return None
        exp, payload = ent
        if _monotonic_now() > exp:
            del _CACHE[key]
            return None
        return dict(payload)


def _cache_set(key: str, payload: dict[str, Any]) -> None:
    ttl = _cache_ttl_sec()
    if ttl <= 0:
        return
    with _CACHE_LOCK:
        _CACHE[key] = (_monotonic_now() + ttl, dict(payload))


def _merge_question_context(
    frequent_rows: list[dict[str, Any]],
    recent_rows: list[dict[str, Any]],
) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for row in frequent_rows:
        t = (row.get("display_text") or "").strip()
        k = t.lower()
        if not t or k in seen:
            continue
        seen.add(k)
        out.append(t)
    for row in recent_rows:
        t = (row.get("display_text") or "").strip()
        k = t.lower()
        if not t or k in seen:
            continue
        seen.add(k)
        out.append(t)
    return out


def _schema_tables_summary(schema: dict[str, Any], max_tables: int = 24) -> str:
    lines: list[str] = []
    for t in (schema.get("tables") or [])[:max_tables]:
        if not isinstance(t, dict):
            continue
        name = (t.get("name") or "").strip()
        if not name:
            continue
        desc = str(t.get("description") or "").strip()
        if len(desc) > 140:
            desc = desc[:137] + "..."
        lines.append(f"- {name}: {desc}")
    return "\n".join(lines) if lines else "(no table catalog)"


def _schema_columns_catalog(schema: dict[str, Any], max_tables: int = 32) -> str:
    """Compact table: col1, col2 lines for LLM grounding (avoid invented dimensions)."""
    lines: list[str] = []
    for t in (schema.get("tables") or [])[:max_tables]:
        if not isinstance(t, dict):
            continue
        name = (t.get("name") or "").strip()
        cols = t.get("columns")
        if not name or not isinstance(cols, list):
            continue
        cnames: list[str] = []
        for c in cols:
            if not isinstance(c, dict):
                continue
            cn = (c.get("name") or "").strip()
            if cn:
                cnames.append(cn)
        if cnames:
            lines.append(f"{name}: {', '.join(cnames)}")
    return "\n".join(lines) if lines else "(no column catalog)"


def _clamp_suggestions(raw: list[str], limit: int) -> list[str]:
    lim = max(1, min(int(limit), 8))
    out: list[str] = []
    for x in raw:
        s = str(x).strip()
        if not s or len(s) > 500:
            continue
        out.append(s)
        if len(out) >= lim:
            break
    return out


def _history_only_suggestions(context: list[str], limit: int) -> list[str]:
    return _clamp_suggestions(context, limit)


def build_suggested_questions(
    user_id: str,
    *,
    suggestion_limit: int = 5,
    include_kb: bool | None = None,
) -> dict[str, Any]:
    """
    Return { suggestions: list[str], source: str }.
    source: cached | llm | history_only | generic | disabled
    """
    if not _feature_enabled():
        return {"suggestions": [], "source": "disabled"}

    kb_flag = _include_kb_resolved(include_kb)
    lim = max(1, min(int(suggestion_limit), 8))
    fp_prefix = "unknown"
    try:
        from agents.query_kb_helpers import schema_fingerprint_from_schema
        from agents.schema_utils import load_schema

        fp_prefix = schema_fingerprint_from_schema(load_schema())[:24]
    except Exception:
        pass
    cache_key = f"{user_id}|kb={int(kb_flag)}|n={lim}|{fp_prefix}"
    hit = _cache_get(cache_key)
    if hit is not None:
        hit = dict(hit)
        hit["source"] = "cached"
        return hit

    from supabase_service import frequent_user_questions

    try:
        freq_rows = frequent_user_questions(user_id, 15)
    except Exception as e:
        logger.warning("frequent_user_questions failed: %s", e)
        freq_rows = []

    recent_rows: list[dict[str, Any]] = []
    try:
        from supabase_service import recent_user_questions

        recent_rows = recent_user_questions(user_id, 15)
    except Exception as e:
        logger.warning(
            "recent_user_questions failed (run backend/supabase_migrations/migrations/006_user_recent_questions.sql?): %s",
            e,
        )
        recent_rows = []

    context = _merge_question_context(freq_rows, recent_rows)
    kb_questions: list[str] = []

    if kb_flag and context and os.getenv("GOOGLE_API_KEY") and _llm_enabled():
        try:
            from agents.schema_utils import load_schema
            from db.factory import get_connector
            from embeddings import embed_text
            from query_kb_store import match_similar_queries_with_relaxation

            connector = get_connector()
            if connector:
                from agents.query_kb_helpers import schema_fingerprint_from_schema

                schema = load_schema()
                fingerprint = schema_fingerprint_from_schema(schema)
                interest = " | ".join(context[:5])
                qvec = embed_text(interest[:8000], task_type="RETRIEVAL_QUERY")
                rows, tag = match_similar_queries_with_relaxation(
                    qvec, connector.dialect, fingerprint
                )
                if tag != "rpc_error" and rows:
                    for r in rows[:4]:
                        uq = (r.get("user_question") or "").strip()
                        if uq and uq.lower() not in {c.lower() for c in context}:
                            kb_questions.append(uq)
        except Exception:
            logger.exception("suggested_questions KB retrieval failed (non-fatal)")

    if not context and not kb_questions:
        out = {"suggestions": _clamp_suggestions(list(_GENERIC_FALLBACK), lim), "source": "generic"}
        _cache_set(cache_key, out)
        return out

    if not _llm_enabled() or not os.getenv("GOOGLE_API_KEY"):
        merged = list(dict.fromkeys(context + kb_questions))
        sug = _history_only_suggestions(merged, lim)
        out = {"suggestions": sug, "source": "history_only"}
        _cache_set(cache_key, out)
        return out

    try:
        from agents.schema_utils import load_schema
        from llm import get_gemini, invoke_with_retry

        schema = load_schema()
        catalog = _schema_tables_summary(schema)
        columns_catalog = _schema_columns_catalog(schema)

        hist_block = "\n".join(f"- {q}" for q in context[:12]) if context else "(no prior user questions)"
        kb_block = (
            "\n".join(f"- {q}" for q in kb_questions[:4])
            if kb_questions
            else "(no similar proven queries from the knowledge base)"
        )

        prompt = f"""You suggest analytics questions for a signed-in user opening a new chat.

Their past questions (most relevant first; do not copy verbatim unless one is worth repeating as-is):
{hist_block}

Proven similar questions from the team's query knowledge base (successful past runs on this warehouse — use for inspiration, do not invent metrics that contradict them):
{kb_block}

Warehouse tables (high-level):
{catalog}

Warehouse columns (STRICT: every breakdown, filter, or grouping in a suggestion must map to these names only; do NOT invent fields — e.g. use customers.segment not "industry", use products.category not made-up taxonomies):
{columns_catalog}

Rules:
- Output exactly {lim} suggestions in JSON field "suggestions".
- Each suggestion: one short question, under 140 characters, business language, no SQL.
- Prefer new phrasing or angles (drill-downs, time comparisons, breakdowns) grounded in the user's themes.
- If unsure, prefer metrics/dimensions explicitly listed above.
- Stay within the retail/B2B analytics domain implied by the tables.
- Do not mention "knowledge base", "embedding", or internal systems."""

        llm = get_gemini()
        structured = llm.with_structured_output(SuggestedQuestionsOutput, method="json_mode")
        result = invoke_with_retry(structured, prompt)
        result_dict = result.model_dump() if hasattr(result, "model_dump") else result
        raw_list = result_dict.get("suggestions") or []
        sug = _clamp_suggestions([str(x) for x in raw_list if x], lim)
        if len(sug) < max(1, lim // 2):
            merged = list(dict.fromkeys(context + kb_questions))
            sug = _history_only_suggestions(merged, lim)
            out = {"suggestions": sug, "source": "history_only"}
        else:
            out = {"suggestions": sug, "source": "llm"}
        _cache_set(cache_key, out)
        return out
    except Exception:
        logger.exception("suggested_questions LLM failed; falling back to history")
        merged = list(dict.fromkeys(context + kb_questions))
        sug = _history_only_suggestions(merged, lim)
        out = {"suggestions": sug, "source": "history_only"}
        _cache_set(cache_key, out)
        return out
