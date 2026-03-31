"""
LangGraph orchestration – wires all agents into a dynamic hub-and-spoke state machine.

Instead of static conditional routing functions, an LLM orchestrator node decides
at runtime which agent to invoke next. Every agent returns to the orchestrator after
completing, and the orchestrator reasons about the pipeline state to pick the next step.

Checkpointer is injected at app startup (PostgreSQL via lifespan, or MemorySaver fallback).
"""
from typing import Any

from langgraph.graph import StateGraph, END

from agents.state import DataPilotState
from agents.orchestrator import run_orchestrator
from agents.query_kb import run_query_kb
from agents.planner import run_planner
from agents.discovery import run_discovery
from agents.optimizer import run_optimizer_gate, run_optimizer_prepare
from agents.executor import run_executor
from agents.validator import run_validator
from agents.visualization import run_visualization


def route_from_orchestrator(state: DataPilotState) -> str:
    """Read the orchestrator's routing decision from state."""
    return state.get("next_agent") or "__end__"


def build_graph(checkpointer: Any):
    """Build and compile the DataPilot agent graph with the given checkpointer."""
    graph = StateGraph(DataPilotState)

    # Register all nodes
    graph.add_node("orchestrator", run_orchestrator)
    graph.add_node("query_kb", run_query_kb)
    graph.add_node("planner", run_planner)
    graph.add_node("discovery", run_discovery)
    graph.add_node("optimizer_prepare", run_optimizer_prepare)
    graph.add_node("optimizer_gate", run_optimizer_gate)
    graph.add_node("executor", run_executor)
    graph.add_node("validator", run_validator)
    graph.add_node("visualization", run_visualization)

    # Entry point: orchestrator decides the first agent to call
    graph.set_entry_point("orchestrator")

    # Orchestrator dynamically routes to any agent based on LLM decision
    graph.add_conditional_edges(
        "orchestrator",
        route_from_orchestrator,
        {
            "query_kb": "query_kb",
            "planner": "planner",
            "discovery": "discovery",
            "optimizer_prepare": "optimizer_prepare",
            "optimizer_gate": "optimizer_gate",
            "executor": "executor",
            "validator": "validator",
            "visualization": "visualization",
            "__end__": END,
        },
    )

    # Every agent returns to orchestrator after completing (hub-and-spoke)
    for agent in [
        "query_kb", "planner", "discovery", "optimizer_prepare",
        "optimizer_gate", "executor", "validator", "visualization",
    ]:
        graph.add_edge(agent, "orchestrator")

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
