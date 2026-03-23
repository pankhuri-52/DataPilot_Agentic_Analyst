"""
Emit trace entries to LangGraph custom stream while agents run.

When the graph is executed with stream_mode including \"custom\", each append
reaches the client over SSE immediately (not only after the node returns).
No-op when not in a streaming context (e.g. graph.invoke in tests).
"""

from __future__ import annotations


def emit_trace_progress(entry: dict) -> None:
    """Send one trace dict to LangGraph custom stream (best-effort)."""
    try:
        from langgraph.config import get_stream_writer

        get_stream_writer()({"kind": "trace_progress", "entry": entry})
    except Exception:
        pass


def append_trace(trace: list, entry: dict) -> None:
    """Append to state trace and mirror to the live stream when streaming."""
    trace.append(entry)
    emit_trace_progress(entry)
