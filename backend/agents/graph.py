"""
LangGraph orchestration – wires all agents into a state machine.
Checkpointer is injected at app startup (PostgreSQL via lifespan, or MemorySaver fallback).
"""
import os
from typing import Any, Literal

# Cap relevance-failure retries to prevent infinite validator → optimizer loops.
_VALIDATOR_MAX_RETRIES = 1

# Must match EXECUTOR_MAX_SQL_RETRIES in executor.py (both read the same env var).
_EXECUTOR_MAX_SQL_RETRIES = int(os.getenv("EXECUTOR_MAX_SQL_RETRIES", "2"))

from langgraph.graph import StateGraph, END

from agents.state import DataPilotState
from agents.query_kb import run_query_kb
from agents.planner import run_planner
from agents.discovery import run_discovery
from agents.optimizer import run_optimizer_gate, run_optimizer_prepare
from agents.executor import run_executor
from agents.validator import run_validator
from agents.visualization import run_visualization


def route_after_query_kb(state: DataPilotState) -> Literal["planner", "executor"]:
    """After KB node: Adapt path jumps to executor; otherwise planner."""
    if state.get("from_query_cache_adapt") and state.get("sql"):
        return "executor"
    return "planner"


def route_after_planner(state: DataPilotState) -> Literal["discovery", "__end__"]:
    """If plan is valid, go to discovery; else end."""
    plan = state.get("plan")
    if plan and plan.get("is_valid"):
        return "discovery"
    return "__end__"


def route_after_discovery(state: DataPilotState) -> Literal["optimizer_prepare", "__end__"]:
    """If feasibility is full or partial, go to optimizer prepare; else end."""
    feasibility = state.get("data_feasibility", "none")
    if feasibility in ("full", "partial"):
        return "optimizer_prepare"
    return "__end__"


def route_after_executor(state: DataPilotState) -> Literal["validator", "optimizer_prepare", "__end__"]:
    """SQL self-correction loop.

    - Success (raw_results is set): forward to validator.
    - SQL error within retry budget: route back to optimizer_prepare with execution_error in state.
    - Fatal error or budget exhausted: end the run.
    """
    if state.get("raw_results") is not None:
        return "validator"
    if state.get("execution_error") and state.get("executor_retry_count", 0) <= _EXECUTOR_MAX_SQL_RETRIES:
        return "optimizer_prepare"
    return "__end__"


def route_after_validator(state: DataPilotState) -> Literal["visualization", "optimizer_prepare"]:
    """Route to optimizer_prepare for a relevance-failure retry; otherwise proceed to visualization."""
    if (
        not state.get("validation_ok")
        and state.get("relevance_check_hint")
        and int(state.get("validator_retry_count") or 0) <= _VALIDATOR_MAX_RETRIES
    ):
        return "optimizer_prepare"
    return "visualization"


def route_after_optimizer_gate(state: DataPilotState) -> Literal["executor", "optimizer_prepare", "__end__"]:
    """Approve → executor; first decline → regenerate SQL; final decline or cancel → end."""
    if state.get("sql"):
        return "executor"
    if (state.get("optimizer_regenerate_hint") or "").strip():
        return "optimizer_prepare"
    return "__end__"


def build_graph(checkpointer: Any):
    """Build and compile the DataPilot agent graph with the given checkpointer."""
    graph = StateGraph(DataPilotState)

    graph.add_node("query_kb", run_query_kb)
    graph.add_node("planner", run_planner)
    graph.add_node("discovery", run_discovery)
    graph.add_node("optimizer_prepare", run_optimizer_prepare)
    graph.add_node("optimizer_gate", run_optimizer_gate)
    graph.add_node("executor", run_executor)
    graph.add_node("validator", run_validator)
    graph.add_node("visualization", run_visualization)

    graph.set_entry_point("query_kb")

    graph.add_conditional_edges(
        "query_kb",
        route_after_query_kb,
        {"planner": "planner", "executor": "executor"},
    )
    graph.add_conditional_edges("planner", route_after_planner, {"discovery": "discovery", "__end__": END})
    graph.add_conditional_edges(
        "discovery",
        route_after_discovery,
        {"optimizer_prepare": "optimizer_prepare", "__end__": END},
    )
    graph.add_edge("optimizer_prepare", "optimizer_gate")
    graph.add_conditional_edges(
        "optimizer_gate",
        route_after_optimizer_gate,
        {
            "executor": "executor",
            "optimizer_prepare": "optimizer_prepare",
            "__end__": END,
        },
    )
    graph.add_conditional_edges(
        "executor",
        route_after_executor,
        {"validator": "validator", "optimizer_prepare": "optimizer_prepare", "__end__": END},
    )
    graph.add_conditional_edges(
        "validator",
        route_after_validator,
        {"visualization": "visualization", "optimizer_prepare": "optimizer_prepare"},
    )
    graph.add_edge("visualization", END)

    # Human-in-the-loop uses interrupt() inside optimizer_gate; do not add interrupt_before
    # for the same node or the graph would pause twice (static gate + dynamic interrupt).
    return graph.compile(checkpointer=checkpointer)


# Set by FastAPI lifespan (Postgres) or lazy fallback (MemorySaver) for scripts/tests.
_compiled_graph = None


def set_compiled_graph(compiled) -> None:
    """Replace the compiled graph (called from app lifespan after checkpointer setup)."""
    global _compiled_graph
    _compiled_graph = compiled


def get_graph():
    """Return the compiled DataPilot graph with checkpointer."""
    global _compiled_graph
    if _compiled_graph is None:
        try:
            from langgraph.checkpoint.memory import MemorySaver
        except ImportError:
            from langgraph.checkpoint.memory import InMemorySaver as MemorySaver

        from agents import graph_manager
        saver = MemorySaver()
        graph_manager.set_memory_saver(saver)
        _compiled_graph = build_graph(saver)
    return _compiled_graph
