"""
Planning Agent – validates query and produces structured analysis plan.
Checks data availability early: if the user asks for a time period outside the database range,
stops and asks if they want to proceed with the available range instead.
"""
import json
import re
from llm import get_gemini, invoke_with_retry
from agents.state import AnalysisPlan, TraceEntry
from agents.trace_stream import append_trace
from agents.context import get_effective_schema
from agents.schema_utils import extract_data_ranges

_SCHEMA_INTROSPECTION_PATTERNS = re.compile(
    r"\b("
    r"what (data|tables?|columns?|fields?|information|metrics?|dimensions?|schema)"
    r"|what can (you|i|we) (tell|see|find|ask|query|analyze|do)"
    r"|what('?s| is) (available|in (the |this )?(data|database|db|warehouse|dataset))"
    r"|show (me )?(the )?(tables?|schema|columns?|available data|data structure)"
    r"|list (the )?(tables?|columns?|schema|available)"
    r"|describe (the )?(data|tables?|schema|database|warehouse)"
    r"|what kind(s)? of"
    r"|what do (you|we) have"
    r"|how is (the )?data (structured|organized)"
    r")\b",
    re.IGNORECASE,
)


def _is_schema_introspection_query(query: str) -> bool:
    """Return True when the user is asking about data structure/availability, not analytics."""
    return bool(_SCHEMA_INTROSPECTION_PATTERNS.search(query.strip()))


def _build_schema_markdown(schema: dict) -> str:
    """Build a human-readable markdown summary of the connected schema."""
    lines: list[str] = []
    tables = schema.get("tables") or []
    source_kind = (schema.get("source_kind") or "").strip().lower()
    db_label = "spreadsheet" if source_kind in ("user_csv", "csv_upload") else "warehouse"

    lines.append(f"Here's what's available in your connected {db_label}:\n")

    if not tables:
        lines.append("_No tables found in the connected data source._")
        return "\n".join(lines)

    for t in tables:
        if not isinstance(t, dict):
            continue
        name = (t.get("name") or "").strip()
        if not name:
            continue
        desc = (t.get("description") or "").strip()
        row_count = t.get("row_count")
        count_str = f" · {row_count:,} rows" if isinstance(row_count, int) and row_count > 0 else ""
        header = f"**{name}**{count_str}"
        if desc:
            header += f" — {desc}"
        lines.append(f"### {header}")

        cols = t.get("columns") or []
        if cols:
            col_lines: list[str] = []
            for c in cols:
                if not isinstance(c, dict):
                    continue
                cn = (c.get("name") or "").strip()
                ct = (c.get("type") or c.get("data_type") or "").strip()
                cdesc = (c.get("description") or "").strip()
                if not cn:
                    continue
                col_entry = f"- `{cn}`"
                if ct:
                    col_entry += f" _{ct}_"
                if cdesc:
                    col_entry += f" — {cdesc}"
                col_lines.append(col_entry)
            lines.extend(col_lines)
        lines.append("")

    relationships = schema.get("relationships") or []
    if relationships:
        lines.append("**Relationships:**")
        for rel in relationships:
            if not isinstance(rel, dict):
                continue
            fk = rel.get("from_table", "?")
            fc = rel.get("from_column", "?")
            tt = rel.get("to_table", "?")
            tc = rel.get("to_column", "?")
            lines.append(f"- `{fk}.{fc}` → `{tt}.{tc}`")
        lines.append("")

    lines.append("You can ask me anything about this data — for example:")
    table_names = [t["name"] for t in tables if isinstance(t, dict) and t.get("name")]
    if table_names:
        first = table_names[0]
        lines.append(f'- "How many rows are in {first}?"')
        lines.append(f'- "Show me the top 10 records from {first}"')
    lines.append('- "What are total sales by region?"')

    return "\n".join(lines)

EXECUTION_PHASE_ORDER = (
    "planner",
    "discovery",
    "optimizer",
    "executor",
    "validator",
    "visualization",
)

DEFAULT_STEP_LABELS: dict[str, str] = {
    "planner": "Plan the analysis",
    "discovery": "Check data availability",
    "optimizer": "Build SQL and review cost",
    "executor": "Execute the query",
    "validator": "Validate results",
    "visualization": "Visualize and explain",
}

OUT_OF_SCOPE_MESSAGE = (
    "I can only help with questions about the data you’ve connected—for example sales, revenue, "
    "orders, products, customers, and metrics in your warehouse. Ask something about those datasets, "
    "or rephrase your question to be about your business data."
)

PLANNER_PROMPT = """You are a data analytics planning agent. A business user has asked a question about their data.

User question: {query}

{CONVERSATION_HISTORY_SECTION}

{SOURCES_SUMMARY_SECTION}

{MULTI_SOURCE_SCHEMA_SECTION}

{IMPORT_CONTEXT_SECTION}

{DATA_AVAILABILITY_SECTION}

Your job:
1. Determine if the question is valid and analyzable (e.g. about sales, revenue, orders, products, customers, brands, campaigns, shipments, returns, regions, segments, sales reps).
2. If the question asks for a time period (e.g. "last month", "last quarter", "last year", specific dates): check whether that period falls within the DATA AVAILABILITY above. If the requested period is OUTSIDE the available range (e.g. the user asks for dates before the earliest or after the latest order/sales window in DATA AVAILABILITY), set is_valid=false and add a clarifying_question that:
   (a) States that the data for the requested period is not available in the database.
   (b) States the available range using the exact min and max dates from DATA AVAILABILITY for the relevant column (illustrative shape only: "We have orders from 2024-03-01 to 2025-03-01" — always copy real values from DATA AVAILABILITY above, not this example if they differ).
   (c) Offers to answer the same question for the available range (e.g. "Would you like to get total sales by region for this available period instead?").
3. If VALID and time range is within availability: produce a structured analysis plan with:
   - metrics: what to measure (e.g. revenue, total_amount, units_sold, count of orders)
   - dimensions: what to group by (e.g. region, category, segment, product, date)
   - filters: any constraints (e.g. date range, status, region)
   - result_limit: optional integer. Set to 1 when the user asks for a single winner (e.g. "name one brand", "which product sold the most", "who had the highest"). Set to N when they explicitly ask for top N. Omit or null when they want an open-ended comparison of all groups (no numeric cap).
4. If INVALID for other reasons (too vague, off-topic, unclear): set is_valid=false and provide clarifying_questions to help the user refine.

5. Always set query_scope to exactly one of:
   - "data_question": the message is about analyzing connected business / warehouse data.
   - "out_of_scope": the message is not about that data (e.g. general knowledge, coding help, weather, chit-chat).
   - "needs_clarification": the user might mean a data question but it is too vague to plan (set is_valid=false and add clarifying_questions).

Rules:
- If MULTI-SOURCE SCHEMA DIGEST is present above: you MUST set resolved_source_id to exactly one of the source ids shown (the value in backticks after “Source id:”). Choose the database whose tables and domains match the user’s question (e.g. HR/employees vs retail orders). If two sources could apply, prefer the one marked **UI-selected default**. Downstream SQL cannot join across sources; plan only for the chosen source.
- If multi-source digest is NOT present: leave resolved_source_id null or empty. Plan for the single active source described in WAREHOUSE / SOURCES CONTEXT.
- Only analytics questions about business data (sales, orders, products, customers, brands, campaigns, fulfillment, returns, reps) are valid when they map to the connected warehouse — **unless** USER-UPLOADED SPREADSHEET rules appear below; then follow those for validity.
- Use lowercase for metric/dimension names that could map to database columns.
- For date filters, use keys like "start_date", "end_date" or "period" (e.g. "last_quarter").
- Keep clarifying questions concise and actionable.
- When data is outside range, ALWAYS include the exact min and max dates from DATA AVAILABILITY in your clarifying_question (never invent dates; different date columns can have different ranges).

CONVERSATIONAL CONTEXT (when conversation history is provided):
- If the user's current message is a brief affirmation (e.g. "Sure", "Yes", "Okay", "Yes please", "Go ahead", "That works") AND the previous assistant message contained a clarifying question offering to answer for the available data range, treat the user as agreeing.
- In that case: produce a VALID plan that answers the ORIGINAL user question (from the history) but with filters set to the available date range (start_date and end_date from DATA AVAILABILITY). Set is_valid=true and include the appropriate filters.

6. When is_valid=true: include execution_steps — exactly 6 objects in this pipeline order (same order every time).
   Each phase value must be exactly one of: planner, discovery, optimizer, executor, validator, visualization.
   UI CONSTRAINTS (important — users scan a checklist, not an essay):
   - title: short label only, max ~10 words, Title Case or sentence case, no trailing period. Example: "Map plan to warehouse tables" not a long sentence.
   - detail: at most 2 short sentences OR ~220 characters total. State the one concrete thing this step does for THIS question; avoid generic data-warehouse lectures, repeated wording across steps, and bullet lists.
   Phases (what to write):
   (1) planner — title names the analysis goal; detail: metrics, dimensions, filters in one tight line if not already obvious from the title.
   (2) discovery — title + detail: which entities/tables/time range you will align to (one line).
   (3) optimizer — title + detail: draft SQL + cost check (half line).
   (4) executor — title + detail: run query (half line).
   (5) validator — title + detail: quick sanity check (half line).
   (6) visualization — title + detail: chart type + takeaway (half line).
When is_valid=false: set execution_steps to [].
"""


def _default_planner_detail(plan_dict: dict) -> str:
    parts: list[str] = []
    metrics = plan_dict.get("metrics") or []
    dimensions = plan_dict.get("dimensions") or []
    filters = plan_dict.get("filters") or {}
    if metrics:
        parts.append("Metrics: " + ", ".join(str(x) for x in metrics))
    if dimensions:
        parts.append("Dimensions: " + ", ".join(str(x) for x in dimensions))
    if isinstance(filters, dict) and filters:
        fe = [f"{k}: {v}" for k, v in filters.items() if v not in (None, "")]
        if fe:
            parts.append("Filters: " + "; ".join(fe))
    return "\n".join(parts) if parts else "Define what to analyze from your question."


def _clip_ui_text(s: str | None, max_len: int) -> str | None:
    if not s:
        return None
    t = s.strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "\u2026"


def _normalize_execution_steps(plan_dict: dict) -> None:
    """Ensure valid plans have 6 well-formed steps for the UI; invalid plans have no steps."""
    if not plan_dict.get("is_valid"):
        plan_dict["execution_steps"] = []
        return

    raw = plan_dict.get("execution_steps") or []
    normalized: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        phase = (item.get("phase") or "").strip()
        title = (item.get("title") or "").strip()
        detail = item.get("detail")
        if isinstance(detail, str):
            detail = detail.strip() or None
        elif detail is not None:
            detail = str(detail).strip() or None
        else:
            detail = None
        if phase in EXECUTION_PHASE_ORDER:
            # Keep a custom title only for planner; later phases use fixed labels so the checklist
            # does not stick on LLM phrases like "Generating SQL…" after the user has moved on.
            step_title = DEFAULT_STEP_LABELS.get(phase, phase)
            if phase == "planner" and title:
                step_title = title
            normalized.append({"phase": phase, "title": step_title, "detail": detail})

    phases_got = [s["phase"] for s in normalized]
    valid = len(normalized) == 6 and phases_got == list(EXECUTION_PHASE_ORDER)
    if not valid:
        normalized = [
            {
                "phase": p,
                "title": DEFAULT_STEP_LABELS[p],
                "detail": _default_planner_detail(plan_dict) if p == "planner" else None,
            }
            for p in EXECUTION_PHASE_ORDER
        ]
    elif not normalized[0].get("detail"):
        normalized[0]["detail"] = _default_planner_detail(plan_dict)

    for step in normalized:
        ph = step.get("phase", "")
        t = _clip_ui_text(step.get("title"), 120)
        if t:
            step["title"] = t
        else:
            step["title"] = DEFAULT_STEP_LABELS.get(ph, str(ph))
        d = step.get("detail")
        if d:
            step["detail"] = _clip_ui_text(d, 300)

    plan_dict["execution_steps"] = normalized


def _build_conversation_history_section(history: list[dict]) -> str:
    """Format conversation history for prompt. Keeps last N turns for context."""
    if not history:
        return ""
    max_turns = 10  # Last 5 user + 5 assistant
    recent = history[-max_turns:] if len(history) > max_turns else history
    lines = []
    for msg in recent:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        meta = msg.get("metadata") or {}
        # Use clarifying_questions from metadata (saved when assistant asked) for full context
        clarifying = meta.get("clarifying_questions") or (meta.get("plan") or {}).get("clarifying_questions")
        if clarifying and isinstance(clarifying, list):
            content = content or ("; ".join(clarifying) if clarifying and isinstance(clarifying[0], str) else str(clarifying))
        lines.append(f"- {role}: {content[:500]}{'...' if len(content) > 500 else ''}")
    return "Recent conversation (for context):\n" + "\n".join(lines) + "\n\n"


def run_planner(state: dict) -> dict:
    """Planning Agent: validate query, produce plan or clarifying questions.
    Checks data availability early; stops with clarifying question if requested period is outside range.
    Uses conversation history for conversational context (e.g. user says 'Sure' to proceed with available range)."""
    query = state.get("query", "")
    trace = state.get("trace", [])
    history = state.get("conversation_history") or []

    append_trace(
        trace,
        TraceEntry(agent="planner", status="info", message="Analyzing your query...").model_dump()
    )

    if not query or not query.strip():
        append_trace(
            trace,
            TraceEntry(agent="planner", status="error", message="Empty query").model_dump(),
        )
        return {
            "plan": AnalysisPlan(
                metrics=[],
                dimensions=[],
                filters={},
                is_valid=False,
                clarifying_questions=["Please enter a question about your data (e.g. sales, revenue, orders)."],
                execution_steps=[],
            ).model_dump(),
            "trace": trace,
        }

    # ── Schema introspection short-circuit ──────────────────────────────────────
    if _is_schema_introspection_query(query):
        schema = get_effective_schema(state)
        summary = _build_schema_markdown(schema)
        append_trace(
            trace,
            TraceEntry(
                agent="planner",
                status="success",
                message="Schema introspection — returning data structure summary",
            ).model_dump(),
        )
        return {
            "plan": AnalysisPlan(
                metrics=[],
                dimensions=[],
                filters={},
                is_valid=False,
                query_scope="schema_introspection",
                clarifying_questions=[],
                execution_steps=[],
            ).model_dump(),
            "explanation": summary,
            "answer_summary": "Here's the structure of your connected data.",
            "trace": trace,
        }

    append_trace(
        trace,
        TraceEntry(agent="planner", status="info", message="Checking if question is valid and answerable...").model_dump()
    )

    try:
        schema = get_effective_schema(state)
        multi_digest = (state.get("multi_source_schema_digest") or "").strip()
        if multi_digest:
            from data_sources.catalog_resolve import combined_data_ranges_multisource

            combined = combined_data_ranges_multisource(state)
            data_ranges_str = combined if combined.strip() else extract_data_ranges(schema)
        else:
            data_ranges_str = extract_data_ranges(schema)
        data_section = (
            f"DATA AVAILABILITY (use this to validate time-based questions):\n{data_ranges_str}\n\n"
            if "available from" in data_ranges_str
            else ""
        )
        append_trace(
            trace,
            TraceEntry(
                agent="planner",
                status="info",
                message="Validating time range against available data...",
                output={"data_availability": data_ranges_str[:200] + "..." if len(data_ranges_str) > 200 else data_ranges_str},
            ).model_dump(),
        )

        history_section = _build_conversation_history_section(history)
        src_summary = (state.get("available_sources_summary") or "").strip()
        sources_block = (
            f"WAREHOUSE / SOURCES CONTEXT:\n{src_summary}\n\n"
            "Use only the **active** source above for this question. Do not merge data across sources.\n\n"
            if src_summary
            else ""
        )
        import_blocks: list[str] = []
        if (schema.get("source_kind") or "").strip().lower() == "user_csv":
            import_blocks.append(
                "USER-UPLOADED SPREADSHEET:\n"
                "- The active source is a CSV the user imported into the database as one table.\n"
                "- Questions that filter, aggregate, sort, count, or describe that table’s rows/columns are valid "
                "(query_scope=data_question). Retail topics are not required unless the user asked about them.\n"
                "- Numeric values may be stored as TEXT; downstream SQL may need casts for sums or averages.\n"
            )
        ic = (schema.get("import_context") or "").strip()
        if ic:
            import_blocks.append(f"IMPORT CONTEXT (user notes about this file):\n{ic}")
        import_context_section = "\n".join(import_blocks).strip()
        if import_context_section:
            import_context_section += "\n\n"

        if multi_digest:
            multi_source_schema_section = (
                "MULTI-SOURCE SCHEMA (each block is one database — pick exactly one `resolved_source_id`):\n\n"
                + multi_digest
                + "\n"
            )
        else:
            multi_source_schema_section = (
                "SINGLE-SOURCE MODE: There is only one logical warehouse context for this session. "
                "Leave resolved_source_id empty. Plan using WAREHOUSE / SOURCES CONTEXT and DATA AVAILABILITY only.\n\n"
            )

        llm = get_gemini()
        structured_llm = llm.with_structured_output(AnalysisPlan, method="json_mode")
        prompt = PLANNER_PROMPT.format(
            query=query,
            CONVERSATION_HISTORY_SECTION=history_section or "",
            SOURCES_SUMMARY_SECTION=sources_block,
            MULTI_SOURCE_SCHEMA_SECTION=multi_source_schema_section,
            IMPORT_CONTEXT_SECTION=import_context_section,
            DATA_AVAILABILITY_SECTION=data_section or "No date-range metadata available; skip time-range validation.",
        )
        append_trace(
            trace,
            TraceEntry(
                agent="planner",
                status="info",
                message="Drafting analysis plan with the model…",
            ).model_dump(),
        )
        plan = invoke_with_retry(structured_llm, prompt)

        plan_dict = plan.model_dump() if hasattr(plan, "model_dump") else plan
        scope = (plan_dict.get("query_scope") or "").strip().lower()
        if not plan_dict.get("is_valid") and scope == "out_of_scope":
            plan_dict["clarifying_questions"] = [OUT_OF_SCOPE_MESSAGE]
        elif not plan_dict.get("is_valid") and scope not in ("out_of_scope", "needs_clarification", "data_question"):
            plan_dict["query_scope"] = "needs_clarification"

        _normalize_execution_steps(plan_dict)

        from data_sources.catalog_resolve import apply_planner_source_resolution

        routed: dict = {}
        if plan_dict.get("is_valid"):
            routed = apply_planner_source_resolution(state, plan_dict)
            prev_sid = (state.get("active_source_id") or "primary").strip() or "primary"
            new_sid = (routed.get("active_source_id") or "").strip()
            if new_sid and new_sid != prev_sid:
                append_trace(
                    trace,
                    TraceEntry(
                        agent="planner",
                        status="info",
                        message=f"Selected data source `{routed['active_source_id']}` for this question",
                        output={
                            "resolved_source_id": routed["active_source_id"],
                            "label": routed.get("data_source_label"),
                        },
                    ).model_dump(),
                )

        if plan_dict.get("is_valid"):
            ds_label = (routed.get("data_source_label") or state.get("data_source_label") or "").strip()
            plan_msg = "Plan created – query is valid and within data range"
            if ds_label:
                plan_msg = f"Plan created – using data source: {ds_label}"
            append_trace(
                trace,
                TraceEntry(
                    agent="planner",
                    status="success",
                    message=plan_msg,
                    output={
                        "is_valid": True,
                        "metrics": plan_dict.get("metrics", []),
                        "dimensions": plan_dict.get("dimensions", []),
                        "filters": plan_dict.get("filters", {}),
                        "result_limit": plan_dict.get("result_limit"),
                        "execution_steps": plan_dict.get("execution_steps", []),
                        "resolved_source_id": plan_dict.get("resolved_source_id"),
                    },
                ).model_dump(),
            )
        else:
            append_trace(
                trace,
                TraceEntry(
                    agent="planner",
                    status="success",
                    message="Clarifying questions generated – data not available for requested period or query needs refinement",
                    output={"is_valid": False, "clarifying_questions": plan_dict.get("clarifying_questions", [])},
                ).model_dump(),
            )

        out: dict = {"plan": plan_dict, "trace": trace, **routed}
        return out
    except Exception as e:
        append_trace(
            trace,
            TraceEntry(agent="planner", status="error", message=str(e)).model_dump(),
        )
        return {
            "plan": AnalysisPlan(
                metrics=[],
                dimensions=[],
                filters={},
                is_valid=False,
                clarifying_questions=[f"Sorry, I couldn't process that. Please try rephrasing. Error: {e}"],
                execution_steps=[],
            ).model_dump(),
            "trace": trace,
        }
