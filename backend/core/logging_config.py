"""Application-wide logging setup."""
from __future__ import annotations

import logging
import os
import sys


def setup_logging() -> None:
    """Configure root logging once (idempotent). Respects LOG_LEVEL env (default INFO)."""
    root = logging.getLogger()
    if root.handlers:
        return
    level_name = (os.getenv("LOG_LEVEL") or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=sys.stdout,
        force=False,
    )
