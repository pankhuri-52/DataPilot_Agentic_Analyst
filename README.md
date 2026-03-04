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

---

## Next steps (POC roadmap)

We’ll follow this order and update the progress section below as we go.

| # | Step | Status |
|---|------|--------|
| 1 | **Environment setup** – Create `.env` from `.env.example`, add `GOOGLE_API_KEY`, verify Node + Python | ✅ Done |
| 2 | **Project structure** – Create `backend/` (FastAPI), `frontend/` (Next.js), `docs/` if needed | ✅ Done |
| 3 | **Backend skeleton** – FastAPI app, health check, CORS for frontend | ✅ Done |
| 4 | **Gemini integration** – Call Gemini API from backend (e.g. one test endpoint) | ✅ Done |
| 5 | **Agent orchestration** – Introduce LangGraph (or minimal agent flow): Planner → Data Discovery → Execution/Validation | ⬜ Pending |
| 6 | **BigQuery (optional for POC)** – DDL + INSERT scripts ready; create dataset/tables and load data in BigQuery console | ✅ Done |
| 7 | **Frontend skeleton** – Next.js + Tailwind, one page with a text input for “ask a question” | ⬜ Pending |
| 8 | **Connect UI to backend** – Submit question, show agent response and simple trace | ⬜ Pending |
| 9 | **Agent trace UI** – Show step-by-step reasoning and decisions | ⬜ Pending |
| 10 | **Polish** – Basic charts, cost estimate display, guardrails messaging | ⬜ Pending |

---

## What to do next

**Next step: 5 or 7.** Step 4 done: `POST /llm/chat` calls Gemini. Next: step 5 (agent orchestration with LangGraph) or step 7 (frontend "ask a question" input), then step 8 (connect UI to backend).

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
- **Step 6 (BigQuery POC)** – DDL and INSERT scripts in `backend/bigquery/scripts/`: use `01_ddl.sql` and `02_inserts.sql` in the BigQuery console (replace `YOUR_PROJECT_ID` and `YOUR_DATASET_ID`). See `backend/bigquery/scripts/README_DATA_MODEL.md` for data model and example queries. Use `GET /bigquery/tables` to verify.

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

## Quick reference (from spec)

- **Frontend:** Next.js (React) + Tailwind CSS  
- **Backend:** Python FastAPI  
- **Orchestration:** LangGraph (multi-agent state machine)  
- **LLM:** Gemini (via your Google API key; default model: `gemini-2.5-flash`)  
- **Data:** BigQuery metadata + query APIs (optional for initial POC)  
- **Deploy (later):** Frontend on Vercel, backend on Railway / Render  

---

*Last updated: step 4 done – Gemini integration (`llm.py`, `POST /llm/chat` with `gemini-2.5-flash`); BigQuery scripts in `backend/bigquery/scripts/`; next: step 5 or 7.*
