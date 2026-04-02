"""
Gemini LLM for DataPilot
Uses GOOGLE_API_KEY from .env
"""
import concurrent.futures
import contextvars
import os

from core.request_metrics import increment_counter
from core.retry import retry_sync

# Few retries for real network blips only; quota errors do not retry (see core.retry).
_GEMINI_INVOKE_MAX_ATTEMPTS = max(1, int(os.getenv("GEMINI_INVOKE_MAX_ATTEMPTS", "2")))

# Wall-clock cap for a single LLM invoke attempt.  Configurable via LLM_CALL_TIMEOUT_SEC.
# A timeout is treated as a hard failure and is NOT retried — hanging longer won't help.
_LLM_TIMEOUT_SEC = float(os.getenv("LLM_CALL_TIMEOUT_SEC", "60"))


class LLMCallTimeoutError(Exception):
    """Raised when a single LLM invoke exceeds LLM_CALL_TIMEOUT_SEC.

    Deliberately NOT a subclass of TimeoutError so that core.retry does not
    treat it as a transient network error and attempt another hung call.
    """


def get_gemini():
    """Return a Gemini chat model. Requires GOOGLE_API_KEY in .env."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError(
            "GOOGLE_API_KEY is not set. Add it to your .env file. "
            "Get a key at https://aistudio.google.com/apikey"
        )
    from langchain_google_genai import ChatGoogleGenerativeAI

    # gemini-2.0-flash: 1500 req/day free tier. Override with GEMINI_MODEL env var.
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    # Retries: use invoke_with_retry (exponential backoff) instead of LangChain's internal retries.
    return ChatGoogleGenerativeAI(model=model, api_key=api_key, max_retries=1)


def invoke_with_retry(llm, /, *args, **kwargs):
    """
    Invoke a LangChain chat model with transient-failure retries and a per-call timeout.

    Each attempt is run in a worker thread so we can apply a hard wall-clock limit
    (LLM_CALL_TIMEOUT_SEC, default 60 s).  On timeout, LLMCallTimeoutError is raised
    immediately — it is not retried, because a hanging model won't recover on the next
    attempt.  executor.shutdown(wait=False) ensures we do not block waiting for the
    abandoned thread; it will finish whenever the underlying network connection closes.

    LangChain propagates callbacks via contextvars; the worker thread must run inside
    a copy of the caller context (e.g. for Langfuse CallbackHandler).
    """
    ctx = contextvars.copy_context()

    def _call():
        increment_counter("llm_invoke_attempts", 1)
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            def _invoke_and_link():
                result = llm.invoke(*args, **kwargs)
                # Link the LangFuse prompt client to this generation span while it is
                # still the active span — this populates the Observations counter in
                # the LangFuse Prompt Management UI.
                try:
                    from langfuse_setup import consume_pending_prompt_client
                    from langfuse import get_client
                    pending = consume_pending_prompt_client()
                    if pending is not None:
                        get_client().update_current_generation(prompt=pending)
                except Exception:
                    pass
                return result

            future = executor.submit(ctx.run, _invoke_and_link)
            try:
                return future.result(timeout=_LLM_TIMEOUT_SEC)
            except concurrent.futures.TimeoutError:
                raise LLMCallTimeoutError(
                    f"The model did not respond within {_LLM_TIMEOUT_SEC:.0f}s — "
                    "the API may be temporarily overloaded. Please try again shortly."
                )
        finally:
            executor.shutdown(wait=False)

    return retry_sync("gemini.invoke", _call, max_attempts=_GEMINI_INVOKE_MAX_ATTEMPTS)
