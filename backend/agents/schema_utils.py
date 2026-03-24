"""
Shared schema utilities – load metadata and extract data ranges for planner and discovery.
"""
import json
from pathlib import Path


def load_schema() -> dict:
    """Load static schema metadata from metadata.json."""
    backend_dir = Path(__file__).resolve().parent.parent
    schema_path = backend_dir / "schema" / "metadata.json"
    with open(schema_path, encoding="utf-8") as f:
        return json.load(f)


def plan_result_limit_display(plan: dict | None) -> str:
    """Human-readable result_limit line for SQL-generation prompts."""
    if not plan:
        return "not specified"
    rl = plan.get("result_limit")
    if isinstance(rl, int) and rl > 0:
        return str(rl)
    return "not specified (open-ended breakdown; cap at 1000 rows in SQL)"


def sql_row_limit_rule_5(plan: dict | None) -> str:
    """Optimizer/executor prompt rule: LIMIT 1..1000 from plan.result_limit, else 1000."""
    if not plan:
        return "Limit results to at most 1000 rows (add LIMIT 1000)."
    rl = plan.get("result_limit")
    if isinstance(rl, int) and rl > 0:
        n = min(rl, 1000)
        return (
            f"The plan sets result_limit={rl}: after ORDER BY on the primary metric, use LIMIT {n} "
            "(never more than 1000 rows on the final SELECT)."
        )
    return "Limit results to at most 1000 rows (add LIMIT 1000)."


def extract_data_ranges(schema: dict) -> str:
    """Extract data_range metadata from schema for date columns. Returns formatted string for prompt."""
    ranges = []
    for table in schema.get("tables", []):
        tname = table.get("name", "")
        for col in table.get("columns", []):
            dr = col.get("data_range")
            if dr and isinstance(dr, dict):
                min_val = dr.get("min", "?")
                max_val = dr.get("max", "?")
                ranges.append(f"- {tname}.{col.get('name', '')}: available from {min_val} to {max_val}")
    if not ranges:
        return "No static data_range metadata available for date columns."
    return "Data availability (static metadata for date columns):\n" + "\n".join(ranges)


def get_global_data_range(schema: dict) -> tuple[str | None, str | None]:
    """
    Get the overall min and max date across all date columns with data_range.
    Returns (min_date, max_date) or (None, None) if no ranges.
    """
    all_mins, all_maxs = [], []
    for table in schema.get("tables", []):
        for col in table.get("columns", []):
            dr = col.get("data_range")
            if dr and isinstance(dr, dict):
                mn, mx = dr.get("min"), dr.get("max")
                if mn and mx:
                    all_mins.append(mn)
                    all_maxs.append(mx)
    if not all_mins or not all_maxs:
        return None, None
    return min(all_mins), max(all_maxs)
