"""
DataPilot backend – FastAPI app.
Health check and CORS; Gemini test endpoint; agents in later steps.
"""
import json
import os
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Load .env from project root (parent of backend/) if present
from pathlib import Path
_backend_dir = Path(__file__).resolve().parent
_project_root = _backend_dir.parent
_env = _project_root / ".env"
if _env.exists():
    from dotenv import load_dotenv
    load_dotenv(_env)

app = FastAPI(
    title="DataPilot API",
    description="Autonomous multi-agent analytics – turn questions into validated insights.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Health check for deployment and frontend."""
    return {"status": "ok", "service": "datapilot-api"}


@app.get("/")
def root():
    """Root redirect to docs."""
    return {"message": "DataPilot API", "docs": "/docs"}


def _resolve_credentials_path():
    """Resolve GOOGLE_APPLICATION_CREDENTIALS to an absolute path (project root if relative)."""
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not path:
        return
    p = Path(path)
    if not p.is_absolute():
        p = _project_root / path
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(p.resolve())


@app.get("/bigquery/tables")
def bigquery_tables():
    """List BigQuery POC tables if BIGQUERY_PROJECT_ID and BIGQUERY_DATASET are set."""
    project_id = os.getenv("BIGQUERY_PROJECT_ID")
    dataset_id = os.getenv("BIGQUERY_DATASET", "retail_data")
    if not project_id or project_id == "your-gcp-project-id":
        raise HTTPException(
            status_code=503,
            detail="BigQuery not configured. Set BIGQUERY_PROJECT_ID and BIGQUERY_DATASET in .env",
        )
    _resolve_credentials_path()
    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=project_id)
        dataset_ref = f"{project_id}.{dataset_id}"
        tables = list(client.list_tables(dataset_ref))
        return {
            "project": project_id,
            "dataset": dataset_id,
            "tables": [t.table_id for t in tables],
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"BigQuery error: {str(e)}")


@app.get("/schema")
def get_schema():
    """Return static schema metadata for agents (tables, columns, types)."""
    schema_path = _backend_dir / "schema" / "metadata.json"
    if not schema_path.exists():
        raise HTTPException(status_code=503, detail="Schema metadata not found")
    import json
    with open(schema_path, encoding="utf-8") as f:
        return json.load(f)


@app.post("/ask")
def ask(body: dict = Body(default={"query": ""})):
    """
    Submit a natural language question. Runs the multi-agent pipeline and returns
    plan, data_feasibility, results, chart_spec, explanation, and trace.
    """
    query = (body or {}).get("query", "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    try:
        from agents.graph import get_graph
        graph = get_graph()
        initial_state = {"query": query, "trace": []}
        final_state = graph.invoke(initial_state)

        return {
            "plan": final_state.get("plan"),
            "data_feasibility": final_state.get("data_feasibility"),
            "nearest_plan": final_state.get("nearest_plan"),
            "missing_explanation": final_state.get("missing_explanation"),
            "sql": final_state.get("sql"),
            "results": final_state.get("raw_results"),
            "validation_ok": final_state.get("validation_ok"),
            "chart_spec": final_state.get("chart_spec"),
            "explanation": final_state.get("explanation"),
            "trace": final_state.get("trace", []),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Agent error: {str(e)}")


async def _ask_stream_generator(query: str):
    """Async generator that yields SSE events for real-time agent progress."""
    try:
        from agents.graph import get_graph

        graph = get_graph()
        initial_state = {"query": query, "trace": []}
        prev_trace_len = 0
        last_state = None

        async for chunk in graph.astream(initial_state, stream_mode="values"):
            last_state = chunk
            trace = chunk.get("trace") or []
            for i in range(prev_trace_len, len(trace)):
                entry = trace[i]
                event = {
                    "type": "progress",
                    "agent": entry.get("agent", ""),
                    "trace_entry": entry,
                }
                yield f"data: {json.dumps(event)}\n\n"
            prev_trace_len = len(trace)

        if last_state is not None:
            response = {
                "plan": last_state.get("plan"),
                "data_feasibility": last_state.get("data_feasibility"),
                "nearest_plan": last_state.get("nearest_plan"),
                "missing_explanation": last_state.get("missing_explanation"),
                "sql": last_state.get("sql"),
                "results": last_state.get("raw_results"),
                "validation_ok": last_state.get("validation_ok"),
                "chart_spec": last_state.get("chart_spec"),
                "explanation": last_state.get("explanation"),
                "trace": last_state.get("trace", []),
            }
            yield f"data: {json.dumps({'type': 'complete', 'response': response})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"


@app.post("/ask/stream")
async def ask_stream(body: dict = Body(default={"query": ""})):
    """
    Submit a natural language question. Streams real-time agent progress via SSE,
    then returns the full response in the final event.
    """
    query = (body or {}).get("query", "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    try:
        return StreamingResponse(
            _ask_stream_generator(query),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Agent error: {str(e)}")


# First API endpoint – Gemini test ----
@app.post("/llm/chat")
def llm_chat(body: dict = Body(default={"message": "Hello! What can you help me with?"})):
    """
    Basic Gemini test: send a message, get a reply.
    Flow: Frontend/Postman → POST /llm/chat → this function → llm.get_gemini() → Gemini API → response.
    """

    # If there is no message, use the default message
    message = (body or {}).get("message", "Hello! What can you help me with?")
    try:
        from llm import get_gemini
        model = get_gemini()
        response = model.invoke(message)
        content = response.content if hasattr(response, "content") else str(response)
        return {"reply": content}
        # print("Calling llm_chat api")
        # return {"reply": "Hello! What can you help me with?"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"LLM error: {str(e)}")
