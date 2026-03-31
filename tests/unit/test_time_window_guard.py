"""
Unit tests for backend/agents/time_window_guard.py

Covers:
- _last_month_window / _this_month_window
- _last_quarter_window / _this_quarter_window
- _last_n_days_window
- _normalize_period_token aliases
- _window_from_period_token
- _infer_window_from_query_text  (relative phrase detection)
- requested_time_window          (plan filters + query text)
- plan_time_window_unavailable_message (out-of-range → message, in-range → None)
- suggested_question_outside_catalog_window
"""
from datetime import date
import pytest

from agents.time_window_guard import (
    _last_month_window,
    _this_month_window,
    _last_quarter_window,
    _this_quarter_window,
    _last_n_days_window,
    _normalize_period_token,
    _window_from_period_token,
    _infer_window_from_query_text,
    requested_time_window,
    plan_time_window_unavailable_message,
    suggested_question_outside_catalog_window,
)

# ---------------------------------------------------------------------------
# Schema fixture: orders.order_date data_range 2024-01-01 → 2024-12-31
# ---------------------------------------------------------------------------

SCHEMA_2024 = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "order_id"},
                {
                    "name": "order_date",
                    "data_range": {"min": "2024-01-01", "max": "2024-12-31"},
                },
            ],
        }
    ]
}

SCHEMA_NO_RANGE = {
    "tables": [{"name": "orders", "columns": [{"name": "order_id"}]}]
}


# ---------------------------------------------------------------------------
# Window arithmetic helpers
# ---------------------------------------------------------------------------


class TestLastMonthWindow:
    def test_mid_year(self):
        start, end = _last_month_window(date(2025, 3, 15))
        assert start == date(2025, 2, 1)
        assert end == date(2025, 2, 28)

    def test_wraps_year(self):
        start, end = _last_month_window(date(2025, 1, 10))
        assert start == date(2024, 12, 1)
        assert end == date(2024, 12, 31)

    def test_leap_year_february(self):
        # March 2024 → February 2024 has 29 days
        start, end = _last_month_window(date(2024, 3, 1))
        assert start == date(2024, 2, 1)
        assert end == date(2024, 2, 29)


class TestThisMonthWindow:
    def test_mid_month(self):
        start, end = _this_month_window(date(2025, 7, 15))
        assert start == date(2025, 7, 1)
        assert end == date(2025, 7, 31)

    def test_february_non_leap(self):
        start, end = _this_month_window(date(2025, 2, 10))
        assert start == date(2025, 2, 1)
        assert end == date(2025, 2, 28)


class TestLastQuarterWindow:
    def test_q2_ref_returns_q1(self):
        start, end = _last_quarter_window(date(2025, 4, 1))
        assert start == date(2025, 1, 1)
        assert end == date(2025, 3, 31)

    def test_q1_ref_wraps_to_q4_prev_year(self):
        start, end = _last_quarter_window(date(2025, 1, 15))
        assert start == date(2024, 10, 1)
        assert end == date(2024, 12, 31)

    def test_q3_ref_returns_q2(self):
        start, end = _last_quarter_window(date(2025, 8, 20))
        assert start == date(2025, 4, 1)
        assert end == date(2025, 6, 30)


class TestThisQuarterWindow:
    def test_q1(self):
        start, end = _this_quarter_window(date(2025, 2, 15))
        assert start == date(2025, 1, 1)
        assert end == date(2025, 3, 31)

    def test_q4(self):
        start, end = _this_quarter_window(date(2025, 11, 1))
        assert start == date(2025, 10, 1)
        assert end == date(2025, 12, 31)


class TestLastNDaysWindow:
    def test_last_7_days(self):
        start, end = _last_n_days_window(date(2025, 3, 15), 7)
        assert end == date(2025, 3, 15)
        assert start == date(2025, 3, 9)

    def test_last_30_days(self):
        start, end = _last_n_days_window(date(2025, 3, 31), 30)
        assert end == date(2025, 3, 31)
        assert start == date(2025, 3, 2)

    def test_invalid_n_returns_none(self):
        result = _last_n_days_window(date(2025, 3, 15), 0)
        assert result is None


# ---------------------------------------------------------------------------
# _normalize_period_token
# ---------------------------------------------------------------------------


class TestNormalizePeriodToken:
    def test_past_month_alias(self):
        assert _normalize_period_token("past_month") == "last_month"

    def test_previous_quarter_alias(self):
        assert _normalize_period_token("previous_quarter") == "last_quarter"

    def test_ytd_alias(self):
        assert _normalize_period_token("ytd") == "year_to_date"

    def test_last_7d_alias(self):
        assert _normalize_period_token("last_7d") == "last_7_days"

    def test_passthrough_unknown(self):
        assert _normalize_period_token("last_month") == "last_month"


# ---------------------------------------------------------------------------
# _window_from_period_token
# ---------------------------------------------------------------------------


class TestWindowFromPeriodToken:
    REF = date(2025, 3, 15)

    def test_last_month(self):
        w = _window_from_period_token("last_month", self.REF)
        assert w == (date(2025, 2, 1), date(2025, 2, 28))

    def test_last_quarter(self):
        w = _window_from_period_token("last_quarter", self.REF)
        assert w == (date(2024, 10, 1), date(2024, 12, 31))

    def test_last_year(self):
        w = _window_from_period_token("last_year", self.REF)
        assert w == (date(2024, 1, 1), date(2024, 12, 31))

    def test_last_30_days(self):
        w = _window_from_period_token("last_30_days", self.REF)
        assert w is not None
        assert w[1] == self.REF

    def test_alias_past_month(self):
        w = _window_from_period_token("past_month", self.REF)
        assert w == (date(2025, 2, 1), date(2025, 2, 28))

    def test_unknown_token_returns_none(self):
        w = _window_from_period_token("custom_period", self.REF)
        assert w is None


# ---------------------------------------------------------------------------
# _infer_window_from_query_text
# ---------------------------------------------------------------------------


class TestInferWindowFromQueryText:
    REF = date(2025, 3, 15)

    def test_last_month_phrase(self):
        w = _infer_window_from_query_text("Show me last month sales", self.REF)
        assert w == (date(2025, 2, 1), date(2025, 2, 28))

    def test_past_month_phrase(self):
        w = _infer_window_from_query_text("Revenue for past month?", self.REF)
        assert w is not None

    def test_last_quarter_phrase(self):
        w = _infer_window_from_query_text("Orders last quarter", self.REF)
        assert w == (date(2024, 10, 1), date(2024, 12, 31))

    def test_last_year_phrase(self):
        w = _infer_window_from_query_text("Compare revenue last year vs this year", self.REF)
        assert w is not None

    def test_last_n_days_phrase(self):
        w = _infer_window_from_query_text("What happened in the last 7 days?", self.REF)
        assert w is not None
        assert w[1] == self.REF

    def test_no_time_phrase_returns_none(self):
        w = _infer_window_from_query_text("Total sales by region", self.REF)
        assert w is None

    def test_ytd_phrase(self):
        w = _infer_window_from_query_text("YTD revenue breakdown", self.REF)
        assert w is not None
        assert w[0] == date(2025, 1, 1)


# ---------------------------------------------------------------------------
# requested_time_window
# ---------------------------------------------------------------------------


class TestRequestedTimeWindow:
    REF = date(2025, 3, 15)

    def test_from_explicit_start_end_filter(self):
        plan = {"filters": {"start_date": "2024-01-01", "end_date": "2024-06-30"}}
        w = requested_time_window("", plan, ref=self.REF)
        assert w == (date(2024, 1, 1), date(2024, 6, 30))

    def test_from_period_filter(self):
        plan = {"filters": {"period": "last_quarter"}}
        w = requested_time_window("", plan, ref=self.REF)
        assert w == (date(2024, 10, 1), date(2024, 12, 31))

    def test_from_query_text_fallback(self):
        plan = {"filters": {}}
        w = requested_time_window("last month orders", plan, ref=self.REF)
        assert w == (date(2025, 2, 1), date(2025, 2, 28))

    def test_no_window_returns_none(self):
        plan = {"filters": {}}
        w = requested_time_window("total revenue by region", plan, ref=self.REF)
        assert w is None

    def test_inverted_dates_are_swapped(self):
        plan = {"filters": {"start_date": "2024-06-30", "end_date": "2024-01-01"}}
        w = requested_time_window("", plan, ref=self.REF)
        assert w is not None
        assert w[0] < w[1]


# ---------------------------------------------------------------------------
# plan_time_window_unavailable_message
# ---------------------------------------------------------------------------


class TestPlanTimeWindowUnavailableMessage:
    # Data is all of 2024. "last month" from 2025-03-15 → Feb 2025 → outside range.
    def test_outside_range_returns_message(self):
        plan = {"filters": {}}
        msg = plan_time_window_unavailable_message(
            "last month sales", plan, SCHEMA_2024, ref=date(2025, 3, 15)
        )
        assert msg is not None
        assert "2024" in msg  # mentions available range

    def test_inside_range_returns_none(self):
        # "last year" from 2025-03-15 → 2024-01-01 to 2024-12-31 → exactly the data range
        plan = {"filters": {}}
        msg = plan_time_window_unavailable_message(
            "last year revenue", plan, SCHEMA_2024, ref=date(2025, 3, 15)
        )
        assert msg is None

    def test_explicit_dates_inside_range(self):
        plan = {"filters": {"start_date": "2024-06-01", "end_date": "2024-09-30"}}
        msg = plan_time_window_unavailable_message("", plan, SCHEMA_2024, ref=date(2025, 1, 1))
        assert msg is None

    def test_explicit_dates_outside_range(self):
        plan = {"filters": {"start_date": "2026-01-01", "end_date": "2026-12-31"}}
        msg = plan_time_window_unavailable_message("", plan, SCHEMA_2024, ref=date(2025, 1, 1))
        assert msg is not None

    def test_no_data_range_in_schema_returns_none(self):
        plan = {"filters": {}}
        msg = plan_time_window_unavailable_message(
            "last month sales", plan, SCHEMA_NO_RANGE, ref=date(2025, 3, 15)
        )
        assert msg is None

    def test_no_time_phrase_returns_none(self):
        plan = {"filters": {}}
        msg = plan_time_window_unavailable_message(
            "total revenue by region", plan, SCHEMA_2024, ref=date(2025, 3, 15)
        )
        assert msg is None


# ---------------------------------------------------------------------------
# suggested_question_outside_catalog_window
# ---------------------------------------------------------------------------


class TestSuggestedQuestionOutsideCatalogWindow:
    def test_future_relative_phrase_dropped(self):
        # Data is 2024. "last month" from 2025-03-15 → outside → True (drop it)
        result = suggested_question_outside_catalog_window(
            "What were last month's top products?", SCHEMA_2024, ref=date(2025, 3, 15)
        )
        assert result is True

    def test_in_range_phrase_kept(self):
        # "last year" from 2025-03-15 → 2024 → overlaps data range → False (keep it)
        result = suggested_question_outside_catalog_window(
            "Show me last year's revenue by region", SCHEMA_2024, ref=date(2025, 3, 15)
        )
        assert result is False

    def test_no_time_phrase_kept(self):
        result = suggested_question_outside_catalog_window(
            "Which products have the highest unit price?", SCHEMA_2024, ref=date(2025, 3, 15)
        )
        assert result is False

    def test_no_schema_range_kept(self):
        result = suggested_question_outside_catalog_window(
            "What were last month's top products?", SCHEMA_NO_RANGE, ref=date(2025, 3, 15)
        )
        assert result is False
