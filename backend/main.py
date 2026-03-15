"""
DataPilot backend – FastAPI app.
Health check and CORS; Gemini test endpoint; agents in later steps.
"""
import json
import os
from fastapi import FastAPI, HTTPException, Body, Depends, Header
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


# ---- Auth ----
def _get_bearer_token(authorization: str | None = Header(default=None)) -> str | None:
    """Extract Bearer token from Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[7:].strip()


def get_current_user_optional(authorization: str | None = Header(default=None)):
    """Return current user if valid JWT present, else None."""
    token = _get_bearer_token(authorization)
    if not token:
        return None
    from auth import get_user_from_token
    return get_user_from_token(token)


@app.post("/auth/signup")
def auth_signup(body: dict = Body(default={"email": "", "password": "", "name": ""})):
    """Create a new user. Returns user and access_token."""
    email = (body or {}).get("email", "").strip()
    password = (body or {}).get("password", "")
    name = (body or {}).get("name", "").strip() or None
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        from auth import sign_up
        return sign_up(email, password, name)
    except ValueError as e:
        if "must be set" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
            )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Auth error: {str(e)}")


@app.post("/auth/login")
def auth_login(body: dict = Body(default={"email": "", "password": ""})):
    """Sign in with email and password. Returns user and access_token."""
    email = (body or {}).get("email", "").strip()
    password = (body or {}).get("password", "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required")
    try:
        from auth import sign_in
        return sign_in(email, password)
    except ValueError as e:
        if "must be set" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
            )
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Auth error: {str(e)}")


@app.post("/auth/forgot-password")
def auth_forgot_password(body: dict = Body(default={"email": ""})):
    """Send a password reset email to the user. Always returns success to prevent email enumeration."""
    email = (body or {}).get("email", "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    try:
        from auth import reset_password_for_email
        redirect_to = os.getenv("FRONTEND_URL", "http://localhost:3000") + "/reset-password"
        reset_password_for_email(email, redirect_to)
        return {"message": "If an account exists with this email, you will receive a password reset link."}
    except ValueError as e:
        if "must be set" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
            )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Always return success to prevent email enumeration attacks
        return {"message": "If an account exists with this email, you will receive a password reset link."}


@app.get("/auth/me")
def auth_me(user=Depends(get_current_user_optional)):
    """Return current user if valid JWT. Returns null if not authenticated."""
    if user is None:
        return {"user": None}
    return {"user": user}


# ---- Chat (conversations + messages) ----
def _require_user(authorization: str | None = Header(default=None)):
    """Dependency that requires authenticated user."""
    user = get_current_user_optional(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


@app.get("/conversations")
def list_conversations(user=Depends(_require_user)):
    """List conversations for the current user."""
    try:
        from chat import list_conversations as _list
        return {"conversations": _list(user["id"])}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Chat error: {str(e)}")


@app.post("/conversations")
def create_conversation(
    body: dict = Body(default={"title": "New conversation"}),
    user=Depends(_require_user),
):
    """Create a new conversation."""
    title = (body or {}).get("title", "New conversation")
    try:
        from chat import create_conversation as _create
        conv = _create(user["id"], title)
        return conv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Chat error: {str(e)}")


@app.get("/conversations/{conversation_id}/messages")
def get_messages(conversation_id: str, user=Depends(_require_user)):
    """List messages in a conversation."""
    try:
        from chat import list_messages as _list
        return {"messages": _list(conversation_id, user["id"])}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Chat error: {str(e)}")


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


def _get_conversation_history(user_id: str, conversation_id: str | None) -> list[dict]:
    """Fetch recent messages from a conversation for conversational context. Returns list of {role, content, metadata}."""
    if not conversation_id or not user_id:
        return []
    try:
        from chat import list_messages
        msgs = list_messages(conversation_id, user_id)
        return [
            {"role": m.get("role", ""), "content": m.get("content", ""), "metadata": m.get("metadata") or {}}
            for m in msgs
        ]
    except Exception:
        return []


def _save_ask_messages(
    user_id: str,
    conversation_id: str | None,
    query: str,
    response: dict,
) -> str | None:
    """Save user message and assistant response. Create conversation if needed. Returns conversation_id."""
    try:
        from chat import create_conversation, create_message, get_conversation
        conv_id = conversation_id
        if not conv_id:
            conv = create_conversation(user_id, title=query[:80] + ("..." if len(query) > 80 else ""))
            conv_id = conv["id"]
        else:
            conv = get_conversation(conv_id, user_id)
            if not conv:
                return None
        create_message(conv_id, user_id, "user", query)
        plan = response.get("plan") or {}
        clarifying = plan.get("clarifying_questions") or []
        explanation = response.get("explanation", "")
        # When assistant asked clarifying questions (e.g. data range), use first as content for display
        if not explanation and clarifying:
            explanation = clarifying[0] if isinstance(clarifying[0], str) else "; ".join(clarifying)
        metadata = {
            "plan": plan,
            "data_feasibility": response.get("data_feasibility"),
            "results": response.get("results"),
            "chart_spec": response.get("chart_spec"),
            "sql": response.get("sql"),
        }
        if clarifying:
            metadata["clarifying_questions"] = clarifying
        create_message(conv_id, user_id, "assistant", explanation or "No response.", metadata=metadata)
        return conv_id
    except Exception:
        return conversation_id


@app.post("/ask")
def ask(
    body: dict = Body(default={"query": ""}),
    user=Depends(get_current_user_optional),
):
    """
    Submit a natural language question. Runs the multi-agent pipeline and returns
    plan, data_feasibility, results, chart_spec, explanation, and trace.
    Optionally pass conversation_id and Authorization to persist chat.
    """
    query = (body or {}).get("query", "").strip()
    conversation_id = (body or {}).get("conversation_id")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    history = _get_conversation_history(user["id"] if user else "", conversation_id) if user else []

    try:
        from agents.graph import get_graph
        graph = get_graph()
        initial_state = {"query": query, "trace": [], "conversation_history": history}
        final_state = graph.invoke(initial_state)

        response = {
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
            "data_range": final_state.get("data_range"),
            "empty_result_reason": final_state.get("empty_result_reason"),
        }

        if user:
            saved_conv_id = _save_ask_messages(user["id"], conversation_id, query, response)
            if saved_conv_id:
                response["conversation_id"] = saved_conv_id

        return response
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err_msg = str(e)
        if "RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg:
            err_msg = (
                "Gemini API quota exceeded. The free tier allows 20 requests per day. "
                "Options: (1) Wait until your quota resets tomorrow, "
                "(2) Try GEMINI_MODEL=gemini-2.5-flash-lite in .env (may have separate quota), "
                "(3) Enable billing at https://console.cloud.google.com for higher limits."
            )
        raise HTTPException(status_code=503, detail=err_msg)


async def _ask_stream_generator(query: str, user: dict | None, conversation_id: str | None, conversation_history: list[dict] | None = None):
    """Async generator that yields SSE events for real-time agent progress."""
    try:
        from agents.graph import get_graph

        graph = get_graph()
        history = conversation_history or []
        initial_state = {"query": query, "trace": [], "conversation_history": history}
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
                "data_range": last_state.get("data_range"),
                "empty_result_reason": last_state.get("empty_result_reason"),
            }
            if user:
                saved_conv_id = _save_ask_messages(user["id"], conversation_id, query, response)
                if saved_conv_id:
                    response["conversation_id"] = saved_conv_id
            yield f"data: {json.dumps({'type': 'complete', 'response': response})}\n\n"
    except Exception as e:
        err_msg = str(e)
        if "RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg:
            err_msg = (
                "Gemini API quota exceeded. The free tier allows 20 requests per day. "
                "Options: (1) Wait until your quota resets tomorrow, "
                "(2) Try GEMINI_MODEL=gemini-2.5-flash-lite in .env (may have separate quota), "
                "(3) Enable billing at https://console.cloud.google.com for higher limits."
            )
        yield f"data: {json.dumps({'type': 'error', 'message': err_msg})}\n\n"


@app.post("/ask/stream")
async def ask_stream(
    body: dict = Body(default={"query": ""}),
    user=Depends(get_current_user_optional),
):
    """
    Submit a natural language question. Streams real-time agent progress via SSE,
    then returns the full response in the final event.
    Optionally pass conversation_id and Authorization to persist chat.
    Uses conversation history for conversational context (e.g. user says "Sure" to proceed with available range).
    """
    query = (body or {}).get("query", "").strip()
    conversation_id = (body or {}).get("conversation_id")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    history = _get_conversation_history(user["id"] if user else "", conversation_id) if user else []

    try:
        return StreamingResponse(
            _ask_stream_generator(query, user, conversation_id, conversation_history=history),
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
