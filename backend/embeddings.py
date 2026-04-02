"""
Text embeddings via OpenAI API.
Uses OPENAI_API_KEY.
"""
from __future__ import annotations

import logging
import os

from core.request_metrics import increment_counter
from core.retry import retry_sync

logger = logging.getLogger("datapilot.embeddings")

_OPENAI_EMBED_MAX_ATTEMPTS = max(1, int(os.getenv("OPENAI_EMBED_MAX_ATTEMPTS", "2")))

def _embedding_dimension() -> int:
    raw = os.getenv("OPENAI_EMBEDDING_DIMENSION", "768").strip()
    try:
        n = int(raw)
        if n in (512, 768, 1536, 3072):
            return n
    except ValueError:
        pass
    return 768


def _embedding_model() -> str:
    return (
        os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small").strip()
        or "text-embedding-3-small"
    )


def embed_text(text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
    """
    Return embedding vector for text. task_type: RETRIEVAL_QUERY for search queries,
    RETRIEVAL_DOCUMENT for stored index strings (asymmetric retrieval).
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set (required for embeddings)")
    t = (text or "").strip()
    if not t:
        raise ValueError("Cannot embed empty text")

    model = _embedding_model()
    dim = _embedding_dimension()

    def _call():
        increment_counter("embedding_attempts", 1)
        from openai import OpenAI

        client = OpenAI(api_key=api_key, timeout=60.0)
        kwargs = {"model": model, "input": t}
        if model.startswith("text-embedding-3"):
            kwargs["dimensions"] = dim

        response = client.embeddings.create(**kwargs)
        emb = response.data[0].embedding if response.data else None
        if not isinstance(emb, list) or not emb:
            raise ValueError("Embedding API returned no values")
        if len(emb) != dim:
            logger.warning(
                "Embedding length %s != expected %s — check OPENAI_EMBEDDING_DIMENSION vs DB vector(N)",
                len(emb),
                dim,
            )
        return [float(x) for x in emb]

    return retry_sync("openai.embed", _call, max_attempts=_OPENAI_EMBED_MAX_ATTEMPTS)


def embed_text_with_retry(text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
    """Same as embed_text; name mirrors llm.invoke_with_retry usage."""
    return embed_text(text, task_type=task_type)
