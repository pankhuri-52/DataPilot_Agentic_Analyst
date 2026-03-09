"""
Abstract base class for database connectors.
"""
from abc import ABC, abstractmethod
from typing import Any


class DatabaseConnector(ABC):
    """Abstract connector for executing queries and diagnostics."""

    @abstractmethod
    def execute(self, sql: str) -> list[dict[str, Any]]:
        """Execute a SQL query and return rows as list of dicts."""
        pass

    @abstractmethod
    def run_date_range_diagnostic(self, schema: dict) -> tuple[dict | None, str | None]:
        """
        When main query returns 0 rows, run diagnostic to get date range.
        Returns (data_range, empty_result_reason) or (None, None).
        """
        pass

    @property
    @abstractmethod
    def dialect(self) -> str:
        """SQL dialect: bigquery, postgres, mysql."""
        pass
