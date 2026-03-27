"""Supabase persistence for user_data_sources (service role)."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from core.retry import retry_sync

logger = logging.getLogger("datapilot.data_sources")


def _service():
    from supabase_service import _get_service_client

    return _get_service_client()


def list_sources(user_id: str) -> list[dict[str, Any]]:
    def _run():
        c = _service()
        r = (
            c.table("user_data_sources")
            .select("id, label, source_type, schema_fingerprint, healthy, last_error, created_at, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return [dict(row) for row in (r.data or [])]

    return retry_sync("user_data_sources.list", _run)


def get_source(user_id: str, source_id: str) -> dict[str, Any] | None:
    def _run():
        c = _service()
        r = (
            c.table("user_data_sources")
            .select("*")
            .eq("user_id", user_id)
            .eq("id", source_id)
            .limit(1)
            .execute()
        )
        rows = r.data or []
        return dict(rows[0]) if rows else None

    return retry_sync("user_data_sources.get", _run)


def insert_source(
    user_id: str,
    label: str,
    source_type: str,
    encrypted_config: str,
    schema_snapshot: dict,
    schema_fingerprint: str,
    *,
    healthy: bool = True,
    last_error: str | None = None,
) -> dict[str, Any]:
    def _run():
        c = _service()
        row_id = str(uuid.uuid4())
        row = {
            "id": row_id,
            "user_id": user_id,
            "label": label,
            "source_type": source_type,
            "encrypted_config": encrypted_config,
            "schema_snapshot": schema_snapshot,
            "schema_fingerprint": schema_fingerprint,
            "healthy": healthy,
            "last_error": last_error,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        # supabase-py v2: .insert() does not support chaining .select(); use .execute() only.
        r = c.table("user_data_sources").insert(row).execute()
        rows = r.data or []
        if rows:
            return dict(rows[0])
        fetched = get_source(user_id, row_id)
        if fetched:
            return fetched
        raise ValueError("insert user_data_sources returned no row")

    return retry_sync("user_data_sources.insert", _run)


def update_source_health(
    user_id: str,
    source_id: str,
    *,
    healthy: bool,
    last_error: str | None,
    schema_snapshot: dict | None = None,
    schema_fingerprint: str | None = None,
) -> None:
    def _run():
        c = _service()
        patch: dict[str, Any] = {
            "healthy": healthy,
            "last_error": last_error,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if schema_snapshot is not None:
            patch["schema_snapshot"] = schema_snapshot
        if schema_fingerprint is not None:
            patch["schema_fingerprint"] = schema_fingerprint
        c.table("user_data_sources").update(patch).eq("user_id", user_id).eq("id", source_id).execute()

    retry_sync("user_data_sources.update_health", _run)


def delete_source(user_id: str, source_id: str) -> bool:
    def _run():
        c = _service()
        r = c.table("user_data_sources").delete().eq("user_id", user_id).eq("id", source_id).execute()
        return bool(r.data)

    return retry_sync("user_data_sources.delete", _run)
