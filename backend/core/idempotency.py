"""Simple in-memory idempotency/in-flight guards for expensive routes."""
from __future__ import annotations

import copy
import threading
import time
from typing import Any

_LOCK = threading.Lock()
_IN_FLIGHT: dict[str, float] = {}
_CACHED_RESPONSES: dict[str, tuple[float, dict[str, Any]]] = {}


def _prune(now: float) -> None:
    expired_locks = [k for k, expires_at in _IN_FLIGHT.items() if expires_at <= now]
    for k in expired_locks:
        _IN_FLIGHT.pop(k, None)

    expired_cache = [k for k, (expires_at, _) in _CACHED_RESPONSES.items() if expires_at <= now]
    for k in expired_cache:
        _CACHED_RESPONSES.pop(k, None)


def acquire_in_flight(key: str, *, ttl_sec: int = 180) -> bool:
    now = time.time()
    with _LOCK:
        _prune(now)
        if key in _IN_FLIGHT:
            return False
        _IN_FLIGHT[key] = now + max(1, int(ttl_sec))
        return True


def release_in_flight(key: str) -> None:
    with _LOCK:
        _IN_FLIGHT.pop(key, None)


def get_cached_response(key: str) -> dict[str, Any] | None:
    now = time.time()
    with _LOCK:
        _prune(now)
        hit = _CACHED_RESPONSES.get(key)
        if not hit:
            return None
        return copy.deepcopy(hit[1])


def set_cached_response(key: str, response: dict[str, Any], *, ttl_sec: int = 120) -> None:
    expires_at = time.time() + max(1, int(ttl_sec))
    with _LOCK:
        _CACHED_RESPONSES[key] = (expires_at, copy.deepcopy(response))
