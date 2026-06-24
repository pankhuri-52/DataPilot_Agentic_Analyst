<div align="center">

# 🧭 DataPilot

### Talk to your data warehouse like a coworker. Get back SQL, charts, and answers.

*Ask "What were our top 10 products by revenue last month?" — DataPilot plans the analysis, writes the SQL, asks before it runs anything, and hands you a chart. No SQL required.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

Most "chat with your data" tools are a black box: you type a question, you get a number, and you just… trust it. DataPilot does the opposite. It shows its work — the plan it made, the SQL it wrote, and a checkpoint where **you** approve the query before it touches your warehouse. Under the hood it's a little team of LLM agents passing the question down a line:

> **plan → find the right tables → write SQL → (you approve) → run it → sanity-check → chart it**

The result: answers you can actually defend, not just paste into a deck.

## 🎬 See it in action

![DataPilot demo](docs/Video-Project.gif)

> _One question in → watch the plan form, read the SQL, hit approve, get your chart._

## 🧠 How it works

Each box is one agent with one job. The orchestrator routes the question; everything downstream is a focused step you can read, trace, and trust.

```mermaid
flowchart LR
    U([User question]) --> O{{Orchestrator<br/>LLM router}}
    O --> P[Planner<br/>metrics, dims, scope]
    P --> D[Discovery<br/>schema feasibility]
    D --> Opt[Optimizer<br/>SQL generation]
    Opt -->|human-in-the-loop<br/>approval gate| E[Executor<br/>run query]
    E --> V[Validator<br/>check results]
    V --> Viz[Visualization<br/>chart spec]
    Viz --> R([Answer + chart])
    O -.-> KB[(Query KB<br/>pgvector)]
```

Every hop is traced in **Langfuse**, fenced in by **scope** and **time-window** guardrails, and — unless you opt out — paused for a **human approval** before any SQL runs.

## ✨ What makes it nice to use

- **🗣️ Just ask** — plain-English questions in, an analysis plan + step-by-step agent progress + charts/tables/SQL out.
- **🚧 It knows its lane** — ask something off-topic and it says "that's outside your data" instead of hallucinating a query. Vague questions get a clarifying question back.
- **📅 It won't make up dates** — "last month" is checked against the actual date range in your tables before any SQL runs. Out of range? You get a clear "here's what I *do* have" instead of an empty chart.
- **💬 Your chats stick around** — signed-in users get titled, saved threads (via Supabase), and stay logged in across reloads.
- **🔌 Bring your own warehouse** — point it at **BigQuery** or **PostgreSQL** with one env var.
- **✋ You're in control** — the graph pauses for table + query approval by default. Want a fast, no-clicks demo? Flip `DATAPILOT_SKIP_INTERRUPTS=true`.

## 🧱 The stack

| Layer | What it's built on |
|--------|--------|
| Frontend | Next.js (App Router), Tailwind, shadcn/ui |
| Backend | FastAPI |
| Agents | LangGraph — planner → discovery → optimizer → executor → validator → visualization |
| LLM | OpenAI (`OPENAI_API_KEY`, optional `OPENAI_MODEL`) |
| Warehouse | BigQuery and/or PostgreSQL (`db/factory.py` picks one) |
| Auth & chat history | Supabase |

## ⚡ Get it running

DataPilot talks to a few services, so we've split the setup into two paths. **Do Tier 1 first** — you'll have the agents answering questions in about 5 minutes. Add the full app when you want logins and saved chats.

### Tier 1 — Just the agents (OpenAI + one warehouse)

No Supabase, no frontend, no login. The `/ask` endpoints work without auth.

```bash
# 1. Grab the code
git clone <your-repo-url> && cd <repo>

# 2. Set up your .env (in the project root) with the essentials:
cp .env.example .env
#   OPENAI_API_KEY=sk-...
#   DATABASE_TYPE=postgres
#   DATABASE_URL=postgresql://user:pass@host:5432/db   # any Postgres you can reach
#   DATAPILOT_SKIP_INTERRUPTS=true                     # skip the approval pauses for a quick spin

# 3. Boot the backend
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Now open **http://localhost:8000/docs**, expand `POST /ask`, and send:

```json
{ "query": "What were total sales by month?" }
```

Back comes the plan, the generated SQL, the results, and a chart spec. 🎉

> **On BigQuery instead of Postgres?** Set `BIGQUERY_PROJECT_ID` + credentials and load the
> sample retail dataset from [`backend/bigquery/scripts/`](backend/bigquery/scripts/).

### Tier 2 — The full app (login + saved chats + the UI)

1. Spin up a **Supabase** project and add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to `.env`.
2. Run the migration in the Supabase SQL Editor — see [Set up the database](#-set-up-the-database) below.
3. Start everything:

   ```bash
   # One command from the project root — runs the frontend AND backend together:
   npm install && npm run dev
   ```

   Prefer two terminals? Run the backend as in Tier 1, then `cd frontend && npm install && npm run dev`.

4. Open **http://localhost:3000**, sign up, and start chatting.

Need the full knob list? It's in [Configuration](#-configuration). Hit a snag? See [Running locally & troubleshooting](#-running-locally--troubleshooting).

## 📋 Before you start

- **Node.js** 18+ and **npm**
- **Python** 3.11–3.12 (on Windows, don't let a bleeding-edge 3.14 be your default `python` unless you've installed deps there)
- An **OpenAI API key**
- A **Supabase** project — only if you want login + chat history
- **BigQuery** or **PostgreSQL** — to actually run queries

## ⚙️ Configuration

Create a `.env` in the **project root** (next to `backend/` and `frontend/`). These are the ones you'll actually touch to get going:

| Variable | Required? | What it's for |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes (agents) | Your OpenAI key |
| `SUPABASE_URL` | Yes (auth/chat) | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes (auth) | Backend auth endpoints |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes, for chat** | Chat saves/lists use **only** this key — no fallback |
| `DATABASE_TYPE` | If using Postgres | Set to `postgres` |
| `POSTGRES_URL` / `DATABASE_URL` | If Postgres | Connection string |
| `BIGQUERY_PROJECT_ID` | If using BigQuery | GCP project |
| `GOOGLE_APPLICATION_CREDENTIALS` | If using BigQuery | Path to service-account JSON (or use ADC) |
| `DATAPILOT_SKIP_INTERRUPTS` | No | `true` to skip approval pauses (great for demos) |

<details>
<summary><b>The full list</b> — models, BigQuery-on-serverless, CORS, suggested-question toggles, Query KB tuning</summary>

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_MODEL` | No | e.g. `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | No | Default `text-embedding-3-small` |
| `OPENAI_EMBEDDING_DIMENSION` | No | Default `768` (must match your pgvector dimension) |
| `DATAPILOT_CREDENTIALS_KEY` | If saving sources | Fernet key encrypting saved data-source credentials |
| `BIGQUERY_DATASET` | No | Default `retail_data` |
| `GCP_SERVICE_ACCOUNT_JSON` | BQ on serverless | Full service-account JSON as one minified string. If the host mangles quotes, use the B64 form below |
| `GCP_SERVICE_ACCOUNT_JSON_B64` | BQ on serverless | Base64 (UTF-8) of the entire `*.json` — most reliable in the Vercel UI |
| `FRONTEND_URL` | No | Password-reset redirect (default `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | No | Frontend → API (default `http://localhost:8000`) |
| `CORS_ALLOW_ORIGINS` | No | Comma-separated allowlist; defaults cover `localhost`/`127.0.0.1` on 3000–3001 |
| `CORS_ALLOW_ORIGIN_REGEX` | No | Unset = allow loopback on **any** port (fixes Next on 3001). Set empty to disable in prod |
| `SUGGESTED_QUESTIONS_ENABLED` | No | `0` turns off homepage/new-chat suggestions |
| `SUGGESTED_QUESTIONS_LLM` | No | `0` skips model calls for suggestions (schema-seeded fallback only) |
| `SUGGESTED_QUESTIONS_INCLUDE_KB` | No | `0` skips Query KB retrieval when composing suggestions |
| `SUGGESTED_QUESTIONS_CACHE_TTL_SEC` | No | In-process cache TTL for suggestions (`0` disables it) |
| `QUERY_KB_MIN_SIMILARITY` | No | pgvector match threshold (default `0.78`) |
| `QUERY_KB_RELAXED_MIN_SIMILARITY` | No | Second-pass threshold (default `0.68`; `none` to disable) |
| `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_HOST` | No | Tracing via Langfuse |
| `LOG_LEVEL` | No | Default `INFO` |

</details>

## 🗄️ Set up the database

**Do this before chat history will work** — the tables live in *your* Supabase project, not ours.

1. Open [Supabase](https://supabase.com) → your project → **SQL Editor** → New query.
2. Paste in the **entire** [`001_conversations.sql`](backend/supabase_migrations/migrations/001_conversations.sql) and click **Run**.
3. You should now see `conversations` and `messages` under **Table Editor**.

Skip this and the API will hand back error **PGRST205** ("table not in schema cache") and the sidebar will show a chat-sync error — that's your sign the migration didn't run. For keys, RLS, and the optional migrations, see [`backend/supabase_migrations/README.md`](backend/supabase_migrations/README.md).

## 🏃 Running locally & troubleshooting

**The short version:**

```bash
# Backend
cd backend && python -m pip install -r requirements.txt && python -m uvicorn main:app --reload
# Frontend (second terminal)
cd frontend && npm install && npm run dev
```

- API → http://localhost:8000  ·  Docs → http://localhost:8000/docs  ·  App → http://localhost:3000

<details>
<summary><b>Things that bite people</b> (Windows Python versions, "Failed to fetch", port 3000, OneDrive)</summary>

**Use the *same* Python for `pip` and `uvicorn`.** On Windows, `python` might be 3.14 while your packages landed on 3.12 — that's the classic `No module named 'supabase'`. Pin the launcher:

```powershell
cd backend
py -3.12 -m pip install -r requirements.txt
py -3.12 -m uvicorn main:app --reload
```

If `Auth error: No module named 'supabase'` shows up, the interpreter running FastAPI just doesn't have `requirements.txt` installed. Compare `python --version` with `where python` and install against that exact interpreter.

**Login says "Failed to fetch" and the API logs `OPTIONS /auth/login` 400** → a CORS mismatch: your browser's `Origin` (e.g. `http://localhost:3001` or `http://127.0.0.1:3000`) didn't match. This project allows loopback on any port by default — just restart the API after pulling. Deploying to a real domain? Set `CORS_ALLOW_ORIGINS` (and optionally `CORS_ALLOW_ORIGIN_REGEX=` empty).

**Port 3000 already in use** → an old `npm run dev` is probably still bound. Stop it, or run elsewhere:

```bash
cd frontend && npx next dev -p 3001
```

**Windows + OneDrive + `frontend/.next`** → if `next dev` throws `EBUSY: resource busy or locked` and the browser shows Internal Server Error, OneDrive is fighting the dev server over build files. Stop all Node processes, delete `frontend/.next`, and restart. Longer term: pause OneDrive while developing, or clone the repo *outside* OneDrive (e.g. `C:\dev\...`).

Make sure `NEXT_PUBLIC_API_URL` matches your API origin if you've moved off the defaults.

</details>

## 🔌 The API at a glance

| Method | Path | What it does |
|--------|------|-------------|
| POST | `/ask/stream` | SSE — live agent progress, then `complete` or `interrupt` |
| POST | `/ask/continue` | Resume after an interrupt (`thread_id`, `conversation_id`, `approved`, optional `original_query`) |
| POST | `/ask` | One-shot blocking run |
| GET | `/data-sources/status` | Warehouse config + health (powers the Sources page) |
| GET | `/conversations` | List your threads (auth) |
| POST | `/conversations` | Start a thread (auth) |
| GET | `/conversations/{id}/messages` | Messages in a thread (auth) |
| POST | `/auth/login`, `/auth/signup` | Supabase auth |

## 📊 Sample data (optional)

Want a realistic retail dataset to poke at? The scripts under [`backend/bigquery/scripts/`](backend/bigquery/scripts/) create and load POC tables (`DDL/` then `DML/`). The data model, run order, and example business questions are in [`README_DATA_MODEL.md`](backend/bigquery/scripts/README_DATA_MODEL.md).

A note on dates: the planner and discovery agents validate time windows against the `data_range` values in [`backend/schema/metadata.json`](backend/schema/metadata.json). **After you reseed or swap warehouse data, update those min/max dates** — otherwise the date guardrails and suggestions will be working off stale info.

## 🚪 Known limits (honesty corner)

- The **Sources UI** doesn't add arbitrary connectors yet — configuration is via `.env`.
- **Chat history** needs sign-in + a working Supabase service role.
- **Interrupts** pause the stream until you continue — use `DATAPILOT_SKIP_INTERRUPTS` for smoother demos.

## 🗂️ Where things live

- `backend/` — FastAPI app, `agents/`, `db/`, `schema/`, Supabase migrations
- `frontend/` — Next.js app, chat UI, auth pages
- `docs/` — demo media + write-ups

Digging into the internals or pointing an AI assistant at the code? **[AGENTS.md](AGENTS.md)** is the map — agent pipeline, critical flows, and the gotchas that'll save you an afternoon.

## 🤝 Want to contribute?

Yes please. 🙌 Bug fix, new data connector, smarter agent, or just better docs — it all counts. Start with **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[AGENTS.md](AGENTS.md)**, and open an issue first for anything big so we can chat about it.

## 📄 License

[MIT](LICENSE) — use it, fork it, build on it. Bring your own keys (OpenAI, Supabase, your warehouse) and you're off.
