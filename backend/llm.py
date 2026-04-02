"""
OpenAI LLM helpers for DataPilot.
Uses OPENAI_API_KEY from .env.
"""
import concurrent.futures
import contextvars
import json
import os
import re
from typing import Any

from core.request_metrics import increment_counter
from core.retry import retry_sync

# Few retries for real network blips only; quota errors do not retry (see core.retry).
_OPENAI_INVOKE_MAX_ATTEMPTS = max(1, int(os.getenv("OPENAI_INVOKE_MAX_ATTEMPTS", "2")))

# Wall-clock cap for a single LLM invoke attempt.  Configurable via LLM_CALL_TIMEOUT_SEC.
# A timeout is treated as a hard failure and is NOT retried — hanging longer won't help.
_LLM_TIMEOUT_SEC = float(os.getenv("LLM_CALL_TIMEOUT_SEC", "60"))


class LLMCallTimeoutError(Exception):
    """Raised when a single LLM invoke exceeds LLM_CALL_TIMEOUT_SEC.

    Deliberately NOT a subclass of TimeoutError so that core.retry does not
    treat it as a transient network error and attempt another hung call.
    """


def get_structured_llm(llm, schema: Any):
    """
    Build a strict structured-output wrapper that works across OpenAI/LangChain versions.

    Prefer function-calling for broad schema compatibility across Pydantic models.
    Falls back to provider-native json_schema when supported.
    """
    candidates = (
        {"method": "function_calling", "strict": True},
        {"method": "function_calling"},
        {"method": "json_schema", "strict": True},
        {"method": "json_schema"},
        {},
    )
    last_err: Exception | None = None
    for kwargs in candidates:
        try:
            return llm.with_structured_output(schema, **kwargs)
        except Exception as exc:  # pragma: no cover - fallback by runtime sdk version/model support
            last_err = exc
    if last_err is not None:
        raise last_err
    return llm.with_structured_output(schema)


def coerce_ai_text(result: Any) -> str:
    """
    Normalize LangChain/OpenAI message content into plain text.
    Handles string content, multimodal block lists, and fallback objects.
    """
    content = result.content if hasattr(result, "content") else result
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                if item.strip():
                    parts.append(item.strip())
                continue
            if isinstance(item, dict):
                text_val = item.get("text")
                if isinstance(text_val, str) and text_val.strip():
                    parts.append(text_val.strip())
                    continue
                content_val = item.get("content")
                if isinstance(content_val, str) and content_val.strip():
                    parts.append(content_val.strip())
                    continue
                if item.get("type") == "text":
                    parts.append(str(item))
                    continue
            if item is not None:
                parts.append(str(item))
        return "\n".join(p for p in parts if p).strip()
    return str(content)


def _is_structured_schema_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "invalid schema for response_format" in msg
        or "invalid schema for function" in msg
        or "invalid_function_parameters" in msg
        or "response_format" in msg and "invalid_request_error" in msg
    )


def _extract_json_object(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```$", "", t)
        t = t.strip()
    if t.startswith("{") and t.endswith("}"):
        return t
    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end != -1 and end > start:
        return t[start : end + 1]
    return t


def invoke_structured_with_retry(llm, schema: Any, prompt: str):
    """
    Invoke structured output with provider-native path first, then JSON-text fallback.
    """
    try:
        structured_llm = get_structured_llm(llm, schema)
        return invoke_with_retry(structured_llm, prompt)
    except Exception as exc:
        if not _is_structured_schema_error(exc):
            raise
    # Schema incompatibility fallback for models/providers that reject strict schema.
    schema_json = None
    if hasattr(schema, "model_json_schema"):
        try:
            schema_json = json.dumps(schema.model_json_schema(), ensure_ascii=True)
        except Exception:
            schema_json = None
    fallback_prompt = (
        f"{prompt}\n\n"
        "Return only a valid JSON object that matches the required output schema exactly. "
        "Do not include markdown, prose, or code fences."
    )
    if schema_json:
        fallback_prompt += f"\n\nJSON schema:\n{schema_json}"

    raw = invoke_with_retry(llm, fallback_prompt)
    text = _extract_json_object(coerce_ai_text(raw))
    try:
        if hasattr(schema, "model_validate_json"):
            return schema.model_validate_json(text)
        obj = json.loads(text)
        return schema(**obj)
    except Exception as first_err:
        repair_prompt = (
            f"{fallback_prompt}\n\n"
            f"Your previous JSON failed schema validation:\n{first_err}\n\n"
            "Return corrected JSON only."
        )
        raw2 = invoke_with_retry(llm, repair_prompt)
        text2 = _extract_json_object(coerce_ai_text(raw2))
        if hasattr(schema, "model_validate_json"):
            return schema.model_validate_json(text2)
        obj2 = json.loads(text2)
        return schema(**obj2)


def get_llm():
    """Return an OpenAI chat model. Requires OPENAI_API_KEY in .env."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY is not set. Add it to your .env file. "
            "Get a key at https://platform.openai.com/api-keys"
        )
    from langchain_openai import ChatOpenAI

    # Fast/cheap default; override with OPENAI_MODEL in env.
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    # Retries: use invoke_with_retry (exponential backoff) instead of LangChain's internal retries.
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        max_retries=1,
        timeout=_LLM_TIMEOUT_SEC,
        temperature=0,
    )


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
                # Consume any stored prompt client token to avoid cross-call leakage.
                # Linking prompt->generation is skipped here because callback/span context
                # can be unavailable in worker-thread execution and may emit noisy warnings.
                try:
                    from langfuse_setup import consume_pending_prompt_client
                    consume_pending_prompt_client()
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

    return retry_sync("openai.invoke", _call, max_attempts=_OPENAI_INVOKE_MAX_ATTEMPTS)
