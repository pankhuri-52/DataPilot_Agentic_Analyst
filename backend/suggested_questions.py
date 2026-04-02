"""
Personalized question suggestions: retrieve chat history (+ optional query KB), LLM-augmented prompts.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger("datapilot.suggested_questions")

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.Lock()

_GENERIC_FALLBACK = [
    "What were total sales by region in the loaded sample data?",
    "Show top 10 products by revenue.",
    "How many orders per week in the available date range?",
    "Compare return rates by product category.",
    "Which sales reps had the highest revenue in the sample period?",
]


class SuggestedQuestionsOutput(BaseModel):
    suggestions: list[dict[str, Any]] = Field(
        description=(
            "Short analytics questions answerable with ONLY the listed warehouse columns; "
            "never invent column names (e.g. customers have segment, not industry). "
            "Each item must include question and required_fields."
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


def _schema_has_usable_columns(schema: dict[str, Any]) -> bool:
    for t in schema.get("tables") or []:
        if not isinstance(t, dict):
            continue
        cols = t.get("columns")
        if not isinstance(cols, list):
            continue
        if any(isinstance(c, dict) and str(c.get("name") or "").strip() for c in cols):
            return True
    return False


def _schema_allowlist(schema: dict[str, Any]) -> set[str]:
    allow: set[str] = set()
    for t in schema.get("tables") or []:
        if not isinstance(t, dict):
            continue
        tn = str(t.get("name") or "").strip()
        if not tn:
            continue
        tkey = tn.lower()
        allow.add(tkey)
        cols = t.get("columns")
        if not isinstance(cols, list):
            continue
        for c in cols:
            if not isinstance(c, dict):
                continue
            cn = str(c.get("name") or "").strip()
            if not cn:
                continue
            ckey = cn.lower()
            allow.add(ckey)
            allow.add(f"{tkey}.{ckey}")
    return allow


def _normalize_required_field(value: str) -> str:
    s = (value or "").strip().lower()
    s = s.replace("`", "").replace('"', "")
    s = re.sub(r"\s+", "", s)
    return s


def _extract_validated_questions(
    raw_items: list[dict[str, Any]],
    allowlist: set[str],
    limit: int,
) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        if not question:
            continue
        fields = item.get("required_fields")
        if not isinstance(fields, list) or not fields:
            continue
        normalized = [_normalize_required_field(str(f)) for f in fields if str(f).strip()]
        if not normalized:
            continue
        if any(f not in allowlist for f in normalized):
            continue
        key = question.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(question)
        if len(out) >= limit:
            break
    return out


def _schema_seed_questions(schema: dict[str, Any], limit: int) -> list[str]:
    out: list[str] = []
    for t in schema.get("tables") or []:
        if not isinstance(t, dict):
            continue
        table_name = str(t.get("name") or "").strip()
        cols = t.get("columns")
        if not table_name or not isinstance(cols, list):
            continue
        numeric_cols: list[str] = []
        date_cols: list[str] = []
        dim_cols: list[str] = []
        for c in cols:
            if not isinstance(c, dict):
                continue
            name = str(c.get("name") or "").strip()
            ctype = str(c.get("type") or "").lower()
            if not name:
                continue
            if any(token in ctype for token in ("int", "numeric", "decimal", "float", "double")):
                numeric_cols.append(name)
            elif any(token in ctype for token in ("date", "time", "timestamp")):
                date_cols.append(name)
            else:
                dim_cols.append(name)

        if numeric_cols and dim_cols:
            out.append(f"What is the average {numeric_cols[0]} by {dim_cols[0]} in {table_name}?")
            if len(out) >= limit:
                return out[:limit]
            out.append(f"Show top 10 {dim_cols[0]} by total {numeric_cols[0]} in {table_name}.")
            if len(out) >= limit:
                return out[:limit]
        if numeric_cols and date_cols:
            out.append(f"How does {numeric_cols[0]} trend over {date_cols[0]} in {table_name}?")
            if len(out) >= limit:
                return out[:limit]
        if dim_cols:
            out.append(f"How many records are there by {dim_cols[0]} in {table_name}?")
            if len(out) >= limit:
                return out[:limit]
    return out[:limit]


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
    source_id: str | None = None,
) -> dict[str, Any]:
    """
    Return { suggestions: list[str], source: str }.
    source: cached | llm | history_only | generic | disabled | schema_unavailable | schema_seeded
    """
    if not _feature_enabled():
        return {"suggestions": [], "source": "disabled"}

    kb_flag = _include_kb_resolved(include_kb)
    lim = max(1, min(int(suggestion_limit), 8))
    effective_source_id = (source_id or "primary").strip() or "primary"
    fp_prefix = "unknown"
    schema: dict[str, Any] = {}
    schema_ready = False
    source_label = "Primary warehouse (metadata.json)"
    try:
        from data_sources.catalog_resolve import load_schema_catalog_for_source
        from agents.query_kb_helpers import schema_fingerprint_from_schema

        schema, source_label, _hints = load_schema_catalog_for_source(user_id, effective_source_id)
        schema_ready = _schema_has_usable_columns(schema)
        fp_prefix = schema_fingerprint_from_schema(schema)[:24]
    except Exception:
        pass
    cache_key = f"{user_id}|src={effective_source_id}|kb={int(kb_flag)}|n={lim}|{fp_prefix}|twg=1"
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

    if kb_flag and context and os.getenv("OPENAI_API_KEY") and _llm_enabled():
        try:
            from data_sources.runtime import resolve_connector_for_state
            from embeddings import embed_text
            from query_kb_store import match_similar_queries_with_relaxation
            from agents.time_window_guard import suggested_question_outside_catalog_window

            connector = resolve_connector_for_state(
                {"user_id": user_id, "active_source_id": effective_source_id}
            )
            if connector:
                from agents.query_kb_helpers import schema_fingerprint_from_schema
                fingerprint = schema_fingerprint_from_schema(schema)
                interest = " | ".join(context[:5])
                qvec = embed_text(interest[:8000], task_type="RETRIEVAL_QUERY")
                rows, tag = match_similar_queries_with_relaxation(
                    qvec, connector.dialect, fingerprint
                )
                if tag != "rpc_error" and rows:
                    for r in rows[:4]:
                        uq = (r.get("user_question") or "").strip()
                        if (
                            uq
                            and uq.lower() not in {c.lower() for c in context}
                            and not suggested_question_outside_catalog_window(uq, schema)
                        ):
                            kb_questions.append(uq)
        except Exception:
            logger.exception("suggested_questions KB retrieval failed (non-fatal)")

    if not context and not kb_questions:
        if schema_ready:
            seeded = _schema_seed_questions(schema, lim)
            if seeded:
                out = {
                    "suggestions": _clamp_suggestions(seeded, lim),
                    "source": "schema_seeded",
                    "source_id": effective_source_id,
                    "source_label": source_label,
                }
                _cache_set(cache_key, out)
                return out
        out = {
            "suggestions": _clamp_suggestions(list(_GENERIC_FALLBACK), lim),
            "source": "generic",
            "source_id": effective_source_id,
            "source_label": source_label,
        }
        _cache_set(cache_key, out)
        return out

    if not schema_ready:
        out = {
            "suggestions": [],
            "source": "schema_unavailable",
            "source_id": effective_source_id,
            "source_label": source_label,
        }
        _cache_set(cache_key, out)
        return out

    if not _llm_enabled() or not os.getenv("OPENAI_API_KEY"):
        seeded = _schema_seed_questions(schema, lim)
        sug = _clamp_suggestions(seeded, lim)
        out = {
            "suggestions": sug,
            "source": "schema_seeded" if sug else "history_only",
            "source_id": effective_source_id,
            "source_label": source_label,
        }
        _cache_set(cache_key, out)
        return out

    try:
        from llm import get_llm, invoke_structured_with_retry

        from agents.schema_utils import extract_data_ranges
        from agents.time_window_guard import suggested_question_outside_catalog_window

        catalog = _schema_tables_summary(schema)
        columns_catalog = _schema_columns_catalog(schema)
        allowlist = _schema_allowlist(schema)
        data_ranges_block = extract_data_ranges(schema)

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

DATA AVAILABILITY (dated columns — do NOT suggest "last month", "this quarter", "last 90 days", etc. unless that window overlaps these ranges; prefer "in the sample data", "in the loaded period", or explicit calendar dates inside the min/max below):
{data_ranges_block}

Rules:
- Output exactly {lim} suggestions in JSON field "suggestions".
- Each item must be object: {{"question": "...", "required_fields": ["table.column", "column"]}}.
- "required_fields" must list the exact columns needed to answer that question.
- Each suggestion: one short question, under 140 characters, business language, no SQL.
- Prefer new phrasing or angles (drill-downs, time comparisons, breakdowns) grounded in the user's themes.
- If unsure, prefer metrics/dimensions explicitly listed above.
- Stay within the retail/B2B analytics domain implied by the tables.
- Do not mention "knowledge base", "embedding", or internal systems."""

        llm = get_llm()
        result = invoke_structured_with_retry(llm, SuggestedQuestionsOutput, prompt)
        result_dict = result.model_dump() if hasattr(result, "model_dump") else result
        raw_list = result_dict.get("suggestions") or []
        sug = _extract_validated_questions(raw_list, allowlist, lim * 2)
        sug = [q for q in sug if not suggested_question_outside_catalog_window(q, schema)]
        sug = _clamp_suggestions(sug, lim)
        if len(sug) < max(1, lim // 2):
            seeded = _schema_seed_questions(schema, lim)
            sug = _clamp_suggestions(seeded, lim)
            out = {
                "suggestions": sug,
                "source": "schema_seeded" if sug else "history_only",
                "source_id": effective_source_id,
                "source_label": source_label,
            }
        else:
            out = {
                "suggestions": sug,
                "source": "llm",
                "source_id": effective_source_id,
                "source_label": source_label,
            }
        _cache_set(cache_key, out)
        return out
    except Exception:
        logger.exception("suggested_questions LLM failed; falling back to history")
        seeded = _schema_seed_questions(schema, lim)
        sug = _clamp_suggestions(seeded, lim)
        out = {
            "suggestions": sug,
            "source": "schema_seeded" if sug else "history_only",
            "source_id": effective_source_id,
            "source_label": source_label,
        }
        _cache_set(cache_key, out)
        return out
