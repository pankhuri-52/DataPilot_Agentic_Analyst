#!/usr/bin/env python3
"""
DataPilot Golden Query Eval Runner
====================================
Runs accuracy checks against golden_queries.json in two layers:

  Layer 1 – Guard evals (regex, no API key, instant):
    Checks injection detection and schema-introspection detection.

  Layer 2 – LLM scope evals (requires GOOGLE_API_KEY):
    Calls the real Gemini planner and checks query_scope / is_valid.

Usage
-----
  # Layer 1 only (always works):
  python tests/evals/run_evals.py

  # Both layers (needs GOOGLE_API_KEY in environment):
  python tests/evals/run_evals.py --llm

  # Windows PowerShell:
  $env:GOOGLE_API_KEY="your_key"; python tests/evals/run_evals.py --llm
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup – make backend/ importable
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

GOLDEN_PATH = Path(__file__).resolve().parent / "golden_queries.json"


# ---------------------------------------------------------------------------
# ANSI colours
# ---------------------------------------------------------------------------

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def _pass(s: str) -> str:
    return f"{GREEN}PASS{RESET}  {s}"

def _fail(s: str) -> str:
    return f"{RED}FAIL{RESET}  {s}"

def _skip(s: str) -> str:
    return f"{YELLOW}SKIP{RESET}  {s}"


# ---------------------------------------------------------------------------
# Guard-layer eval (no LLM)
# ---------------------------------------------------------------------------

def _run_guard_evals(cases: list[dict]) -> tuple[int, int]:
    """Returns (passed, total) for guard-layer cases."""
    from agents.planner import _INJECTION_PATTERNS, _is_schema_introspection_query

    guard_cases = [c for c in cases if "expected_guard" in c and not c.get("_comment")]
    if not guard_cases:
        return 0, 0

    print(f"\n{BOLD}{CYAN}── Guard Layer Evals ({len(guard_cases)} cases) ──{RESET}")
    print(f"{'ID':<14} {'Expected':<22} {'Result':<10} Note")
    print("─" * 80)

    passed = 0
    for case in guard_cases:
        qid = case.get("id", "?")
        query = case["query"]
        expected = case["expected_guard"]
        note = case.get("note", "")

        is_injection = bool(_INJECTION_PATTERNS.search(query))
        is_introspection = _is_schema_introspection_query(query)

        if expected == "injection":
            ok = is_injection
        elif expected == "schema_introspection":
            ok = is_introspection and not is_injection
        elif expected == "none":
            ok = not is_injection and not is_introspection
        else:
            ok = False

        actual = (
            "injection" if is_injection
            else "schema_introspection" if is_introspection
            else "none"
        )

        if ok:
            passed += 1
            print(f"{qid:<14} {expected:<22} {_pass(actual):<30} {note[:40]}")
        else:
            print(f"{qid:<14} {expected:<22} {_fail(actual):<30} {note[:40]}")

    print()
    return passed, len(guard_cases)


# ---------------------------------------------------------------------------
# LLM scope eval
# ---------------------------------------------------------------------------

def _run_llm_evals(cases: list[dict]) -> tuple[int, int]:
    """Returns (passed, total) for LLM scope cases. Requires GOOGLE_API_KEY."""
    llm_cases = [c for c in cases if "expected_scope" in c and not c.get("_comment")]
    if not llm_cases:
        return 0, 0

    if not os.environ.get("GOOGLE_API_KEY"):
        print(f"\n{YELLOW}Skipping LLM evals – GOOGLE_API_KEY not set.{RESET}")
        print(f"  Run with --llm and set GOOGLE_API_KEY to enable LLM scope checks.\n")
        return 0, 0

    print(f"\n{BOLD}{CYAN}── LLM Scope Evals ({len(llm_cases)} cases) ──{RESET}")
    print(f"  Using Gemini planner (this may take 30–90 seconds)\n")
    print(f"{'ID':<14} {'Expected scope':<22} {'Got scope':<22} {'is_valid':<10} Note")
    print("─" * 90)

    # Lazy imports (only if we actually run LLM evals)
    from agents.planner import run_planner
    from agents.schema_utils import load_schema

    schema = load_schema()

    passed = 0
    for case in llm_cases:
        qid = case.get("id", "?")
        query = case["query"]
        expected_scope = case["expected_scope"]
        expected_valid = case.get("expected_is_valid")
        note = case.get("note", "")

        state = {
            "query": query,
            "trace": [],
            "conversation_history": [],
            "schema_catalog": schema,
            "active_source_id": "primary",
        }

        try:
            result = run_planner(state)
            plan = result.get("plan") or {}
            got_scope = (plan.get("query_scope") or "").strip().lower()
            got_valid = plan.get("is_valid", False)

            scope_ok = got_scope == expected_scope
            valid_ok = (expected_valid is None) or (got_valid == expected_valid)
            ok = scope_ok and valid_ok

            valid_str = str(got_valid)
            if ok:
                passed += 1
                print(
                    f"{qid:<14} {expected_scope:<22} {_pass(got_scope):<35} "
                    f"{valid_str:<10} {note[:35]}"
                )
            else:
                mismatch = f"{got_scope} (valid={got_valid})"
                print(
                    f"{qid:<14} {expected_scope:<22} {_fail(got_scope):<35} "
                    f"{valid_str:<10} {note[:35]}"
                )

        except Exception as exc:
            print(f"{qid:<14} {expected_scope:<22} {_fail('ERROR'):<35} {'?':<10} {exc}")

        # Small delay to respect rate limits
        time.sleep(1.5)

    print()
    return passed, len(llm_cases)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def _print_summary(guard_p: int, guard_t: int, llm_p: int, llm_t: int) -> None:
    print(f"{BOLD}{'─'*50}{RESET}")
    print(f"{BOLD}Results Summary{RESET}")

    if guard_t:
        pct = 100 * guard_p // guard_t
        colour = GREEN if pct == 100 else (YELLOW if pct >= 80 else RED)
        print(f"  Guard layer : {colour}{guard_p}/{guard_t} ({pct}%){RESET}")
    else:
        print(f"  Guard layer : no cases")

    if llm_t:
        pct = 100 * llm_p // llm_t
        colour = GREEN if pct >= 90 else (YELLOW if pct >= 70 else RED)
        print(f"  LLM scope   : {colour}{llm_p}/{llm_t} ({pct}%){RESET}")
    elif llm_t == 0 and guard_t > 0:
        print(f"  LLM scope   : {YELLOW}skipped (run with --llm){RESET}")

    total_p = guard_p + llm_p
    total_t = guard_t + llm_t
    if total_t:
        pct = 100 * total_p // total_t
        colour = GREEN if pct >= 90 else (YELLOW if pct >= 70 else RED)
        print(f"  Overall     : {colour}{total_p}/{total_t} ({pct}%){RESET}")

    print(f"{BOLD}{'─'*50}{RESET}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="DataPilot Golden Query Eval Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--llm",
        action="store_true",
        help="Also run LLM scope classification evals (requires GOOGLE_API_KEY)",
    )
    args = parser.parse_args()

    print(f"\n{BOLD}DataPilot Eval Runner{RESET}")
    print(f"Golden queries : {GOLDEN_PATH}")

    if not GOLDEN_PATH.exists():
        print(f"{RED}Error: {GOLDEN_PATH} not found.{RESET}")
        return 1

    with open(GOLDEN_PATH, encoding="utf-8") as f:
        cases = json.load(f)

    # Filter out comment-only entries
    cases = [c for c in cases if "query" in c]

    guard_p, guard_t = _run_guard_evals(cases)

    llm_p, llm_t = 0, 0
    if args.llm:
        llm_p, llm_t = _run_llm_evals(cases)
    else:
        llm_cases = [c for c in cases if "expected_scope" in c]
        if llm_cases:
            print(
                f"\n{YELLOW}ℹ  {len(llm_cases)} LLM scope cases available."
                f"  Run with --llm to include them.{RESET}"
            )
        llm_t = 0

    _print_summary(guard_p, guard_t, llm_p, llm_t)

    # Return non-zero exit code if any guard tests failed (useful for CI)
    if guard_t and guard_p < guard_t:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
