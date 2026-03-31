# DataPilot – Tests & Evals

```
tests/
├── unit/                  Pure-Python unit tests (no LLM, no DB, fast)
│   ├── test_sql_allowlist.py
│   ├── test_time_window_guard.py
│   ├── test_planner_guards.py
│   └── test_validator.py
└── evals/                 Golden-query eval suite (shows accuracy scores)
    ├── golden_queries.json
    └── run_evals.py
```

---

## 1  Install test dependencies

```bash
# From project root
pip install -r tests/requirements.txt
# Backend deps must also be present:
pip install -r backend/requirements.txt
```

---

## 2  Run unit tests

```bash
# From project root
pytest tests/unit/ -v
```

Run with coverage report:

```bash
pytest tests/unit/ -v --cov=backend --cov-report=term-missing
```

Expected output: all tests green, ~50+ assertions across 4 files.

---

## 3  Run golden-query evals

### Guard-layer only (no API key needed, instant)

Tests regex-based injection detection and schema-introspection detection.

```bash
python tests/evals/run_evals.py
```

### Full eval including LLM scope classification (needs GOOGLE_API_KEY)

Calls the real Gemini planner and checks `query_scope` against expected values.

```bash
GOOGLE_API_KEY=your_key python tests/evals/run_evals.py --llm
```

On Windows:

```powershell
$env:GOOGLE_API_KEY="your_key"
python tests/evals/run_evals.py --llm
```

Expected output: a table of pass/fail per query + an overall accuracy score.

---

## What each file tests

| File | What it covers |
|------|---------------|
| `test_sql_allowlist.py` | Table allowlist enforcement, forbidden catalog blocking (information_schema, pg_catalog), unknown column detection, alias resolution, regex fallback |
| `test_time_window_guard.py` | Last-month/quarter/year window math, relative-date phrase inference, out-of-range detection vs metadata, suggested-question filtering |
| `test_planner_guards.py` | Prompt-injection regex patterns, schema-introspection detection, execution-step normalisation, UI text clipping |
| `test_validator.py` | Empty-result handling, row schema consistency check, LLM relevance check (mocked) |
| `run_evals.py` | 25-query golden set: guard accuracy + (optionally) LLM scope classification accuracy |
