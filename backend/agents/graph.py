"""
LangGraph orchestration – wires all agents into a state machine.
"""
from typing import Literal
from langgraph.graph import StateGraph, END

from agents.state import DataPilotState
from agents.planner import run_planner
from agents.discovery import run_discovery
from agents.executor import run_executor
from agents.validator import run_validator
from agents.visualization import run_visualization


def route_after_planner(state: DataPilotState) -> Literal["discovery", "__end__"]:
    """If plan is valid, go to discovery; else end."""
    plan = state.get("plan")
    if plan and plan.get("is_valid"):
        return "discovery"
    return "__end__"


def route_after_discovery(state: DataPilotState) -> Literal["executor", "__end__"]:
    """If feasibility is full or partial, go to executor; else end."""
    feasibility = state.get("data_feasibility", "none")
    if feasibility in ("full", "partial"):
        return "executor"
    return "__end__"


def build_graph() -> StateGraph:
    """Build and compile the DataPilot agent graph."""
    graph = StateGraph(DataPilotState)

    graph.add_node("planner", run_planner)
    graph.add_node("discovery", run_discovery)
    graph.add_node("executor", run_executor)
    graph.add_node("validator", run_validator)
    graph.add_node("visualization", run_visualization)

    graph.set_entry_point("planner")

    graph.add_conditional_edges("planner", route_after_planner, {"discovery": "discovery", "__end__": END})
    graph.add_conditional_edges("discovery", route_after_discovery, {"executor": "executor", "__end__": END})
    graph.add_edge("executor", "validator")
    graph.add_edge("validator", "visualization")
    graph.add_edge("visualization", END)

    return graph.compile()


# Singleton compiled graph
_graph = None


def get_graph():
    """Return the compiled DataPilot graph."""
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
