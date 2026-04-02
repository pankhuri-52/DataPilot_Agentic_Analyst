"""
Unit tests for backend/agents/validator.py

Covers (deterministic, no real LLM calls):
- run_validator: None results, empty results, schema consistency check
- _check_relevance: mocked LLM returning YES / NO / error
"""
from unittest.mock import MagicMock, patch
import pytest

from agents.validator import run_validator, _check_relevance


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _state(raw_results, query="How many orders?", sql="SELECT COUNT(*) FROM orders") -> dict:
    return {
        "query": query,
        "sql": sql,
        "raw_results": raw_results,
        "trace": [],
        "validator_retry_count": 99,  # skip LLM relevance by default
    }


# ---------------------------------------------------------------------------
# run_validator – structural checks (LLM skipped via retry count)
# ---------------------------------------------------------------------------


class TestRunValidatorStructural:
    def test_none_results_fails(self):
        state = _state(None)
        out = run_validator(state)
        assert out["validation_ok"] is False

    def test_empty_results_is_valid(self):
        # Empty result set is structurally OK (no matching data is valid)
        state = _state([])
        out = run_validator(state)
        assert out["validation_ok"] is True

    def test_consistent_columns_passes(self):
        rows = [
            {"order_id": 1, "total": 100},
            {"order_id": 2, "total": 200},
            {"order_id": 3, "total": 300},
        ]
        state = _state(rows)
        out = run_validator(state)
        assert out["validation_ok"] is True

    def test_inconsistent_columns_fails(self):
        rows = [
            {"order_id": 1, "total": 100},
            {"order_id": 2, "extra_col": 999},  # different keys
        ]
        state = _state(rows)
        out = run_validator(state)
        assert out["validation_ok"] is False

    def test_single_row_always_passes_schema_check(self):
        rows = [{"revenue": 5000, "region": "North"}]
        state = _state(rows)
        out = run_validator(state)
        assert out["validation_ok"] is True

    def test_trace_is_populated(self):
        state = _state([{"order_id": 1}])
        out = run_validator(state)
        assert len(out["trace"]) > 0

    def test_trace_contains_validator_agent(self):
        state = _state([{"order_id": 1}])
        out = run_validator(state)
        agents = [e.get("agent") for e in out["trace"]]
        assert "validator" in agents


# ---------------------------------------------------------------------------
# _check_relevance – mocked LLM
# ---------------------------------------------------------------------------


class TestCheckRelevance:
    def _make_state(self, query="How many orders?", sql="SELECT COUNT(*) FROM orders") -> dict:
        return {"query": query, "sql": sql, "trace": []}

    def _mock_llm(self, response_text: str):
        mock_response = MagicMock()
        mock_response.content = response_text
        mock_llm = MagicMock()
        mock_invoke = MagicMock(return_value=mock_response)
        return mock_llm, mock_invoke

    def test_yes_response_returns_true(self):
        state = self._make_state()
        rows = [{"count": 42}]
        mock_llm, mock_invoke = self._mock_llm("YES\nResults show row count directly.")
        with patch("agents.validator.get_llm", return_value=mock_llm), \
             patch("agents.validator.invoke_with_retry", mock_invoke):
            ok, hint = _check_relevance(state, rows, [])
        assert ok is True
        assert hint is None

    def test_no_response_returns_false_with_hint(self):
        state = self._make_state()
        rows = [{"product_name": "Widget", "stock": 50}]
        mock_llm, mock_invoke = self._mock_llm(
            "NO\nResults show product stock, not order count."
        )
        with patch("agents.validator.get_llm", return_value=mock_llm), \
             patch("agents.validator.invoke_with_retry", mock_invoke):
            ok, hint = _check_relevance(state, rows, [])
        assert ok is False
        assert hint is not None
        assert "order" in hint.lower() or "rewrite" in hint.lower()

    def test_llm_error_fails_open(self):
        """If LLM throws, relevance check should fail open (return True) so pipeline continues."""
        state = self._make_state()
        rows = [{"count": 5}]
        with patch("agents.validator.get_llm", side_effect=Exception("API timeout")):
            ok, hint = _check_relevance(state, rows, [])
        assert ok is True  # fail open
        assert hint is None


# ---------------------------------------------------------------------------
# run_validator with mocked LLM (retry_count=0 so LLM path triggers)
# ---------------------------------------------------------------------------


class TestRunValidatorWithLLM:
    def _state_with_llm(self, raw_results, query="Total orders?") -> dict:
        return {
            "query": query,
            "sql": "SELECT COUNT(*) FROM orders",
            "raw_results": raw_results,
            "trace": [],
            "validator_retry_count": 0,  # allow LLM relevance check
        }

    def test_llm_yes_returns_valid(self):
        rows = [{"count": 100}]
        state = self._state_with_llm(rows)
        mock_response = MagicMock()
        mock_response.content = "YES\nCount answers the question directly."
        with patch("agents.validator.get_llm", return_value=MagicMock()), \
             patch("agents.validator.invoke_with_retry", return_value=mock_response):
            out = run_validator(state)
        assert out["validation_ok"] is True

    def test_llm_no_returns_invalid_with_retry_count(self):
        rows = [{"product": "Widget"}]
        state = self._state_with_llm(rows)
        mock_response = MagicMock()
        mock_response.content = "NO\nReturned products, not order count."
        with patch("agents.validator.get_llm", return_value=MagicMock()), \
             patch("agents.validator.invoke_with_retry", return_value=mock_response):
            out = run_validator(state)
        assert out["validation_ok"] is False
        assert out.get("validator_retry_count", 0) >= 1
