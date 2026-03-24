"""
Build index text and schema fingerprint for the query knowledge base.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any


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
