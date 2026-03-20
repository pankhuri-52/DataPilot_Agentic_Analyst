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
    query_scope: Optional[str] = Field(
        default=None,
        description="data_question | out_of_scope | needs_clarification — classify the user's message",
    )


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
    conversation_history: list[dict[str, Any]]  # [{role, content, metadata?}] for conversational context
    plan: Optional[dict[str, Any]]  # AnalysisPlan as dict
    data_feasibility: str  # "full" | "partial" | "none"
    nearest_plan: Optional[dict[str, Any]]  # AnalysisPlan as dict if partial
    missing_explanation: Optional[str]
    tables_used: list[str]  # From Discovery; used for approval interrupt
    sql: Optional[str]  # From Optimizer when user approves execution
    bytes_scanned: Optional[int]  # BigQuery dry run estimate
    estimated_cost: Optional[float]  # BigQuery cost estimate (USD)
    raw_results: Optional[list[dict[str, Any]]]
    validation_ok: bool
    chart_spec: Optional[dict[str, Any]]
    explanation: str
    trace: list[dict[str, Any]]
    data_range: Optional[dict[str, Any]]  # {"min": "YYYY-MM-DD", "max": "YYYY-MM-DD", "table": "...", "column": "..."}
    empty_result_reason: Optional[str]  # Contextual explanation when query returns 0 rows
