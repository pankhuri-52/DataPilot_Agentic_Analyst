"""Postgres connection URI helpers for psycopg2/libpq.

Passwords embedded in a URI must not contain raw ``@`` or ``:``; use percent-encoding
(``@`` → ``%40``, ``:`` → ``%3A``) or libpq treats the first ``@`` as the end of credentials.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# libpq does not accept these; Prisma / Supabase ORM snippets append them to DATABASE_URL.
_ORM_QUERY_PARAMS_TO_STRIP = frozenset(
    {
        "pgbouncer",
        "connection_limit",
        "pool_timeout",
    }
)


def sanitize_postgres_uri_for_psycopg2(uri: str) -> str:
    """
    Remove query parameters that cause psycopg2 to raise
    ``invalid URI query parameter`` (e.g. ``?pgbouncer=true``).
    Keeps standard libpq parameters such as ``sslmode``.
    """
    raw = (uri or "").strip()
    if not raw:
        return raw
    parsed = urlparse(raw)
    if not parsed.query:
        return raw
    pairs = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in _ORM_QUERY_PARAMS_TO_STRIP
    ]
    new_query = urlencode(pairs)
    return urlunparse(parsed._replace(query=new_query))
