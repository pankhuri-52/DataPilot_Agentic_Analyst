"""
DataPilot shared state – flows through all agents in the LangGraph.
"""
from typing import TypedDict, Optional, Any
from pydantic import BaseModel, Field


class AnalysisPlan(BaseModel):
    """Structured plan from the Planning Agent."""
    metrics: list[str] = Field(description="What to measure (e.g. revenue, total_amount, count)")
    dimensions: list[str] = Field(description="Group by (e.g. region, category, segment)")
    filters: dict[str, Any] = Field(default_factory=dict, description="Filters (e.g. date range, status)")
    is_valid: bool = Field(description="Whether the query is valid and analyzable")
    clarifying_questions: list[str] = Field(default_factory=list, description="Questions to ask if invalid")


class DataFeasibility(BaseModel):
    """Output from Data Discovery Agent."""
    feasibility: str = Field(description="full | partial | none")
    nearest_plan: Optional[dict[str, Any]] = Field(default=None, description="Adjusted plan if partial (metrics, dimensions, filters)")
    missing_explanation: Optional[str] = Field(default=None, description="What fields/columns are missing")
    tables_used: list[str] = Field(default_factory=list, description="Tables that can be used")


class ChartSpec(BaseModel):
    """Chart specification from Visualization Agent."""
    chart_type: str = Field(description="bar | line | pie | table")
    x_field: Optional[str] = Field(default=None, description="Field for x-axis")
    y_field: Optional[str] = Field(default=None, description="Field for y-axis")
    title: Optional[str] = Field(default=None, description="Chart title")


class TraceEntry(BaseModel):
    """Single step in the agent trace."""
    agent: str
    status: str = Field(description="success | error | info")
    message: Optional[str] = None
    output: Optional[dict[str, Any]] = None


class DataPilotState(TypedDict, total=False):
    """Shared state flowing through all agents. Values stored as dicts for LangGraph."""
    query: str
    plan: Optional[dict[str, Any]]  # AnalysisPlan as dict
    data_feasibility: str  # "full" | "partial" | "none"
    nearest_plan: Optional[dict[str, Any]]  # AnalysisPlan as dict if partial
    missing_explanation: Optional[str]
    sql: Optional[str]
    raw_results: Optional[list[dict[str, Any]]]
    validation_ok: bool
    chart_spec: Optional[dict[str, Any]]
    explanation: str
    trace: list[dict[str, Any]]
