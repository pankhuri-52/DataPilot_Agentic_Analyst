"""
Deterministic checks: requested time windows vs static data_range in schema metadata.

LLM planners/discovery can miss relative phrases like "last month"; this guard fails fast
with a clear range message so the pipeline does not run SQL that must return zero rows.
"""
from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any

from agents.schema_utils import extract_data_ranges, get_global_data_range


def _parse_iso_date(s: str | None) -> date | None:
    if not s or not isinstance(s, str):
        return None
    t = s.strip()[:10]
    if len(t) < 10:
        return None
    try:
        return datetime.strptime(t, "%Y-%m-%d").date()
    except ValueError:
        return None


def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)


def _last_month_window(ref: date) -> tuple[date, date]:
    first_this = _first_of_month(ref)
    last_prev = first_this - timedelta(days=1)
    start = _first_of_month(last_prev)
    return start, last_prev


def _this_month_window(ref: date) -> tuple[date, date]:
    start = _first_of_month(ref)
    _, last_d = monthrange(ref.year, ref.month)
    end = date(ref.year, ref.month, last_d)
    return start, end


def _quarter_index(m: int) -> int:
    return (m - 1) // 3 + 1


def _quarter_bounds(y: int, q: int) -> tuple[date, date]:
    start_month = (q - 1) * 3 + 1
    start = date(y, start_month, 1)
    _, last_d = monthrange(y, start_month + 2)
    end = date(y, start_month + 2, last_d)
    return start, end


def _last_quarter_window(ref: date) -> tuple[date, date]:
    q = _quarter_index(ref.month)
    y = ref.year
    if q == 1:
        return _quarter_bounds(y - 1, 4)
    return _quarter_bounds(y, q - 1)


def _this_quarter_window(ref: date) -> tuple[date, date]:
    return _quarter_bounds(ref.year, _quarter_index(ref.month))


def _last_n_days_window(ref: date, n: int) -> tuple[date, date] | None:
    if n <= 0:
        return None
    end = ref
    start = ref - timedelta(days=n - 1)
    return start, end


def _normalize_period_token(raw: str) -> str:
    s = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "past_month": "last_month",
        "previous_month": "last_month",
        "prior_month": "last_month",
        "past_quarter": "last_quarter",
        "previous_quarter": "last_quarter",
        "past_year": "last_year",
        "previous_year": "last_year",
        "ytd": "year_to_date",
        "last_7d": "last_7_days",
        "last_30d": "last_30_days",
        "last_90d": "last_90_days",
    }
    return aliases.get(s, s)


def _window_from_period_token(token: str, ref: date) -> tuple[date, date] | None:
    t = _normalize_period_token(token)
    if t in ("last_month",):
        return _last_month_window(ref)
    if t in ("this_month",):
        return _this_month_window(ref)
    if t in ("last_quarter",):
        return _last_quarter_window(ref)
    if t in ("this_quarter",):
        return _this_quarter_window(ref)
    if t in ("last_year",):
        y = ref.year - 1
        return date(y, 1, 1), date(y, 12, 31)
    if t in ("this_year",):
        y = ref.year
        return date(y, 1, 1), date(y, 12, 31)
    if t in ("year_to_date", "ytd"):
        return date(ref.year, 1, 1), ref
    m = re.fullmatch(r"last_(\d+)_days?", t)
    if m:
        return _last_n_days_window(ref, int(m.group(1)))
    return None


def _ranges_disjoint(a0: date, a1: date, b0: date, b1: date) -> bool:
    return a1 < b0 or b1 < a0


def _infer_window_from_query_text(q: str, ref: date) -> tuple[date, date] | None:
    text = (q or "").lower()
    if re.search(r"\b(last|past|previous)\s+month\b", text):
        return _last_month_window(ref)
    if re.search(r"\bthis\s+month\b", text):
        return _this_month_window(ref)
    if re.search(r"\b(last|past|previous)\s+quarter\b", text):
        return _last_quarter_window(ref)
    if re.search(r"\bthis\s+quarter\b", text):
        return _this_quarter_window(ref)
    if re.search(r"\b(last|past|previous)\s+year\b", text):
        y = ref.year - 1
        return date(y, 1, 1), date(y, 12, 31)
    if re.search(r"\bthis\s+year\b", text):
        y = ref.year
        return date(y, 1, 1), date(y, 12, 31)
    if re.search(r"\bytd\b|\byear[\s-]to[\s-]date\b", text):
        return date(ref.year, 1, 1), ref
    m = re.search(r"\b(?:last|past)\s+(\d{1,3})\s+days?\b", text)
    if m:
        return _last_n_days_window(ref, int(m.group(1)))
    m = re.search(r"\b(?:last|past)\s+(\d{1,3})\s+weeks?\b", text)
    if m:
        return _last_n_days_window(ref, int(m.group(1)) * 7)
    return None


def _window_from_filters(filters: dict[str, Any], ref: date) -> tuple[date, date] | None:
    if not isinstance(filters, dict):
        return None
    period = filters.get("period")
    if period is not None and str(period).strip():
        w = _window_from_period_token(str(period), ref)
        if w:
            return w
    start = _parse_iso_date(str(filters.get("start_date") or ""))
    end = _parse_iso_date(str(filters.get("end_date") or ""))
    if start and end:
        if start > end:
            start, end = end, start
        return start, end
    return None


def requested_time_window(
    query: str,
    plan_dict: dict[str, Any],
    *,
    ref: date | None = None,
) -> tuple[date, date] | None:
    ref_d = ref or date.today()
    filters = plan_dict.get("filters") if isinstance(plan_dict, dict) else {}
    w = _window_from_filters(filters, ref_d)
    if w:
        return w
    return _infer_window_from_query_text(query, ref_d)


def plan_time_window_unavailable_message(
    query: str,
    plan_dict: dict[str, Any],
    schema: dict[str, Any],
    *,
    ref: date | None = None,
) -> str | None:
    """
    If the plan (or query text) implies a bounded time window that does not overlap
    any static data_range in metadata, return a user-facing explanation. Else None.
    """
    dmin_s, dmax_s = get_global_data_range(schema)
    if not dmin_s or not dmax_s:
        return None
    data_min = _parse_iso_date(str(dmin_s))
    data_max = _parse_iso_date(str(dmax_s))
    if not data_min or not data_max:
        return None

    window = requested_time_window(query, plan_dict, ref=ref)
    if not window:
        return None
    req_start, req_end = window
    if _ranges_disjoint(req_start, req_end, data_min, data_max):
        ranges_blurb = extract_data_ranges(schema)
        return (
            f"The requested time period ({req_start.isoformat()} to {req_end.isoformat()}) does not overlap "
            f"the sample data currently loaded in the warehouse. "
            f"Available dates in the catalog span {data_min.isoformat()} through {data_max.isoformat()}.\n\n"
            f"{ranges_blurb}\n\n"
            "Try the same question using a window inside that range (for example the most recent month in the data), "
            "or ask without a relative date filter."
        )
    return None


def suggested_question_outside_catalog_window(question: str, schema: dict[str, Any], *, ref: date | None = None) -> bool:
    """True if a suggestion should be dropped (relative time window has no overlap with metadata)."""
    dmin_s, dmax_s = get_global_data_range(schema)
    if not dmin_s or not dmax_s:
        return False
    data_min = _parse_iso_date(str(dmin_s))
    data_max = _parse_iso_date(str(dmax_s))
    if not data_min or not data_max:
        return False
    ref_d = ref or date.today()
    w = _infer_window_from_query_text(question, ref_d)
    if not w:
        return False
    rs, re_ = w
    return _ranges_disjoint(rs, re_, data_min, data_max)
