# DataPilot

**DataPilot** is a web app for asking natural-language questions about data in your warehouse. It provides a focused chat UI, a multi-agent backend (plan → discover schema → generate SQL → execute → validate → chart), and optional Supabase auth so conversations persist.

## Features

- **Chat-first analytics** – Ask questions in plain English; see an analysis plan, step-by-step agent progress, and results with charts, tables, and SQL when available.
- **Scope guardrails** – Off-topic questions get a clear “outside your data” response; vague questions ask for clarification (`query_scope` in the planner).
- **Conversation history** – Signed-in users get titled threads in Supabase; the backend chat API **requires** **`SUPABASE_SERVICE_ROLE_KEY`**. Sessions stay signed in across reloads via refresh token (`POST /auth/refresh`).
- **Data sources** – Primary warehouse is **environment-driven** (BigQuery or PostgreSQL). The **Data Sources** page calls `GET /data-sources/status` for live configuration/health—not mock data.
- **Human-in-the-loop (optional)** – By default, the graph pauses for table approval and query execution approval. Set **`DATAPILOT_SKIP_INTERRUPTS=true`** in `.env` for a one-shot demo (skips both interrupts).

## Architecture

| Layer | Stack |
|--------|--------|
| Frontend | Next.js (App Router), Tailwind, shadcn/ui |
| Backend | FastAPI |
| Agents | LangGraph: planner → discovery → optimizer → executor → validator → visualization |
| LLM | Google Gemini (`GOOGLE_API_KEY`, optional `GEMINI_MODEL`) |
| Warehouse | BigQuery and/or PostgreSQL via `db/factory.py` |
| Auth & chat DB | Supabase (JWT from frontend; service role on server for chat writes) |

## Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.11–3.12 (recommended). Avoid relying on a bleeding-edge **3.14+** install as your default `python` on Windows unless you have installed all dependencies there.
- **Google AI API key** for Gemini
- **Supabase** project (for login and chat persistence)
- **BigQuery** (optional) or **PostgreSQL** (optional) for running queries

## Environment variables

Create a `.env` file in the **project root** (same folder as `backend/` and `frontend/`).

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOOGLE_API_KEY` | Yes (agents) | Gemini |
| `GEMINI_MODEL` | No | e.g. `gemini-2.5-flash` |
| `SUPABASE_URL` | Yes (auth/chat) | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes (auth) | Used by backend auth endpoints |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required for chat** | Backend chat module uses **only** this key; listing/saving conversations will not work without it |
| `BIGQUERY_PROJECT_ID` | If using BQ | GCP project |
| `BIGQUERY_DATASET` | No | Default `retail_data` |
| `GOOGLE_APPLICATION_CREDENTIALS` | If using BQ | Path to service account JSON (or use ADC) |
| `DATABASE_TYPE` | If using Postgres | `postgres` |
| `POSTGRES_URL` or `DATABASE_URL` | If Postgres | Connection string |
| `FRONTEND_URL` | No | Password reset redirect (default `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | No | Frontend → API (default `http://localhost:8000`) |
| `CORS_ALLOW_ORIGINS` | No | Comma-separated list; if unset, defaults include `localhost`/`127.0.0.1` on 3000–3001 |
| `CORS_ALLOW_ORIGIN_REGEX` | No | Unset = allow `http(s)://localhost` and `127.0.0.1` on **any port** (fixes Next on 3001). Set to empty to disable regex in production |
| `DATAPILOT_SKIP_INTERRUPTS` | No | `true` / `1` to skip approval interrupts |

## Database & Supabase

**Required before chat history works:** create the tables in **your** Supabase project.

1. Open [Supabase](https://supabase.com) → your project → **SQL Editor** → New query.
2. Copy the **entire** file [`backend/supabase_migrations/migrations/001_conversations.sql`](backend/supabase_migrations/migrations/001_conversations.sql) into the editor and click **Run**.
3. You should see `conversations` and `messages` under **Table Editor**. If you skip this step, the API returns error **PGRST205** (“table not in schema cache”) and the sidebar shows a chat sync error.

See [`backend/supabase_migrations/README.md`](backend/supabase_migrations/README.md) for keys, RLS, and optional migrations.

## How to run locally

**Backend**

Use the **same** Python interpreter for `pip` and `uvicorn` (on Windows, `python` may point to 3.14 while `pip` installed packages for 3.12, which causes `No module named 'supabase'`).

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

**Windows (multiple Python versions):** if `python` is 3.14 but packages are on 3.12, pin the launcher:

```powershell
cd backend
py -3.12 -m pip install -r requirements.txt
py -3.12 -m uvicorn main:app --reload
```

- API: http://localhost:8000  
- OpenAPI: http://localhost:8000/docs  

**Troubleshooting:** `Auth error: No module named 'supabase'` means the interpreter running FastAPI does not have `requirements.txt` installed. Run `python -m pip install -r requirements.txt` with that exact interpreter (see `python --version` vs `where python`).

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

- App: http://localhost:3000  

Ensure `NEXT_PUBLIC_API_URL` matches your API origin if not using defaults.

**Login shows “Failed to fetch” and the API logs `OPTIONS /auth/login` 400:** the browser’s `Origin` (e.g. `http://localhost:3001` or `http://127.0.0.1:3000`) did not match CORS. This project allows loopback on any port by default via `allow_origin_regex`; restart the API after pulling changes. If you deploy behind a real domain, set `CORS_ALLOW_ORIGINS` (and optionally `CORS_ALLOW_ORIGIN_REGEX=` empty).

**Port 3000 already in use:** another process (often a previous `npm run dev`) is bound to 3000. Either stop it (Task Manager / close the old terminal) or run on another port — the updated CORS rules allow `localhost` and `127.0.0.1` on any port:

```bash
cd frontend
npx next dev -p 3001
```

## Main API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ask/stream` | SSE: agent progress, then `complete` or `interrupt` |
| POST | `/ask/continue` | Resume after interrupt (`thread_id`, `conversation_id`, `approved`, optional `original_query`) |
| POST | `/ask` | Blocking full run |
| GET | `/data-sources/status` | Primary warehouse config + health (for UI) |
| GET | `/conversations` | List threads (auth) |
| POST | `/conversations` | Create thread (auth) |
| GET | `/conversations/{id}/messages` | Messages (auth) |
| POST | `/auth/login`, `/auth/signup` | Supabase auth |

## BigQuery sample data (optional)

Scripts under [`backend/bigquery/scripts/`](backend/bigquery/scripts/) can create and load POC tables (`DDL/` and `DML/`). See [`backend/bigquery/scripts/README_DATA_MODEL.md`](backend/bigquery/scripts/README_DATA_MODEL.md) for the model and example questions.

## Limitations

- **Sources UI** does not yet add arbitrary connectors; configuration is via `.env`.
- **Chat history** requires sign-in and a working Supabase + service role setup.
- **Interrupts** pause the stream until the user continues; use `DATAPILOT_SKIP_INTERRUPTS` for smoother demos.

## Repository layout

- `backend/` – FastAPI app, `agents/`, `db/`, `chat.py`, `auth.py`, `schema/`
- `frontend/` – Next.js app, chat UI, auth pages
- `backend/supabase_migrations/` – SQL migrations

For contributors and AI assistants, see **[AGENTS.md](AGENTS.md)**.

## License

Add your license here if applicable.
