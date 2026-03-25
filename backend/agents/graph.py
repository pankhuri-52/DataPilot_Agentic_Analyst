"""
LangGraph orchestration – wires all agents into a state machine.
Uses MemorySaver checkpointer for interrupt-based human-in-the-loop.
"""
from typing import Literal
from langgraph.graph import StateGraph, END
try:
    from langgraph.checkpoint.memory import MemorySaver
except ImportError:
    from langgraph.checkpoint.memory import InMemorySaver as MemorySaver

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


def route_after_optimizer_gate(state: DataPilotState) -> Literal["executor", "__end__"]:
    """If gate promoted pending SQL (user approved), go to executor; else end."""
    if state.get("sql"):
        return "executor"
    return "__end__"


def build_graph():
    """Build and compile the DataPilot agent graph with checkpointer."""
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
        {"executor": "executor", "__end__": END},
    )
    graph.add_edge("executor", "validator")
    graph.add_edge("validator", "visualization")
    graph.add_edge("visualization", END)

    memory = MemorySaver()
    return graph.compile(checkpointer=memory)


# Singleton compiled graph
_graph = None


def get_graph():
    """Return the compiled DataPilot graph with checkpointer."""
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
