"""Synchronous retry with exponential backoff + jitter for transient I/O failures."""
from __future__ import annotations

import logging
import os
import random
import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

logger = logging.getLogger("datapilot.retry")

_MAX_ATTEMPTS = max(1, int(os.getenv("DATAPILOT_RETRY_MAX_ATTEMPTS", "5")))
_BASE_DELAY = float(os.getenv("DATAPILOT_RETRY_BASE_DELAY_SEC", "0.5"))
_MAX_DELAY = float(os.getenv("DATAPILOT_RETRY_MAX_DELAY_SEC", "30"))


def _is_quota_or_usage_exhausted(exc: BaseException) -> bool:
    """
    Gemini / Google APIs return RESOURCE_EXHAUSTED or explicit quota messages for
    daily limits and similar. Retrying these in a loop wastes time and confuses users.
    """
    msg = f"{exc!s}\n{type(exc).__name__}\n{exc!r}".lower()
    if "resource_exhausted" in msg or "resource exhausted" in msg:
        return True
    if "exceeded your current quota" in msg or "quota exceeded" in msg:
        return True
    if "generate_requests_per_day" in msg or "requests per day" in msg:
        return True
    if "billing" in msg and ("enable" in msg or "disabled" in msg or "not enabled" in msg):
        return True
    # urllib / httpx bodies often embed JSON with error.reason
    if "generativelanguage" in msg and "quota" in msg and (
        "exhaust" in msg or "limit" in msg or "429" in msg
    ):
        return True
    return False


def _is_transient_error(exc: BaseException) -> bool:
    if isinstance(exc, (ConnectionError, TimeoutError, BrokenPipeError)):
        return True
    try:
        import httpx

        if isinstance(
            exc,
            (
                httpx.ConnectError,
                httpx.ReadTimeout,
                httpx.WriteTimeout,
                httpx.ConnectTimeout,
                httpx.RemoteProtocolError,
            ),
        ):
            return True
    except ImportError:
        pass
    msg = str(exc).lower()
    if "timeout" in msg or "timed out" in msg:
        return True
    if "temporarily unavailable" in msg or "connection reset" in msg:
        return True
    if "connection refused" in msg:
        return True
    # Do not treat quota exhaustion as transient (handled above).
    if _is_quota_or_usage_exhausted(exc):
        return False
    if "rate limit" in msg:
        return True
    # Bare 429 can be quota or short-lived RPM; quota cases are filtered above.
    if "429" in msg:
        return True
    name = type(exc).__name__
    if name in ("ConnectError", "ReadTimeout", "WriteTimeout", "RemoteProtocolError", "NetworkError"):
        return True
    return False


def retry_sync(
    operation: str,
    fn: Callable[[], T],
    *,
    max_attempts: int = _MAX_ATTEMPTS,
    base_delay: float = _BASE_DELAY,
    max_delay: float = _MAX_DELAY,
) -> T:
    """
    Run ``fn`` and retry on transient network/HTTP client failures with exponential backoff.
    Non-transient errors propagate immediately.
    """
    delay = base_delay
    last_exc: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except BaseException as e:
            last_exc = e
            if _is_quota_or_usage_exhausted(e):
                logger.warning("%s: quota / usage limit — not retrying: %s", operation, e)
                raise
            if not _is_transient_error(e):
                raise
            if attempt >= max_attempts:
                logger.warning("%s: giving up after %s attempts: %s", operation, attempt, e)
                raise
            sleep_s = min(delay, max_delay) + random.uniform(0, min(1.0, 0.25 * delay))
            logger.warning(
                "%s transient error (attempt %s/%s): %s — retry in %.2fs",
                operation,
                attempt,
                max_attempts,
                e,
                sleep_s,
            )
            time.sleep(sleep_s)
            delay = min(delay * 2, max_delay)
    assert last_exc is not None
    raise last_exc
