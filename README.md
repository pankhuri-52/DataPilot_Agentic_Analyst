# DataPilot – POC Progress

**Tagline:** An autonomous, multi-agent analytics system that turns business questions into validated insights.

This doc tracks setup and progress for the DataPilot hackathon POC.

---

## 🔐 API key and environment

**Do not commit your Google API key.** Use environment variables only.

1. Create a `.env` file in the project root (see `.env.example`).
2. Add your key there, e.g. `GOOGLE_API_KEY=your_key_here`.
3. Optionally set `GEMINI_MODEL=gemini-2.5-flash` (default) or another model like `gemini-2.5-flash-lite`.
4. Ensure `.env` is in `.gitignore` so it is never committed.

Your Google API key will be used for **Gemini** (LLM for agents) and optionally **BigQuery** (if you use BigQuery for the POC).

For **auth and chat persistence**, add Supabase credentials to `.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```
Run the migration in `backend/supabase_migrations/migrations/001_conversations.sql` in the Supabase SQL Editor. See `backend/supabase_migrations/README.md` for details.

---

## Next steps (POC roadmap)

We’ll follow this order and update the progress section below as we go.

| # | Step | Status |
|---|------|--------|
| 1 | **Environment setup** – Create `.env` from `.env.example`, add `GOOGLE_API_KEY`, verify Node + Python | ✅ Done |
| 2 | **Project structure** – Create `backend/` (FastAPI), `frontend/` (Next.js), `docs/` if needed | ✅ Done |
| 3 | **Backend skeleton** – FastAPI app, health check, CORS for frontend | ✅ Done |
| 4 | **Gemini integration** – Call Gemini API from backend (e.g. one test endpoint) | ✅ Done |
| 5 | **Agent orchestration** – Introduce LangGraph (or minimal agent flow): Planner → Data Discovery → Execution/Validation | ✅ Done |
| 6 | **BigQuery (optional for POC)** – DDL + INSERT scripts ready; create dataset/tables and load data in BigQuery console | ✅ Done |
| 7 | **Frontend skeleton** – Next.js + Tailwind + shadcn/ui, one page with a text input for “ask a question” | ✅ Done |
| 8 | **Connect UI to backend** – Submit question, show agent response and simple trace | ✅ Done |
| 9 | **Agent trace UI** – Show step-by-step reasoning and decisions | ✅ Done |
| 10 | **Polish** – Basic charts, cost estimate display, guardrails messaging | ⬜ Pending |
| 11 | **Real-time agent logs** – SSE streaming of agent progress (planner → discovery → executor → validator → visualization) | ✅ Done |
| 12 | **Signin/Signup** – Auth flow via Supabase (login, signup, JWT validation); chat persistence for authenticated users | ✅ Done |
| 13 | **Conversational chain** – When LLM asks a clarifying question (e.g. data range) and user says "Sure"/"Yes"/"Okay", system uses chat history to understand context and proceed with amended plan | ✅ Done |

---

## What to do next

**Next step: 10.** Polish – charts, cost estimate, guardrails messaging. Signin/Signup, chat persistence, and conversational chain are done.

---

## Progress log (what we’ve done so far)

- **Project identified** – DataPilot spec (Word doc) reviewed; POC scope defined.
- **Tools** – Node.js and Python installed (as per your setup).
- **API key** – Google API key obtained; to be used via `.env` only (see above).
- **README and roadmap** – This README and the next steps above created; progress will be updated here as we complete each step.
- **Step 1 done** – `.env` created and configured; environment ready.
- **Step 2 done** – `backend/` (FastAPI + health check + CORS) and `frontend/` (Next.js + Tailwind, App Router, `src/`) created with base files.
- **Step 3 done** – Backend skeleton in place (`main.py` with `/health`, CORS for frontend).
- **Step 4 done** – Gemini integration via `backend/llm.py`; `POST /llm/chat` calls Gemini (default model: `gemini-2.5-flash`). Verified working.
- **Step 5 done** – LangGraph agent orchestration in `backend/agents/`: Planner → Discovery → Executor → Validator → Visualization. `POST /ask` runs the full pipeline and returns plan, feasibility, results, chart_spec, explanation, and trace.
- **Step 6 (BigQuery POC)** – DDL and INSERT scripts in `backend/bigquery/scripts/`: use `01_ddl.sql` and `02_inserts.sql` in the BigQuery console (replace `YOUR_PROJECT_ID` and `YOUR_DATASET_ID`). See `backend/bigquery/scripts/README_DATA_MODEL.md` for data model and example queries. Use `GET /bigquery/tables` to verify.
- **Steps 7–9 done** – Frontend with shadcn/ui (Input, Button, Card, Accordion, Table, Alert, Badge, Skeleton). Connected to `POST /ask`; displays results, explanation, agent trace, and feasibility badges.
- **Step 11 done** – Real-time agent progress: stream intermediate agent states (planner → discovery → executor → validator → visualization) to the UI via `POST /ask/stream`. Uses Server-Sent Events (SSE) over HTTP; users see live logs as each agent runs.
- **Step 12 done** – Signin/Signup: Supabase Auth integration. Backend endpoints `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`. Frontend login (`/login`), signup (`/signup`), forgot-password, reset-password pages. AuthContext for session management. Chat history persisted in Supabase for authenticated users.
- **Step 13 done** – Conversational chain: When the planner asks a clarifying question (e.g. "Data for last month isn't available. We have data from 2024-01-01 to 2024-02-15. Would you like to get total sales by region for this period instead?") and the user replies "Sure", "Yes", or "Okay", the planner uses conversation history to understand context and produces a valid plan with the available date range. History is fetched from Supabase when `conversation_id` is provided.

---

## Chat history persistence (Supabase)

Chat history is persisted in Supabase for authenticated users. The schema supports full conversational context.

### Schema

- **`conversations`** – One row per chat. Columns: `id`, `user_id` (references `auth.users`), `title`, `created_at`, `updated_at`.
- **`messages`** – One row per message. Columns: `id`, `conversation_id`, `role` (`user` | `assistant`), `content`, `metadata` (JSONB), `created_at`.

### Message metadata (assistant messages)

The `metadata` JSONB column stores agent response details for conversational context:

| Key | Description |
|-----|-------------|
| `plan` | Analysis plan (metrics, dimensions, filters, `clarifying_questions`) |
| `clarifying_questions` | When assistant asked a follow-up (e.g. data range offer) |
| `data_feasibility` | full \| partial \| none |
| `results` | Query results (if any) |
| `chart_spec` | Chart configuration |
| `sql` | Generated SQL |

When the user replies (e.g. "Sure") to a clarifying question, the backend fetches recent messages, passes them as `conversation_history` to the planner, and the planner resolves the effective query from context.

### Migrations

1. Run `001_conversations.sql` – creates tables, indexes, RLS policies.
2. Run `002_chat_schema_docs.sql` – adds schema comments (optional).

See `backend/supabase_migrations/README.md` for setup.

---

## How to run (local)

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```
API: http://localhost:8000 — Docs: http://localhost:8000/docs

**Test the first API endpoint (step 4 – Gemini)**  
With the backend running and `GOOGLE_API_KEY` in `.env`:
- **Swagger UI:** Open http://localhost:8000/docs → find `POST /llm/chat` → "Try it out" → send `{"message": "Hello!"}` → Execute.
- **curl:** `curl -X POST http://localhost:8000/llm/chat -H "Content-Type: application/json" -d "{\"message\": \"Hello!\"}"`
- **PowerShell:** `Invoke-RestMethod -Uri "http://localhost:8000/llm/chat" -Method Post -Body '{"message":"Hello!"}' -ContentType "application/json"`

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
App: http://localhost:3000

---

## BigQuery POC – tables and sample data

To get **good insights** from the agent later, set up BigQuery and load sample data:

### 1. Connection (choose one)

- **Option A – Service account (recommended)**  
  Create a GCP service account with BigQuery roles, download JSON key, then in `.env`:
  ```env
  BIGQUERY_PROJECT_ID=your-gcp-project-id
  BIGQUERY_DATASET=datapilot_poc
  GOOGLE_APPLICATION_CREDENTIALS=path/to/your-service-account.json
  ```
- **Option B – Application Default Credentials**  
  If you use `gcloud`, run:
  ```bash
  gcloud auth application-default login
  ```
  Then in `.env` set only:
  ```env
  BIGQUERY_PROJECT_ID=your-gcp-project-id
  BIGQUERY_DATASET=datapilot_poc
  ```

### 2. Create dataset, tables, and load sample data (manual in BigQuery)

1. In the [BigQuery console](https://console.cloud.google.com/bigquery), create a dataset (e.g. `customer_data`) in your project.
2. Open `backend/bigquery/scripts/01_ddl.sql`, replace `YOUR_PROJECT_ID` and `YOUR_DATASET_ID` with your project and dataset, then run the full script to create tables.
3. Open `backend/bigquery/scripts/02_inserts.sql`, make the same replacement, then run the INSERTs in order: **products** → **customers** → **orders** → **order_items** → **sales_daily** (the last is an `INSERT...SELECT` from the others).

This gives you: **products**, **customers**, **orders**, **order_items**, **sales_daily** with sample rows. For the data model, relationships, and example business questions, see `backend/bigquery/scripts/README_DATA_MODEL.md`.

### 3. Verify

- In [BigQuery console](https://console.cloud.google.com/bigquery): open your project → dataset → tables.
- Or call the API: `GET http://localhost:8000/bigquery/tables` (with backend running and `.env` set). It returns the list of tables in your POC dataset.

### Tables (for insights)

| Table         | Purpose |
|---------------|--------|
| `products`    | Product id, name, category, unit price |
| `customers`   | Customer id, name, region, segment |
| `orders`      | Order id, customer, date, status, total amount |
| `order_items` | Line items: order, product, quantity, price |
| `sales_daily` | Pre-aggregated daily sales by product and region |

Example questions you can answer later with the agent: *“What were total sales by region last month?”*, *“Top 5 products by revenue?”*, *“Orders by customer segment?”*.

---

## Key API endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /ask` | Submit a question; returns full response when pipeline completes (blocking). |
| `POST /ask/stream` | Submit a question; streams real-time agent progress via SSE, then returns full response in final event. Use for live logs in the UI. |
| `POST /auth/signup` | Create a new user (email/password). Returns user and access_token. |
| `POST /auth/login` | Sign in with email/password. Returns user and access_token. |
| `GET /auth/me` | Return current user if valid JWT in Authorization header. |
| `GET /conversations` | List chat conversations for authenticated user. |
| `POST /conversations` | Create a new conversation. |
| `GET /conversations/:id/messages` | List messages in a conversation. |
| `POST /llm/chat` | Basic Gemini test: send a message, get a reply. |
| `GET /bigquery/tables` | List BigQuery POC tables (requires BigQuery config in `.env`). |

---

## Quick reference (from spec)

- **Frontend:** Next.js (React) + Tailwind CSS + shadcn/ui  
- **Backend:** Python FastAPI  
- **Orchestration:** LangGraph (multi-agent state machine)  
- **LLM:** Gemini (via your Google API key; default model: `gemini-2.5-flash`)  
- **Data:** BigQuery metadata + query APIs (optional for initial POC)  
- **Deploy (later):** Frontend on Vercel, backend on Railway / Render  

---

*Last updated: step 13 done – Conversational chain with chat history; next: step 10 (polish).*
