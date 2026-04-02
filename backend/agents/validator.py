"""
Validation Agent – sanity checks on query results.
"""
from agents.state import TraceEntry
from agents.trace_stream import append_trace
from llm import coerce_ai_text, get_llm, invoke_with_retry
from langfuse_setup import get_prompt
from langfuse_setup import safe_update_current_span

_RELEVANCE_PROMPT = """You are a data quality checker. Your only job is to decide whether a SQL result set
actually answers the user's question.

User question: {query}

SQL that was run:
{sql}

First 5 rows of results:
{sample}

Does this result set look like a correct and relevant answer to the question?
Reply with exactly one word on the first line: YES or NO.
Then on a new line, give a single sentence explaining why (be specific about what is wrong if NO).

Example YES response:
YES
The results show monthly revenue totals broken down by region, which directly answers the question.

Example NO response:
NO
The results show product names and stock levels, but the question asked for total revenue by customer segment."""

_MAX_VALIDATOR_RETRIES = 1


def run_validator(state: dict) -> dict:
    """Validation Agent: check empty results, basic schema match, and LLM relevance."""
    raw_results = state.get("raw_results")
    trace = state.get("trace", [])

    append_trace(
        trace,
        TraceEntry(agent="validator", status="info", message="Validating query results...").model_dump()
    )

    if raw_results is None:
        append_trace(
            trace,
            TraceEntry(agent="validator", status="info", message="No results to validate").model_dump(),
        )
        return {"validation_ok": False, "trace": trace}

    append_trace(
        trace,
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

    append_trace(
        trace,
        TraceEntry(
            agent="validator",
            status="success" if validation_ok else "error",
            message="Validation passed" if validation_ok else "; ".join(issues),
            output={"validation_ok": validation_ok, "row_count": len(raw_results), "issues": issues},
        ).model_dump(),
    )

    # LLM relevance check — only when structural validation passed and there are rows to inspect
    retry_count = int(state.get("validator_retry_count") or 0)
    if validation_ok and raw_results and retry_count < _MAX_VALIDATOR_RETRIES:
        validation_ok, relevance_hint = _check_relevance(state, raw_results, trace)
        if not validation_ok:
            return {
                "validation_ok": False,
                "relevance_check_hint": relevance_hint,
                "validator_retry_count": retry_count + 1,
                "trace": trace,
            }

    safe_update_current_span(
        input={"query": state.get("query", ""), "row_count": len(raw_results) if raw_results else 0},
        output={"validation_ok": validation_ok, "issues": issues},
        metadata={"agent": "validator"},
    )
    return {"validation_ok": validation_ok, "trace": trace}


def _check_relevance(state: dict, raw_results: list, trace: list) -> tuple[bool, str | None]:
    """Run a lightweight LLM check: do these results actually answer the question?
    Returns (is_relevant, hint_for_optimizer_or_None)."""
    query = state.get("query", "")
    sql = state.get("sql", "")
    sample = raw_results[:5]

    append_trace(
        trace,
        TraceEntry(agent="validator", status="info", message="Running LLM relevance check on results...").model_dump(),
    )

    try:
        llm = get_llm()
        prompt = get_prompt("datapilot-validator-relevance", _RELEVANCE_PROMPT).format(query=query, sql=sql, sample=sample)
        response = invoke_with_retry(llm, prompt)
        text = coerce_ai_text(response).strip()

        first_line = text.split("\n")[0].strip().upper()
        explanation = text.split("\n", 1)[1].strip() if "\n" in text else ""

        if first_line == "NO":
            hint = (
                f"The previous SQL returned results that do not answer the user's question. "
                f"Relevance check reason: {explanation} "
                f"Rewrite the SQL so the results directly address: \"{query}\""
            )
            append_trace(
                trace,
                TraceEntry(
                    agent="validator",
                    status="warning",
                    message=f"Relevance check failed: {explanation}",
                    output={"relevance_ok": False, "reason": explanation},
                ).model_dump(),
            )
            return False, hint

        append_trace(
            trace,
            TraceEntry(
                agent="validator",
                status="success",
                message="Relevance check passed",
                output={"relevance_ok": True},
            ).model_dump(),
        )
        return True, None

    except Exception as e:
        # Fail open: if the relevance LLM call errors, don't block the pipeline
        append_trace(
            trace,
            TraceEntry(
                agent="validator",
                status="info",
                message=f"Relevance check skipped (LLM error): {e}",
            ).model_dump(),
        )
        return True, None
