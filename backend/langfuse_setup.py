"""Langfuse — client helpers, LangChain callback, cached prompt fetch with fallback."""
from __future__ import annotations

import contextvars
import logging
import os
import re
from typing import Any

logger = logging.getLogger("datapilot.langfuse")

_PROMPT_CACHE_TTL = max(0, int(os.getenv("LANGFUSE_PROMPT_CACHE_TTL_SEC", "300")))

# Stores the most-recently-fetched prompt client so invoke_with_retry can link it to the
# LLM generation span (populates the "Observations" counter in the LangFuse Prompt UI).
# Set by get_prompt(); consumed once by consume_pending_prompt_client() inside llm.py.
_pending_prompt_client: contextvars.ContextVar[Any] = contextvars.ContextVar(
    "_pending_langfuse_prompt_client", default=None
)


def langfuse_configured() -> bool:
    pub = os.getenv("LANGFUSE_PUBLIC_KEY", "").strip()
    sec = os.getenv("LANGFUSE_SECRET_KEY", "").strip()
    return bool(pub and sec)


def flush_langfuse() -> None:
    if not langfuse_configured():
        return
    try:
        from langfuse import get_client

        get_client().flush()
    except Exception:
        logger.debug("Langfuse flush skipped or failed.", exc_info=True)


def get_langfuse_callback_handler() -> Any | None:
    """Return LangChain CallbackHandler, or None if Langfuse is not configured or init fails."""
    if not langfuse_configured():
        return None
    try:
        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception as exc:
        logger.warning("Langfuse CallbackHandler unavailable: %s", exc)
        return None


def merge_langfuse_into_graph_config(
    config: dict[str, Any],
    *,
    thread_id: str,
    user: dict | None,
) -> dict[str, Any]:
    """Attach Langfuse callback + session/user metadata for LangChain/LangGraph (Langfuse v4+)."""
    handler = get_langfuse_callback_handler()
    if handler is None:
        return config
    out = {**config}
    cbs = list(out.get("callbacks") or [])
    cbs.append(handler)
    out["callbacks"] = cbs
    meta = dict(out.get("metadata") or {})
    meta["langfuse_session_id"] = thread_id
    if user and user.get("id") is not None:
        meta["langfuse_user_id"] = str(user["id"])
    out["metadata"] = meta
    return out


def get_prompt(name: str, fallback: str) -> str:
    """
    Fetch production-labeled text prompt from Langfuse; normalize to Python str.format placeholders.
    On failure, return fallback. Uses SDK cache (cache_ttl_seconds).

    Also stores the prompt client in a context variable so invoke_with_retry can call
    update_current_generation(prompt=...) during the LLM span, which populates the
    Observations counter in the LangFuse Prompt Management UI.
    """
    if not langfuse_configured():
        return fallback
    try:
        from langfuse import get_client

        client = get_client()
        p = client.get_prompt(
            name,
            label="production",
            type="text",
            fallback=fallback,
            cache_ttl_seconds=_PROMPT_CACHE_TTL if _PROMPT_CACHE_TTL > 0 else None,
        )
        # Store client for linking inside invoke_with_retry
        _pending_prompt_client.set(p)
        return p.get_langchain_prompt()
    except Exception as exc:
        logger.warning("Langfuse prompt %r fetch failed (%s) — using fallback.", name, exc)
        return fallback


def consume_pending_prompt_client() -> Any | None:
    """
    Called once by invoke_with_retry inside the worker thread (while the generation span
    is still active) to link the prompt to the LLM observation. Clears the stored client
    after reading so each LLM call links only its own prompt.
    """
    client = _pending_prompt_client.get()
    _pending_prompt_client.set(None)
    return client


def python_format_to_langfuse_text(python_prompt: str) -> str:
    """
    Convert {identifier} placeholders (Python .format) to Langfuse {{identifier}} for create_prompt.
    Does not match braces that start JSON (e.g. {"key": ...}).
    """
    return re.sub(
        r"\{([A-Za-z_][A-Za-z0-9_]*)\}",
        r"{{\1}}",
        python_prompt,
    )
