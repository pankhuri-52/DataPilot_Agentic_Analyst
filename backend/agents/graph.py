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
from agents.planner import run_planner
from agents.discovery import run_discovery
from agents.optimizer import run_optimizer
from agents.executor import run_executor
from agents.validator import run_validator
from agents.visualization import run_visualization


def route_after_planner(state: DataPilotState) -> Literal["discovery", "__end__"]:
    """If plan is valid, go to discovery; else end."""
    plan = state.get("plan")
    if plan and plan.get("is_valid"):
        return "discovery"
    return "__end__"


def route_after_discovery(state: DataPilotState) -> Literal["optimizer", "__end__"]:
    """If feasibility is full or partial, go to optimizer; else end."""
    feasibility = state.get("data_feasibility", "none")
    if feasibility in ("full", "partial"):
        return "optimizer"
    return "__end__"


def route_after_optimizer(state: DataPilotState) -> Literal["executor", "__end__"]:
    """If optimizer produced sql (user approved), go to executor; else end."""
    if state.get("sql"):
        return "executor"
    return "__end__"


def build_graph():
    """Build and compile the DataPilot agent graph with checkpointer."""
    graph = StateGraph(DataPilotState)

    graph.add_node("planner", run_planner)
    graph.add_node("discovery", run_discovery)
    graph.add_node("optimizer", run_optimizer)
    graph.add_node("executor", run_executor)
    graph.add_node("validator", run_validator)
    graph.add_node("visualization", run_visualization)

    graph.set_entry_point("planner")

    graph.add_conditional_edges("planner", route_after_planner, {"discovery": "discovery", "__end__": END})
    graph.add_conditional_edges("discovery", route_after_discovery, {"optimizer": "optimizer", "__end__": END})
    graph.add_conditional_edges("optimizer", route_after_optimizer, {"executor": "executor", "__end__": END})
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
