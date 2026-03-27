"""Effective schema + connector from LangGraph state (multi-source)."""
from __future__ import annotations

from typing import Any


def get_effective_schema(state: dict | None) -> dict:
    if state and isinstance(state.get("schema_catalog"), dict):
        tables = state["schema_catalog"].get("tables")
        if isinstance(tables, list) and len(tables) > 0:
            return state["schema_catalog"]
    from agents.schema_utils import load_schema

    return load_schema()


def get_effective_connector(state: dict | None) -> Any | None:
    if not state:
        try:
            from db.factory import get_connector

            return get_connector()
        except Exception:
            return None
    from data_sources.runtime import resolve_connector_for_state

    return resolve_connector_for_state(state)
