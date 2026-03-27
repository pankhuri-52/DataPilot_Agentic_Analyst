"""Load schema catalog + connection hints per source id; multi-source planner digest and resolution."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("datapilot.catalog_resolve")


def load_schema_catalog_for_source(user_id: str | None, source_id: str) -> tuple[dict[str, Any], str, dict[str, Any]]:
    """Return (schema_catalog, human label, runtime_connection_hints) for a source id."""
    from agents.schema_utils import load_schema

    sid = (source_id or "primary").strip() or "primary"
    hints: dict[str, Any] = {}
    if sid == "primary":
        cat = load_schema()
        label = "Primary warehouse (metadata.json)"
        try:
            from db.factory import get_connector

            pc = get_connector()
            if pc:
                if pc.dialect == "bigquery":
                    label = f"BigQuery · {pc.project_id} / {pc.dataset_id}"
                    hints["bigquery_project"] = pc.project_id
                    hints["bigquery_dataset"] = pc.dataset_id
                else:
                    sch = getattr(pc, "schema", "public")
                    label = f"PostgreSQL · {sch} (env)"
                    hints["postgres_schema"] = sch
        except Exception:
            logger.debug("get_connector failed for primary label", exc_info=True)
        return cat, label, hints

    if not user_id:
        return load_schema(), "Primary warehouse (metadata.json)", hints

    from core.credentials_crypto import decrypt_config
    from data_sources.service import get_source

    row = get_source(user_id, sid)
    if not row:
        return load_schema(), "Primary warehouse (metadata.json)", hints
    snap = row.get("schema_snapshot")
    cat = snap if isinstance(snap, dict) and (snap.get("tables") or []) else load_schema()
    label = row.get("label") or sid
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
    return cat, label, hints


def build_multi_source_planner_digest(
    available: list[dict[str, Any]],
    user_id: str | None,
    active_source_id: str,
) -> str:
    from data_sources.schema_digest import compact_catalog_for_planner

    if len(available) <= 1:
        return ""

    blocks = [
        "MULTI-SOURCE SCHEMA DIGEST — each section is one database. "
        "Pick exactly one `resolved_source_id` that best answers the user. "
        "Plan metrics/dimensions only against that source’s tables.",
        "",
    ]
    active = (active_source_id or "primary").strip() or "primary"
    for s in available:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        if not sid:
            continue
        label = s.get("label") or sid
        stype = s.get("type") or "unknown"
        cat, _, _ = load_schema_catalog_for_source(user_id, str(sid))
        body = compact_catalog_for_planner(cat, max_chars=7200)
        hint = " **← UI-selected default**" if str(sid) == active else ""
        blocks.append(f"### Source id: `{sid}`{hint}")
        blocks.append(f"Label: {label} | connector: {stype}")
        blocks.append(body)
        blocks.append("")
    return "\n".join(blocks)


def combined_data_ranges_multisource(state: dict) -> str:
    """Concatenate extract_data_ranges() for each connected source."""
    from agents.schema_utils import extract_data_ranges

    parts: list[str] = []
    for s in state.get("available_sources") or []:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        if not sid:
            continue
        cat, label, _ = load_schema_catalog_for_source(state.get("user_id"), str(sid))
        r = extract_data_ranges(cat)
        if "available from" in r:
            parts.append(f"Source `{sid}` ({label}):\n{r}")
    if not parts:
        return ""
    return "DATA AVAILABILITY BY SOURCE:\n\n" + "\n\n".join(parts)


def apply_planner_source_resolution(state: dict, plan_dict: dict) -> dict[str, Any]:
    """
    If multiple sources are connected and the plan names a valid resolved_source_id
    different from the current active source, return state fields to rehydrate schema + connector.
    """
    available = state.get("available_sources") or []
    ids = [str(a["id"]) for a in available if isinstance(a, dict) and a.get("id")]
    if len(ids) <= 1:
        return {}

    raw = plan_dict.get("resolved_source_id")
    rid = (raw if isinstance(raw, str) else str(raw) if raw is not None else "").strip()
    current = (state.get("active_source_id") or "primary").strip() or "primary"
    if not rid or rid not in ids:
        rid = current

    if rid == current:
        return {}

    user_id = state.get("user_id")
    cat, label, hints = load_schema_catalog_for_source(user_id, rid)
    summary_lines = [
        f"- `{s['id']}`: {s['label']} ({s['type']})"
        for s in available
        if isinstance(s, dict) and s.get("id")
    ]
    summary = "Connected sources:\n" + "\n".join(summary_lines)
    active_line = f"**Active source for this question (planner-chosen):** `{rid}` — {label}"
    full_summary = summary + "\n\n" + active_line

    return {
        "active_source_id": rid,
        "schema_catalog": cat,
        "runtime_connection_hints": hints,
        "data_source_label": label,
        "available_sources_summary": full_summary,
    }
