"""Compact schema text for LLM prompts (multi-source routing, planner context)."""
from __future__ import annotations

from typing import Any


def compact_catalog_for_planner(catalog: dict[str, Any], *, max_chars: int = 7500) -> str:
    """Human-readable schema: tables, columns, descriptions, optional sample_values and data_range."""
    lines: list[str] = []
    if catalog.get("import_context"):
        ic = str(catalog["import_context"]).strip()
        if ic:
            lines.append(f"Import context: {ic[:600]}{'…' if len(ic) > 600 else ''}")
    desc = (catalog.get("description") or "").strip()
    if desc:
        lines.append(f"Catalog: {desc[:800]}{'…' if len(desc) > 800 else ''}")
    ds = catalog.get("dataset")
    if ds:
        lines.append(f"Dataset / schema key: {ds}")
    rel = catalog.get("relationships") or []
    if isinstance(rel, list) and rel:
        lines.append("Relationships: " + "; ".join(str(x) for x in rel[:30]))
        if len(rel) > 30:
            lines.append(f"… +{len(rel) - 30} more")

    for table in catalog.get("tables") or []:
        tname = table.get("name") or "?"
        tdesc = (table.get("description") or "").strip()
        lines.append(f"\nTable `{tname}`" + (f": {tdesc[:400]}" if tdesc else ""))
        for col in table.get("columns") or []:
            cn = col.get("name") or "?"
            ct = col.get("type") or "?"
            cd = (col.get("description") or "").strip()
            parts = [f"  - {cn} ({ct})"]
            if cd:
                parts.append(cd[:300])
            sv = col.get("sample_values")
            if isinstance(sv, list) and sv:
                shown = []
                for v in sv[:5]:
                    s = str(v).replace("\n", " ").strip()
                    if len(s) > 48:
                        s = s[:45] + "…"
                    shown.append(repr(s))
                parts.append("examples: " + ", ".join(shown))
            dr = col.get("data_range")
            if isinstance(dr, dict) and dr.get("min") and dr.get("max"):
                parts.append(f"date range: {dr['min']} .. {dr['max']}")
            lines.append(" — ".join(parts))

    text = "\n".join(lines)
    if len(text) > max_chars:
        return text[: max_chars - 20] + "\n…(schema truncated)"
    return text
