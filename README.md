# DataPilot – POC Progress

**Tagline:** An autonomous, multi-agent analytics system that turns business questions into validated insights.

This doc tracks setup and progress for the DataPilot hackathon POC.

---

## 🔐 API key and environment

**Do not commit your Google API key.** Use environment variables only.

1. Create a `.env` file in the project root (see `.env.example`).
2. Add your key there, e.g. `GOOGLE_API_KEY=your_key_here`.
3. Ensure `.env` is in `.gitignore` so it is never committed.

Your Google API key will be used for **Gemini** (LLM for agents) and optionally **BigQuery** (if you use BigQuery for the POC).

---

## Next steps (POC roadmap)

We’ll follow this order and update the progress section below as we go.

| # | Step | Status |
|---|------|--------|
| 1 | **Environment setup** – Create `.env` from `.env.example`, add `GOOGLE_API_KEY`, verify Node + Python | ✅ Done |
| 2 | **Project structure** – Create `backend/` (FastAPI), `frontend/` (Next.js), `docs/` if needed | ✅ Done |
| 3 | **Backend skeleton** – FastAPI app, health check, CORS for frontend | ✅ Done |
| 4 | **Gemini integration** – Call Gemini API from backend (e.g. one test endpoint) | ⬜ Pending |
| 5 | **Agent orchestration** – Introduce LangGraph (or minimal agent flow): Planner → Data Discovery → Execution/Validation | ⬜ Pending |
| 6 | **BigQuery (optional for POC)** – Schema introspection and/or dry-run cost; or mock data for first demo | ⬜ Pending |
| 7 | **Frontend skeleton** – Next.js + Tailwind, one page with a text input for “ask a question” | ⬜ Pending |
| 8 | **Connect UI to backend** – Submit question, show agent response and simple trace | ⬜ Pending |
| 9 | **Agent trace UI** – Show step-by-step reasoning and decisions | ⬜ Pending |
| 10 | **Polish** – Basic charts, cost estimate display, guardrails messaging | ⬜ Pending |

---

## Progress log (what we’ve done so far)

- **Project identified** – DataPilot spec (Word doc) reviewed; POC scope defined.
- **Tools** – Node.js and Python installed (as per your setup).
- **API key** – Google API key obtained; to be used via `.env` only (see above).
- **README and roadmap** – This README and the next steps above created; progress will be updated here as we complete each step.
- **Step 1 done** – `.env` created and configured; environment ready.
- **Step 2 done** – `backend/` (FastAPI + health check + CORS) and `frontend/` (Next.js + Tailwind, App Router, `src/`) created with base files.
- **Step 3 done** – Backend skeleton in place (`main.py` with `/health`, CORS for frontend).

---

## How to run (local)

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```
API: http://localhost:8000 — Docs: http://localhost:8000/docs

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
App: http://localhost:3000

---

## Quick reference (from spec)

- **Frontend:** Next.js (React) + Tailwind CSS  
- **Backend:** Python FastAPI  
- **Orchestration:** LangGraph (multi-agent state machine)  
- **LLM:** Gemini (via your Google API key)  
- **Data:** BigQuery metadata + query APIs (optional for initial POC)  
- **Deploy (later):** Frontend on Vercel, backend on Railway / Render  

---

*Last updated: when we complete or change a step.*
