"""
Text embeddings via Gemini API (gemini-embedding-001). Uses GOOGLE_API_KEY.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

from core.retry import retry_sync

logger = logging.getLogger("datapilot.embeddings")

_GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"
)


def _embedding_dimension() -> int:
    raw = os.getenv("GEMINI_EMBEDDING_DIMENSION", "768").strip()
    try:
        n = int(raw)
        if n in (768, 1536, 3072):
            return n
    except ValueError:
        pass
    return 768


def _embedding_model() -> str:
    return os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001").strip() or "gemini-embedding-001"


def embed_text(text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
    """
    Return embedding vector for text. task_type: RETRIEVAL_QUERY for search queries,
    RETRIEVAL_DOCUMENT for stored index strings (asymmetric retrieval).
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY is not set (required for embeddings)")
    t = (text or "").strip()
    if not t:
        raise ValueError("Cannot embed empty text")

    model = _embedding_model()
    dim = _embedding_dimension()
    url = _GEMINI_EMBED_URL.format(model=model) + f"?key={api_key}"
    body = {
        "model": f"models/{model}",
        "content": {"parts": [{"text": t}]},
        "taskType": task_type,
        "outputDimensionality": dim,
    }
    body_bytes = json.dumps(body).encode("utf-8")

    def _call():
        req = urllib.request.Request(
            url,
            data=body_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            logger.warning("embed HTTP error %s: %s", e.code, err_body[:500])
            raise ValueError(f"Embedding API error {e.code}: {err_body[:200]}") from e

        emb = (payload.get("embedding") or {}).get("values")
        if not isinstance(emb, list) or not emb:
            raise ValueError("Embedding API returned no values")
        if len(emb) != dim:
            logger.warning(
                "Embedding length %s != expected %s — check GEMINI_EMBEDDING_DIMENSION vs DB vector(N)",
                len(emb),
                dim,
            )
        return [float(x) for x in emb]

    return retry_sync("gemini.embed", _call)


def embed_text_with_retry(text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
    """Same as embed_text; name mirrors llm.invoke_with_retry usage."""
    return embed_text(text, task_type=task_type)
