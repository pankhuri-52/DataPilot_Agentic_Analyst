"""Per-request correlation IDs and amplification counters."""
from __future__ import annotations

import contextvars
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RequestMetrics:
    request_id: str
    method: str
    path: str
    started_at: float
    user_id: str | None = None
    counters: dict[str, int] = field(default_factory=dict)
    quota_limited: bool = False
    error: str | None = None


_CURRENT_METRICS: contextvars.ContextVar[RequestMetrics | None] = contextvars.ContextVar(
    "datapilot_request_metrics",
    default=None,
)


def start_request_metrics(request_id: str, method: str, path: str) -> contextvars.Token:
    metrics = RequestMetrics(
        request_id=request_id,
        method=method,
        path=path,
        started_at=time.perf_counter(),
    )
    return _CURRENT_METRICS.set(metrics)


def set_request_user(user_id: str | None) -> None:
    metrics = _CURRENT_METRICS.get()
    if metrics is None:
        return
    metrics.user_id = str(user_id) if user_id else None


def get_request_id() -> str | None:
    metrics = _CURRENT_METRICS.get()
    return metrics.request_id if metrics else None


def increment_counter(name: str, amount: int = 1) -> None:
    metrics = _CURRENT_METRICS.get()
    if metrics is None:
        return
    metrics.counters[name] = int(metrics.counters.get(name, 0)) + int(amount)


def mark_quota_limited() -> None:
    metrics = _CURRENT_METRICS.get()
    if metrics is None:
        return
    metrics.quota_limited = True


def finish_request_metrics(
    token: contextvars.Token,
    *,
    status_code: int,
    error: str | None = None,
) -> dict[str, Any]:
    metrics = _CURRENT_METRICS.get()
    try:
        if metrics is None:
            return {
                "request_id": None,
                "status_code": int(status_code),
                "duration_ms": 0,
                "path": "",
                "method": "",
                "user_id": None,
                "counters": {},
                "quota_limited": False,
                "error": error,
            }
        if error:
            metrics.error = error
        duration_ms = int((time.perf_counter() - metrics.started_at) * 1000)
        return {
            "request_id": metrics.request_id,
            "status_code": int(status_code),
            "duration_ms": duration_ms,
            "path": metrics.path,
            "method": metrics.method,
            "user_id": metrics.user_id,
            "counters": dict(metrics.counters),
            "quota_limited": bool(metrics.quota_limited),
            "error": metrics.error,
        }
    finally:
        _CURRENT_METRICS.reset(token)
