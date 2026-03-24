"""
Build index text and schema fingerprint for the query knowledge base.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

# Phrases that are not useful as KB keys / retrieval text (retries, approvals, continuations).
_TRIVIAL_KB_FOLLOWUP_NORMALIZED: frozenset[str] = frozenset(
    {
        "please continue",
        "continue",
        "continue please",
        "please proceed",
        "proceed",
        "go ahead",
        "go on",
        "yes",
        "yeah",
        "yep",
        "ok",
        "okay",
        "sure",
        "try again",
        "retry",
        "thanks",
        "thank you",
    }
)


def _normalize_for_trivial_check(text: str) -> str:
    t = (text or "").strip().lower()
    t = re.sub(r"[!?.…]+$", "", t).strip()
    t = re.sub(r"\s+", " ", t)
    return t


def is_trivial_kb_followup(text: str) -> bool:
    """True if this user text should not be stored or embedded as the primary KB question."""
    t = _normalize_for_trivial_check(text)
    if not t:
        return True
    if t in _TRIVIAL_KB_FOLLOWUP_NORMALIZED:
        return True
    if t.startswith("please continue") and len(t) <= 48:
        return True
    if t.startswith("please proceed") and len(t) <= 48:
        return True
    return False


def resolve_kb_user_question_for_index(
    current_query: str,
    conversation_history: list[dict[str, Any]] | None,
) -> str:
    """
    Use the substantive user question for KB storage/embedding when the current message is
    a continuation (e.g. after quota errors: 'Please continue').
    """
    q = (current_query or "").strip()
    if not is_trivial_kb_followup(q):
        return q
    hist = conversation_history or []
    for entry in reversed(hist):
        if (entry.get("role") or "").strip().lower() != "user":
            continue
        content = (entry.get("content") or "").strip()
        if not content or is_trivial_kb_followup(content):
            continue
        return content
    return q


def schema_fingerprint_from_schema(schema: dict) -> str:
    return hashlib.sha256(json.dumps(schema, sort_keys=True).encode("utf-8")).hexdigest()


def build_index_text(user_question: str, tables: list[str], columns: list[str]) -> str:
    tables_s = ", ".join(sorted({t for t in tables if t}))
    cols_s = ", ".join(sorted({c for c in columns if c}))
    return (
        f"User question: {user_question.strip()}\n"
        f"Tables: {tables_s}\n"
        f"Columns: {cols_s}"
    )


def kb_embedding_match_text(user_question: str) -> str:
    """
    Canonical string embedded at index time and at lookup time. Must stay identical on both paths
    or the same user question will not match (previously, lookup used all schema tables while
    indexing used only tables_used + guessed columns).
    """
    return f"User question: {(user_question or '').strip()}"


def build_query_side_index_text(user_question: str, schema: dict) -> str:
    """Deprecated for embeddings; use kb_embedding_match_text. Kept for callers/tests expecting schema arg."""
    _ = schema
    return kb_embedding_match_text(user_question)


def guess_columns_from_sql(sql: str) -> list[str]:
    """Best-effort column identifiers from a SELECT (for embedding context only)."""
    if not sql:
        return []
    # Remove string literals to avoid noise
    cleaned = re.sub(r"'(?:[^'\\]|\\.)*'", " ", sql, flags=re.DOTALL)
    cleaned = re.sub(r"`[^`]+`", " ", cleaned)
    seen: set[str] = set()
    for m in re.finditer(
        r"\bSELECT\b(.*?)\bFROM\b",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        chunk = m.group(1)
        for part in re.split(r",", chunk):
            part = part.strip()
            if not part or part == "*":
                continue
            token = re.sub(r"\s+as\s+\w+$", "", part, flags=re.IGNORECASE).strip()
            token = token.split()[-1] if token else ""
            token = re.sub(r'^.*\.', "", token)  # table.col -> col
            if token and token.isidentifier() and token.lower() not in ("distinct", "count", "sum", "avg", "max", "min"):
                seen.add(token)
    return sorted(seen)[:40]


def result_preview_payload(raw_results: list[dict[str, Any]] | None, max_rows: int = 15) -> dict[str, Any]:
    rows = raw_results or []
    out = []
    for r in rows[:max_rows]:
        if isinstance(r, dict):
            out.append({k: _json_safe(v) for k, v in r.items()})
    return {"rows": out, "row_count": len(rows)}


def _json_safe(v: Any) -> Any:
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (list, tuple)):
        return [_json_safe(x) for x in v[:50]]
    return str(v)[:200]
