"""
Regression tests for retry-state routing between optimizer, orchestrator, and executor.
"""
from agents.optimizer import run_optimizer_gate
from agents.orchestrator import _deterministic_next_agent


def test_optimizer_gate_clears_execution_error_after_retry_approval():
    out = run_optimizer_gate(
        {
            "trace": [],
            "pending_execute_sql": "SELECT 1",
            "pending_execute_bytes": None,
            "pending_execute_cost": None,
            "pending_execute_dialect": "bigquery",
            "execution_error": "previous database error",
        }
    )

    assert out["sql"] == "SELECT 1"
    assert out["execution_error"] is None
    assert out["pending_execute_sql"] is None


def test_orchestrator_prefers_executor_when_sql_is_approved():
    next_agent, _ = _deterministic_next_agent(
        agents_run=["planner", "discovery", "optimizer_prepare", "optimizer_gate"],
        from_cache=False,
        plan_valid=True,
        data_feasibility="full",
        has_pending_sql=False,
        sql_approved=True,
        has_regenerate_hint=False,
        has_results=False,
        validation_ok=False,
        has_explanation=False,
        execution_error="stale execution error from previous attempt",
        executor_retry_count=1,
        has_relevance_hint=False,
        validator_retry_count=0,
    )

    assert next_agent == "executor"
