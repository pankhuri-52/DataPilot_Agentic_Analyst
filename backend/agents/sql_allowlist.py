"""
SQL table allowlist: only tables declared in schema metadata may appear in queries.
Blocks system/catalog schemas (INFORMATION_SCHEMA, pg_catalog, sys., etc.).
Uses sqlparse for FROM/JOIN extraction with a regex fallback when parsing yields nothing.
"""
from __future__ import annotations

import re

import sqlparse
from sqlparse.sql import Function, Identifier, IdentifierList, Parenthesis, Token
# Schema/catalog tokens that must not appear as a qualifier (e.g. information_schema.columns).
_FORBIDDEN_QUALIFIERS = frozenset(
    {
        "information_schema",
        "pg_catalog",
        "pg_toast",
        "sys",
        "mysql",
        "performance_schema",
        "innodb",
    }
)

# Any qualified reference: forbidden_qualifier.something
_FORBIDDEN_QUALIFIED_RE = re.compile(
    r"\b(" + "|".join(re.escape(s) for s in sorted(_FORBIDDEN_QUALIFIERS)) + r")\s*\.",
    re.IGNORECASE,
)

# FROM / JOIN followed by bare forbidden name (no dot yet).
_FORBIDDEN_BARE_AFTER_FROM_JOIN = re.compile(
    r"\b(?:FROM|(?:LEFT|RIGHT|INNER|FULL|CROSS|OUTER)(?:\s+OUTER)?\s+JOIN|\bJOIN)\s+"
    r"(?:`|\")?\s*("
    + "|".join(re.escape(s) for s in sorted(_FORBIDDEN_QUALIFIERS))
    + r")\b(?!\s*\.)",
    re.IGNORECASE,
)

_FROM_JOIN_HEAD_RE = re.compile(
    r"\b(?:FROM|(?:LEFT|RIGHT|INNER|FULL|CROSS|OUTER)(?:\s+OUTER)?\s+JOIN|\bJOIN)\b",
    re.IGNORECASE,
)


def _schema_table_columns(schema: dict) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for t in schema.get("tables") or []:
        if not isinstance(t, dict):
            continue
        tname = str(t.get("name") or "").strip().lower()
        cols = t.get("columns")
        if not tname or not isinstance(cols, list):
            continue
        colset: set[str] = set()
        for c in cols:
            if not isinstance(c, dict):
                continue
            cname = str(c.get("name") or "").strip().lower()
            if cname:
                colset.add(cname)
        out[tname] = colset
    return out


def _allowed_table_names(schema: dict) -> set[str]:
    return {
        str(t.get("name") or "").strip().lower()
        for t in (schema.get("tables") or [])
        if isinstance(t, dict) and str(t.get("name") or "").strip()
    }


def _check_forbidden_catalog_refs(sql: str) -> str | None:
    if _FORBIDDEN_QUALIFIED_RE.search(sql):
        m = _FORBIDDEN_QUALIFIED_RE.search(sql)
        return f"SQL references forbidden catalog or system schema ({m.group(1) if m else 'unknown'})."
    if _FORBIDDEN_BARE_AFTER_FROM_JOIN.search(sql):
        m = _FORBIDDEN_BARE_AFTER_FROM_JOIN.search(sql)
        return f"SQL references forbidden catalog or system schema ({m.group(1) if m else 'unknown'})."
    return None


def _normalize_ref_fragment(s: str) -> str:
    s = (s or "").strip()
    s = s.strip("`").strip('"').strip("[]")
    return s


def _split_qualified_ref(ref: str) -> list[str]:
    ref = ref.replace("`", "").replace('"', "").replace("[", "").replace("]", "")
    parts: list[str] = []
    for p in ref.split("."):
        p = p.strip()
        if p:
            parts.append(p.lower())
    return parts


def _identifier_as_table_ref(ident: Identifier) -> str:
    alias = ident.get_alias()
    raw = str(ident).strip()
    if alias:
        al = alias.strip()
        lower_raw = raw.lower()
        for marker in (f" as {al.lower()}", f" {al.lower()}"):
            idx = lower_raw.rfind(marker)
            if idx != -1:
                raw = raw[:idx].strip()
                break
    return _normalize_ref_fragment(raw)


def _keyword_is_from_or_join(token: Token) -> bool:
    if not getattr(token, "is_keyword", False):
        return False
    n = (getattr(token, "normalized", None) or token.value or "").upper()
    return n == "FROM" or n == "JOIN" or n.endswith(" JOIN")


def _append_identifier(out: list[tuple[str, str | None]], ident: Identifier) -> None:
    if isinstance(ident, Function):
        return
    inner = [t for t in ident.tokens if not getattr(t, "is_whitespace", False)]
    if inner and isinstance(inner[0], Parenthesis):
        _extract_tables_sqlparse_recursive(inner[0], out)
        return
    ref = _identifier_as_table_ref(ident)
    if not ref:
        return
    alias = ident.get_alias()
    out.append((ref, alias.strip() if alias else None))


def _extract_tables_sqlparse_recursive(token, out: list[tuple[str, str | None]]) -> None:
    if isinstance(token, Parenthesis):
        for t in token.tokens:
            _extract_tables_sqlparse_recursive(t, out)
        return
    if not hasattr(token, "tokens"):
        return
    children = list(token.tokens)
    i = 0
    while i < len(children):
        c = children[i]
        if getattr(c, "is_whitespace", False):
            i += 1
            continue
        if _keyword_is_from_or_join(c):
            i += 1
            while i < len(children) and getattr(children[i], "is_whitespace", False):
                i += 1
            if i >= len(children):
                break
            nxt = children[i]
            if isinstance(nxt, Parenthesis):
                _extract_tables_sqlparse_recursive(nxt, out)
                i += 1
                continue
            if isinstance(nxt, IdentifierList):
                for ident in nxt.get_identifiers():
                    if isinstance(ident, Identifier):
                        _append_identifier(out, ident)
                i += 1
                continue
            if isinstance(nxt, Identifier):
                _append_identifier(out, nxt)
                i += 1
                continue
            i += 1
            continue
        _extract_tables_sqlparse_recursive(c, out)
        i += 1


def extract_referenced_tables_with_aliases(sql: str) -> list[tuple[str, str | None]]:
    """(qualified_or_bare_ref, alias_or_none) from each FROM/JOIN table slot."""
    out: list[tuple[str, str | None]] = []
    try:
        stmts = sqlparse.parse(sql)
    except Exception:
        stmts = []
    for stmt in stmts or []:
        _extract_tables_sqlparse_recursive(stmt, out)
    seen: set[tuple[str, str | None]] = set()
    deduped: list[tuple[str, str | None]] = []
    for item in out:
        k = (item[0].lower(), (item[1] or "").lower() if item[1] else None)
        if k[0] and k not in seen:
            seen.add(k)
            deduped.append(item)
    return deduped


def _skip_ws_and_comments(s: str, i: int) -> int:
    n = len(s)
    while i < n:
        if s[i].isspace():
            i += 1
            continue
        if s[i : i + 2] == "--":
            while i < n and s[i] != "\n":
                i += 1
            continue
        if s[i : i + 2] == "/*":
            end = s.find("*/", i + 2)
            i = end + 2 if end != -1 else n
            continue
        break
    return i


def _read_one_table_ref(s: str, start: int) -> tuple[str | None, int]:
    i = _skip_ws_and_comments(s, start)
    n = len(s)
    if i >= n:
        return None, i
    if s[i] == "(":
        return None, i
    buf: list[str] = []
    if s[i] == "`":
        i += 1
        while i < n and s[i] != "`":
            buf.append(s[i])
            i += 1
        if i < n and s[i] == "`":
            i += 1
        return ("".join(buf).strip() or None), i
    if s[i] == '"':
        i += 1
        while i < n and s[i] != '"':
            buf.append(s[i])
            i += 1
        if i < n:
            i += 1
        return ("".join(buf).strip() or None), i
    if s[i] == "[":
        i += 1
        while i < n and s[i] != "]":
            buf.append(s[i])
            i += 1
        if i < n:
            i += 1
        return ("".join(buf).strip() or None), i
    while i < n:
        c = s[i]
        if c.isalnum() or c in "._":
            buf.append(c)
            i += 1
            continue
        break
    t = "".join(buf).strip()
    return (t or None), i


def _read_optional_alias(s: str, start: int) -> tuple[str | None, int]:
    i = _skip_ws_and_comments(s, start)
    n = len(s)
    if i >= n:
        return None, i
    rest = s[i:]
    if len(rest) >= 2 and rest[:2].upper() == "AS" and (len(rest) == 2 or not rest[2].isalnum()):
        i = _skip_ws_and_comments(s, i + 2)
    j = i
    if j < n and (s[j].isalpha() or s[j] == "_"):
        buf: list[str] = []
        while j < n and (s[j].isalnum() or s[j] == "_"):
            buf.append(s[j])
            j += 1
        word = "".join(buf)
        upper = word.upper()
        if upper not in {
            "WHERE",
            "GROUP",
            "ORDER",
            "LIMIT",
            "HAVING",
            "UNION",
            "EXCEPT",
            "INTERSECT",
            "JOIN",
            "INNER",
            "LEFT",
            "RIGHT",
            "FULL",
            "CROSS",
            "OUTER",
            "ON",
            "AND",
            "OR",
        }:
            return word, j
    return None, i


def _extract_tables_regex_fallback(sql: str) -> list[tuple[str, str | None]]:
    out: list[tuple[str, str | None]] = []
    for m in _FROM_JOIN_HEAD_RE.finditer(sql):
        i = _skip_ws_and_comments(sql, m.end())
        if i < len(sql) and sql[i] == "(":
            continue
        while True:
            name, j = _read_one_table_ref(sql, i)
            if not name:
                break
            ref = _normalize_ref_fragment(name)
            j = _skip_ws_and_comments(sql, j)
            alias, j2 = _read_optional_alias(sql, j)
            out.append((ref, alias))
            j = _skip_ws_and_comments(sql, j2)
            if j < len(sql) and sql[j] == ",":
                i = j + 1
                continue
            break
    seen: set[tuple[str, str | None]] = set()
    deduped: list[tuple[str, str | None]] = []
    for ref, al in out:
        k = (ref.lower(), (al or "").lower() if al else None)
        if k[0] and k not in seen:
            seen.add(k)
            deduped.append((ref, al))
    return deduped


def extract_referenced_tables_with_aliases_fallback(sql: str) -> list[tuple[str, str | None]]:
    refs = extract_referenced_tables_with_aliases(sql)
    if not refs and re.search(r"\bFROM\b", sql, re.IGNORECASE):
        refs = _extract_tables_regex_fallback(sql)
    return refs


def _validate_ref_parts_against_allowlist(parts: list[str], allowed: set[str]) -> str | None:
    if not parts:
        return "Empty table reference."
    for seg in parts:
        if seg in _FORBIDDEN_QUALIFIERS:
            return f"Forbidden catalog or system schema in table reference: {seg}."
    base = parts[-1]
    if base in _FORBIDDEN_QUALIFIERS:
        return f"Forbidden catalog or system schema in table reference: {base}."
    if base not in allowed:
        return f"Unknown or unauthorized table referenced: {base}."
    return None


def validate_sql_against_schema(sql: str, schema: dict) -> tuple[bool, str | None]:
    """
    Ensure SQL only uses tables present in schema metadata; reject system catalogs.
    Then validate column references against the same catalog.
    """
    table_cols = _schema_table_columns(schema)
    if not table_cols:
        return False, "Schema catalog is empty; no tables available."

    allowed = _allowed_table_names(schema)

    err = _check_forbidden_catalog_refs(sql)
    if err:
        return False, err

    pairs = extract_referenced_tables_with_aliases_fallback(sql)
    if not pairs:
        return False, "SQL has no FROM/JOIN table references."

    alias_map: dict[str, str] = {}
    for raw, alias in pairs:
        parts = _split_qualified_ref(raw)
        e = _validate_ref_parts_against_allowlist(parts, allowed)
        if e:
            return False, e
        base_table = parts[-1]
        alias_map[base_table] = base_table
        if alias:
            alias_map[alias.strip().lower()] = base_table

    for a, col in re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b", sql):
        al = a.lower()
        c = col.lower()
        if al in alias_map:
            table_name = alias_map[al]
            if c not in table_cols.get(table_name, set()):
                return False, f"Unknown column '{col}' on table '{table_name}'."
        elif al in table_cols and c not in table_cols[al]:
            return False, f"Unknown column '{col}' on table '{a}'."
    return True, None


def extract_known_metadata_tables(sql: str, schema: dict) -> list[str]:
    """Tables from SQL that exist in metadata (for Postgres size hints, etc.)."""
    allowed = _allowed_table_names(schema)
    found: list[str] = []
    for raw, _ in extract_referenced_tables_with_aliases_fallback(sql):
        parts = _split_qualified_ref(raw)
        if not parts:
            continue
        base = parts[-1]
        if base in allowed and base not in found:
            found.append(base)
    return found
