"""One-shot: upload DataPilot agent prompts to Langfuse (production label).

Run from repo root after .env has LANGFUSE_* keys:
  py -3.12 scripts/seed_langfuse_prompts.py

Or from backend (same effect if cwd is backend):
  py -3.12 ../scripts/seed_langfuse_prompts.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Repo root (parent of scripts/)
_ROOT = Path(__file__).resolve().parent.parent
_BACKEND = _ROOT / "backend"
if not _BACKEND.is_dir():
    raise SystemExit(f"Expected backend dir at {_BACKEND}")

sys.path.insert(0, str(_BACKEND))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc,assignment]

if load_dotenv:
    for env in (_ROOT / ".env", _BACKEND / ".env"):
        if env.exists():
            load_dotenv(env, override=False)

from agents.planner import PLANNER_PROMPT  # noqa: E402
from agents.discovery import DISCOVERY_PROMPT  # noqa: E402
from agents.optimizer import OPTIMIZER_PROMPT_BIGQUERY, OPTIMIZER_PROMPT_POSTGRES  # noqa: E402
from agents.executor import EXECUTOR_PROMPT_BIGQUERY, EXECUTOR_PROMPT_POSTGRES  # noqa: E402
from agents.validator import _RELEVANCE_PROMPT  # noqa: E402
from agents.visualization import VIZ_PROMPT, VIZ_PROMPT_EMPTY  # noqa: E402

from langfuse_setup import langfuse_configured, python_format_to_langfuse_text  # noqa: E402


PROMPTS: list[tuple[str, str]] = [
    ("datapilot-planner", PLANNER_PROMPT),
    ("datapilot-discovery", DISCOVERY_PROMPT),
    ("datapilot-optimizer-bigquery", OPTIMIZER_PROMPT_BIGQUERY),
    ("datapilot-optimizer-postgres", OPTIMIZER_PROMPT_POSTGRES),
    ("datapilot-executor-bigquery", EXECUTOR_PROMPT_BIGQUERY),
    ("datapilot-executor-postgres", EXECUTOR_PROMPT_POSTGRES),
    ("datapilot-validator-relevance", _RELEVANCE_PROMPT),
    ("datapilot-viz", VIZ_PROMPT),
    ("datapilot-viz-empty", VIZ_PROMPT_EMPTY),
]


def main() -> None:
    if not langfuse_configured():
        print("Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in .env", file=sys.stderr)
        sys.exit(1)
    from langfuse import get_client

    client = get_client()
    for name, py_text in PROMPTS:
        lf_text = python_format_to_langfuse_text(py_text)
        client.create_prompt(
            name=name,
            prompt=lf_text,
            labels=["production"],
            type="text",
        )
        print(f"OK: {name} ({len(lf_text)} chars)")
    client.flush()
    print("Done. Prompts labeled production.")


if __name__ == "__main__":
    main()
