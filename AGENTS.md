# AGENTS.md – guidance for coding agents

This file orients automated assistants and human contributors working on **DataPilot**.

## Product summary

DataPilot is a chat UI over a **single configured warehouse** (BigQuery or PostgreSQL, chosen via environment variables). Users sign in with Supabase; questions run through a **LangGraph** pipeline that plans, checks schema fit, generates SQL, asks for approval once (before execute, with optional BigQuery cost estimate), executes, validates, and produces chart specs + explanations.

**Non-goals today:** Multi-tenant arbitrary “connect any URL” sources, full OAuth connector marketplace, or running without a configured warehouse.

## Layout

| Path | Role |
|------|------|
| `backend/main.py` | FastAPI routes: `/ask`, `/ask/stream`, `/ask/continue`, auth, conversations, `/data-sources/status` |
| `backend/agents/` | LangGraph nodes: `graph.py`, `planner.py`, `discovery.py`, `optimizer.py`, `executor.py`, `validator.py`, `visualization.py` |
| `backend/agents/state.py` | `DataPilotState`, Pydantic models (`AnalysisPlan`, …) |
| `backend/db/factory.py` | Picks BigQuery vs Postgres connector |
| `backend/supabase_service.py` | Supabase **auth** (anon key) + **chat** persistence (service role), retries on transient I/O |
| `backend/core/retry.py` | Shared exponential backoff for Supabase + Gemini invokes |
| `backend/core/logging_config.py` | `setup_logging()` — `LOG_LEVEL` env (default INFO) |
| `frontend/src/lib/httpClient.ts` | `API_BASE`, `fetchWithRetry` (backoff for DataPilot API calls) |
| `frontend/src/components/DataPilotClient.tsx` | SSE client, interrupts, message list |
| `frontend/src/contexts/ChatContext.tsx` | Conversations + messages |
| `frontend/src/app/(app)/sources/page.tsx` | Reads `GET /data-sources/status` |

## Critical flows

1. **Streaming ask** – `POST /ask/stream` sends `{ query, conversation_id? }` with optional `Authorization`. First `interrupt` may include `conversation_id` after the user turn is persisted. Client must send `conversation_id` and `original_query` on `POST /ask/continue` so completion can append only the assistant message.
2. **Checkpointer** – Compiled graph uses `MemorySaver` + `thread_id`. Each new question should use a fresh `thread_id` unless resuming the same interrupt.
3. **Persistence** – `_save_ask_messages` / `_save_user_turn_only` in `main.py`. Failures are caught and return `None`; do not swallow new exceptions without logging if you are debugging chat saves.
4. **Chat Supabase client** – `supabase_service` chat helpers use **only** `SUPABASE_SERVICE_ROLE_KEY` (no anon fallback). **`POST /auth/refresh`** plus `datapilot_refresh_token` in the browser keep sessions alive after access JWT expiry.

## Conventions

- Match existing style; avoid drive-by refactors unrelated to the task.
- Keep secrets in `.env`; never commit keys.
- Prefer env flags for behavior toggles (e.g. `DATAPILOT_SKIP_INTERRUPTS`).

## Pitfalls

- **Empty `query` on `/ask/continue`** – Always pass `original_query` from the UI for the user bubble tied to that assistant turn.
- **ExecutionPlanPanel** – Checklist UX is driven by `plan.execution_steps`, trace order, `isLoading`, and `execute_query` interrupts; changing trace shape affects step states.
- **Planner structured output** – `AnalysisPlan` includes `query_scope` and `execution_steps` (six phases: planner → visualization); `PlanCard` is only for clarifying / out-of-scope messages.
- **Supabase insert** – `create_conversation` / `create_message` use `.select(...)` after insert so rows are returned reliably.

When in doubt, read `main.py` around `_ask_stream_generator` and `DataPilotClient.tsx` SSE handlers first.
