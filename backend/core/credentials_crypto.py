"""Fernet encrypt/decrypt for user_data_sources.encrypted_config."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("datapilot.crypto")


def _fernet():
    from cryptography.fernet import Fernet

    key = (os.getenv("DATAPILOT_CREDENTIALS_KEY") or "").strip()
    if not key:
        return None
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception:
        logger.exception("Invalid DATAPILOT_CREDENTIALS_KEY")
        return None


def encrypt_config(payload: dict[str, Any]) -> str:
    f = _fernet()
    if f is None:
        raise ValueError(
            "DATAPILOT_CREDENTIALS_KEY is not set or invalid. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return f.encrypt(raw).decode("ascii")


def decrypt_config(token: str) -> dict[str, Any]:
    f = _fernet()
    if f is None:
        raise ValueError("DATAPILOT_CREDENTIALS_KEY is not set or invalid")
    raw = f.decrypt(token.encode("ascii"))
    return json.loads(raw.decode("utf-8"))
