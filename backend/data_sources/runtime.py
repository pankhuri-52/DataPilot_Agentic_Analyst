"""Resolve schema + connector from env primary or saved user_data_sources row."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("datapilot.runtime")


def resolve_connector_for_state(state: dict) -> Any | None:
    """Return a DatabaseConnector for the active source in graph state."""
    uid = state.get("user_id")
    sid = (state.get("active_source_id") or "primary").strip() or "primary"
    if sid == "primary":
        try:
            from db.factory import get_connector

            return get_connector()
        except Exception:
            return None
    if not uid:
        return None
    try:
        from core.credentials_crypto import decrypt_config
        from data_sources.service import get_source
        from db.bigquery_connector import BigQueryConnector
        from db.postgres_connector import PostgresConnector

        row = get_source(uid, sid)
        if not row:
            return None
        cfg = decrypt_config(row["encrypted_config"])
        st = row["source_type"]
        if st in ("postgres", "csv_upload"):
            schema = cfg.get("schema") or "public"
            if cfg.get("host") and cfg.get("dbname"):
                kw = {
                    "host": cfg["host"],
                    "port": int(cfg.get("port") or 5432),
                    "dbname": cfg["dbname"],
                    "user": cfg["user"],
                    "password": cfg.get("password") or "",
                }
                return PostgresConnector(None, schema, connect_kwargs=kw)
            url = cfg.get("connection_url")
            if not url:
                return None
            return PostgresConnector(url, schema)
        if st == "bigquery":
            pj = cfg.get("project_id")
            ds = cfg.get("dataset_id")
            if not pj or not ds:
                return None
            creds = cfg.get("credentials_json")
            if isinstance(creds, str):
                creds = json.loads(creds)
            return BigQueryConnector(pj, ds, credentials_info=creds if isinstance(creds, dict) else None)
    except Exception:
        logger.exception("resolve_connector_for_state failed for source %s", sid)
        return None
    return None


def build_initial_runtime_state(user_id: str | None, source_id: str | None) -> dict[str, Any]:
    """
    Fields merged into LangGraph initial state: schema_catalog, hints, source labels.
    """
    from agents.schema_utils import load_schema
    from data_sources.service import list_sources

    sid = (source_id or "primary").strip() or "primary"

    available: list[dict[str, Any]] = []
    hints: dict[str, Any] = {}
    try:
        from db.factory import get_connector

        pc = get_connector()
        if pc:
            if pc.dialect == "bigquery":
                available.append(
                    {
                        "id": "primary",
                        "label": f"BigQuery · {pc.project_id} / {pc.dataset_id}",
                        "type": "bigquery",
                    }
                )
                hints["bigquery_project"] = pc.project_id
                hints["bigquery_dataset"] = pc.dataset_id
            else:
                sch = getattr(pc, "schema", "public")
                available.append(
                    {
                        "id": "primary",
                        "label": f"PostgreSQL · {sch} (env)",
                        "type": "postgres",
                    }
                )
                hints["postgres_schema"] = sch
    except Exception:
        pass

    user_sources: list[dict] = []
    if user_id:
        try:
            user_sources = list_sources(user_id)
        except Exception:
            logger.debug("list_sources failed", exc_info=True)

    for row in user_sources:
        available.append(
            {
                "id": str(row["id"]),
                "label": row.get("label") or row["source_type"],
                "type": row.get("source_type"),
            }
        )

    schema_catalog = load_schema()
    data_source_label = "Primary warehouse (metadata.json)"
    effective_sid = sid

    if sid != "primary" and user_id:
        from core.credentials_crypto import decrypt_config
        from data_sources.service import get_source

        row = get_source(user_id, sid)
        if row:
            snap = row.get("schema_snapshot")
            if isinstance(snap, dict) and snap.get("tables"):
                schema_catalog = snap
            data_source_label = row.get("label") or sid
            try:
                cfg = decrypt_config(row["encrypted_config"])
            except Exception:
                cfg = {}
            st = row["source_type"]
            if st in ("postgres", "csv_upload"):
                hints["postgres_schema"] = cfg.get("schema") or "public"
            elif st == "bigquery":
                hints["bigquery_project"] = cfg.get("project_id")
                hints["bigquery_dataset"] = cfg.get("dataset_id")
        else:
            # Unknown id — fall back to primary catalog
            effective_sid = "primary"
            data_source_label = "Primary warehouse (metadata.json)"

    summary_lines = [f"- `{s['id']}`: {s['label']} ({s['type']})" for s in available]
    summary = (
        "Connected sources (user may switch in the UI):\n" + "\n".join(summary_lines)
        if summary_lines
        else "No warehouse sources are configured."
    )
    active_line = f"**Active source for this question:** `{effective_sid}` — {data_source_label}"
    full_summary = summary + "\n\n" + active_line

    return {
        "user_id": user_id,
        "active_source_id": effective_sid,
        "schema_catalog": schema_catalog,
        "runtime_connection_hints": hints,
        "available_sources": available,
        "available_sources_summary": full_summary,
        "data_source_label": data_source_label,
    }
