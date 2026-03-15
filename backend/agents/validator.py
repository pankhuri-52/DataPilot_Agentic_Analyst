"""
Validation Agent – sanity checks on query results.
"""
from agents.state import TraceEntry


def run_validator(state: dict) -> dict:
    """Validation Agent: check empty results, basic schema match."""
    raw_results = state.get("raw_results")
    trace = state.get("trace", [])

    trace.append(
        TraceEntry(agent="validator", status="info", message="Validating query results...").model_dump()
    )

    if raw_results is None:
        trace.append(TraceEntry(agent="validator", status="info", message="No results to validate").model_dump())
        return {"validation_ok": False, "trace": trace}

    trace.append(
        TraceEntry(agent="validator", status="info", message="Checking result schema consistency...").model_dump()
    )

    validation_ok = True
    issues = []

    # Empty results
    if len(raw_results) == 0:
        validation_ok = True  # Empty is valid (no matching data)
        issues.append("Query returned 0 rows")

    # Basic schema: all rows should have same keys
    if raw_results:
        keys = set(raw_results[0].keys())
        for i, row in enumerate(raw_results[1:], 1):
            row_keys = set(row.keys())
            if row_keys != keys:
                validation_ok = False
                issues.append(f"Row {i} has inconsistent columns")
                break

    trace.append(
        TraceEntry(
            agent="validator",
            status="success" if validation_ok else "error",
            message="Validation passed" if validation_ok else "; ".join(issues),
            output={"validation_ok": validation_ok, "row_count": len(raw_results), "issues": issues},
        ).model_dump()
    )

    return {"validation_ok": validation_ok, "trace": trace}
