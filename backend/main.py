"""
DataPilot backend – FastAPI app.
Health check and CORS; Gemini test endpoint; agents in later steps.
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Body, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Load .env: project root first, then backend/.env for keys not already set (common when .env lives only under backend/)
from pathlib import Path
_backend_dir = Path(__file__).resolve().parent
_project_root = _backend_dir.parent
try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[assignment,misc]
if load_dotenv:
    _root_env = _project_root / ".env"
    if _root_env.exists():
        load_dotenv(_root_env)
    _backend_env = _backend_dir / ".env"
    if _backend_env.exists():
        load_dotenv(_backend_env, override=False)

from core.logging_config import setup_logging
from api_deps import get_current_user_optional, require_user as _require_user

setup_logging()

logger = logging.getLogger("datapilot")


def _auth_unexpected_error(exc: BaseException) -> HTTPException:
    """Turn missing deps / infra issues into actionable 503 messages."""
    if isinstance(exc, ModuleNotFoundError):
        name = getattr(exc, "name", None) or str(exc)
        return HTTPException(
            status_code=503,
            detail=(
                f'Missing Python package "{name}". From the backend folder run: '
                "py -3.12 -m pip install -r requirements.txt "
                "(use the same interpreter you use to start uvicorn). "
                "On Windows, if `python` is 3.14+, run the API with: "
                "py -3.12 -m uvicorn main:app --reload"
            ),
        )
    return HTTPException(status_code=503, detail=f"Auth error: {exc}")


def _cors_allow_origins() -> list[str]:
    """Explicit origins. Comma-separated CORS_ALLOW_ORIGINS overrides defaults."""
    raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]


def _cors_allow_origin_regex() -> str | None:
    """
    Preflight (OPTIONS) returns 400 if Origin is not allowed. Next.js often uses
    3001+ when 3000 is busy; dev also uses 127.0.0.1 vs localhost. Match any port
    on loopback only. Set CORS_ALLOW_ORIGIN_REGEX= to disable (production).
    """
    raw = os.getenv("CORS_ALLOW_ORIGIN_REGEX")
    if raw is not None:
        return raw.strip() or None
    # Include [::1] — on Windows, localhost often resolves to IPv6; browsers may send
    # Origin: http://[::1]:3000, which must match or preflight returns 400 and fetch fails.
    return r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"


app = FastAPI(
    title="DataPilot API",
    description="Autonomous multi-agent analytics – turn questions into validated insights.",
    version="0.1.0",
)

from data_sources.router import router as data_sources_router

app.include_router(data_sources_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_origin_regex=_cors_allow_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _log_chat_env_hint():
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        logger.warning(
            "SUPABASE_SERVICE_ROLE_KEY is not set — chat list/save will fail until you add it (see README)."
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
        from supabase_service import sign_up

        return sign_up(email, password, name)
    except ValueError as e:
        if "must be set" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
            )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise _auth_unexpected_error(e)


@app.post("/auth/login")
def auth_login(body: dict = Body(default={"email": "", "password": ""})):
    """Sign in with email and password. Returns user and access_token."""
    email = (body or {}).get("email", "").strip()
    password = (body or {}).get("password", "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required")
    try:
        from supabase_service import sign_in

        return sign_in(email, password)
    except ValueError as e:
        if "must be set" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
            )
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise _auth_unexpected_error(e)


@app.post("/auth/forgot-password")
def auth_forgot_password(body: dict = Body(default={"email": ""})):
    """Send a password reset email to the user. Always returns success to prevent email enumeration."""
    email = (body or {}).get("email", "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    try:
        from supabase_service import reset_password_for_email

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


@app.post("/auth/refresh")
def auth_refresh(body: dict = Body(default={"refresh_token": ""})):
    """Exchange a Supabase refresh token for a new session (keeps users signed in after access JWT expires)."""
    refresh_token = (body or {}).get("refresh_token", "").strip()
    if not refresh_token:
        raise HTTPException(status_code=400, detail="refresh_token is required")
    try:
        from supabase_service import refresh_session

        return refresh_session(refresh_token)
    except ValueError as e:
        if "must be set" in str(e).lower():
            raise HTTPException(
                status_code=503,
                detail="Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
            )
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise _auth_unexpected_error(e)


# ---- Chat (conversations + messages) ----
def _chat_error_detail(exc: BaseException) -> str:
    """Turn Supabase/PostgREST errors into actionable messages for the UI."""
    raw = str(exc)
    low = raw.lower()
    if "pgrst205" in low or ("schema cache" in low and "conversations" in low):
        return (
            "Chat tables are not in your Supabase project yet. In the Supabase dashboard: "
            "SQL Editor → New query → paste the full file "
            "backend/supabase_migrations/migrations/001_conversations.sql → Run. "
            "Then reload the app. Details: backend/supabase_migrations/README.md"
        )
    if "messages" in low and "schema cache" in low:
        return (
            "Chat tables are not in your Supabase project yet. Run "
            "backend/supabase_migrations/migrations/001_conversations.sql in the Supabase SQL Editor "
            "(see backend/supabase_migrations/README.md)."
        )
    if "get_user_frequent_questions" in low and (
        "pgrst202" in low or "could not find" in low or "not found" in low
    ):
        return (
            "Frequent-question RPC is missing. Run "
            "backend/supabase_migrations/migrations/005_user_frequent_questions.sql in the Supabase SQL Editor, "
            "then reload the API schema (Project Settings → API → Reload schema)."
        )
    if "get_user_recent_questions" in low and (
        "pgrst202" in low or "could not find" in low or "not found" in low
    ):
        return (
            "Recent-question RPC is missing. Run "
            "backend/supabase_migrations/migrations/006_user_recent_questions.sql in the Supabase SQL Editor, "
            "then reload the API schema (Project Settings → API → Reload schema)."
        )
    if "conversations" in low and ("relation" in low or "does not exist" in low):
        return (
            f"{raw} — Run backend/supabase_migrations/migrations/001_conversations.sql in the Supabase SQL Editor."
        )
    return raw


@app.get("/conversations")
def list_conversations(user=Depends(_require_user)):
    """List conversations for the current user (newest first, capped server-side)."""
    try:
        from supabase_service import list_conversations as _list

        return _list(user["id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("list_conversations failed")
        raise HTTPException(status_code=503, detail=_chat_error_detail(e))


@app.post("/conversations")
def create_conversation(
    body: dict = Body(default={"title": "New conversation"}),
    user=Depends(_require_user),
):
    """Create a new conversation."""
    title = (body or {}).get("title", "New conversation")
    try:
        from supabase_service import create_conversation as _create

        conv = _create(user["id"], title)
        return conv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("create_conversation failed")
        raise HTTPException(status_code=503, detail=_chat_error_detail(e))


@app.get("/conversations/frequent-questions")
def get_frequent_questions(
    user=Depends(_require_user),
    limit: int = Query(3, ge=1, le=50),
):
    """Top repeated questions for the signed-in user (for new-chat suggestions)."""
    try:
        from supabase_service import frequent_user_questions as _frequent

        rows = _frequent(user["id"], limit)
        out = []
        for row in rows:
            text = (row.get("display_text") or "").strip()
            if not text:
                continue
            try:
                n = int(row.get("ask_count") or 0)
            except (TypeError, ValueError):
                n = 0
            out.append({"question": text, "ask_count": n})
        return {"questions": out}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("get_frequent_questions failed")
        raise HTTPException(status_code=503, detail=_chat_error_detail(e))


@app.get("/conversations/suggested-questions")
def get_suggested_questions(
    user=Depends(_require_user),
    limit: int = Query(5, ge=1, le=8),
    include_kb: bool = Query(True),
):
    """
    RAG-style personalized prompts: chat history (+ optional query KB) + Gemini.
    See AGENTS.md: SUGGESTED_QUESTIONS_* env vars.
    """
    try:
        from suggested_questions import build_suggested_questions

        return build_suggested_questions(
            user["id"],
            suggestion_limit=limit,
            include_kb=include_kb,
        )
    except Exception as e:
        logger.exception("get_suggested_questions failed")
        raise HTTPException(status_code=503, detail=_chat_error_detail(e))


@app.get("/conversations/{conversation_id}/messages")
def get_messages(conversation_id: str, user=Depends(_require_user)):
    """List messages in a conversation."""
    try:
        from supabase_service import list_messages as _list

        return {"messages": _list(conversation_id, user["id"])}
    except Exception as e:
        logger.exception("get_messages failed")
        raise HTTPException(status_code=503, detail=_chat_error_detail(e))


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


@app.get("/data-sources/status")
def data_sources_status(user=Depends(get_current_user_optional)):
    """
    Env primary warehouse + signed-in user's saved sources (from Supabase user_data_sources).
    """
    sources: list[dict] = []
    hint: str | None = None
    try:
        from db.factory import get_connector
    except ImportError:
        return {"configured": False, "sources": [], "hint": "db.factory not available"}

    try:
        conn = get_connector()
        if conn is not None:
            src: dict = {
                "id": "primary",
                "type": conn.dialect,
                "healthy": False,
                "label": "",
                "detail": None,
            }
            if conn.dialect == "bigquery":
                src["label"] = f"BigQuery · {conn.project_id} / {conn.dataset_id}"
                try:
                    _resolve_credentials_path()
                    from google.cloud import bigquery

                    client = bigquery.Client(project=conn.project_id)
                    ds = f"{conn.project_id}.{conn.dataset_id}"
                    client.get_dataset(ds)
                    src["healthy"] = True
                except Exception as e:
                    src["detail"] = str(e)
            else:
                schema_name = getattr(conn, "schema", "public")
                src["label"] = f"PostgreSQL · {schema_name} (env)"
                try:
                    conn.execute("SELECT 1")
                    src["healthy"] = True
                except Exception as e:
                    src["detail"] = str(e)
            sources.append(src)
    except Exception:
        logger.debug("primary connector status", exc_info=True)

    if user:
        try:
            from data_sources.service import list_sources

            for row in list_sources(user["id"]):
                sources.append(
                    {
                        "id": str(row["id"]),
                        "type": row.get("source_type"),
                        "healthy": bool(row.get("healthy")),
                        "label": row.get("label") or row.get("source_type"),
                        "detail": row.get("last_error"),
                    }
                )
        except Exception:
            logger.debug("list_sources for status failed", exc_info=True)

    if not sources:
        return {
            "configured": False,
            "sources": [],
            "hint": (
                "Set BIGQUERY_PROJECT_ID and BIGQUERY_DATASET, or DATABASE_TYPE=postgres with POSTGRES_URL. "
                "Sign in and add a saved source under Data Sources."
            ),
        }

    return {"configured": True, "sources": sources, "hint": hint}


def _get_conversation_history(user_id: str, conversation_id: str | None) -> list[dict]:
    """Fetch recent messages from a conversation for conversational context. Returns list of {role, content, metadata}."""
    if not conversation_id or not user_id:
        return []
    try:
        from supabase_service import list_messages

        msgs = list_messages(conversation_id, user_id)
        return [
            {"role": m.get("role", ""), "content": m.get("content", ""), "metadata": m.get("metadata") or {}}
            for m in msgs
        ]
    except Exception:
        return []


_MAX_STORED_RESULT_ROWS = 200


def _metadata_for_storage(response: dict) -> dict:
    """Build assistant metadata; cap embedded results size for reliable JSONB storage."""
    plan = response.get("plan") or {}
    clarifying = plan.get("clarifying_questions") or []
    results = response.get("results")
    meta: dict = {
        "plan": plan,
        "data_feasibility": response.get("data_feasibility"),
        "chart_spec": response.get("chart_spec"),
        "sql": response.get("sql"),
        "answer_summary": response.get("answer_summary"),
        "follow_up_suggestions": response.get("follow_up_suggestions"),
    }
    if clarifying:
        meta["clarifying_questions"] = clarifying
    if isinstance(results, list):
        if len(results) > _MAX_STORED_RESULT_ROWS:
            meta["results"] = results[:_MAX_STORED_RESULT_ROWS]
            meta["results_truncated"] = True
        else:
            meta["results"] = results
    return meta


def _save_user_turn_only(
    user_id: str,
    conversation_id: str | None,
    query: str,
) -> str | None:
    """
    Persist the user message for this turn: create conversation if needed, or append user row
    when the thread exists but the latest stored user text for this turn is not yet saved
    (e.g. client pre-created an empty conversation). Skip duplicate user row on second interrupt.
    """
    q = (query or "").strip()
    if not q:
        return conversation_id
    try:
        from supabase_service import create_conversation, create_message, get_conversation, list_messages

        if conversation_id:
            conv = get_conversation(conversation_id, user_id)
            if conv:
                msgs = list_messages(conversation_id, user_id)
                last = msgs[-1] if msgs else None
                if (
                    last
                    and last.get("role") == "user"
                    and (last.get("content") or "").strip() == q
                ):
                    return conversation_id
                create_message(conversation_id, user_id, "user", q)
                return conversation_id
            # Client sent an id we cannot resolve — do not create a new conversation (avoids duplicate chats).
            logger.warning(
                "save_user_turn_only: conversation_id=%s not found for user; skipping persist",
                conversation_id,
            )
            return None

        title = q[:80] + ("..." if len(q) > 80 else "")
        conv = create_conversation(user_id, title=title)
        conv_id = conv["id"]
        create_message(conv_id, user_id, "user", q)
        return conv_id
    except Exception:
        return conversation_id


def _save_ask_messages(
    user_id: str,
    conversation_id: str | None,
    query: str,
    response: dict,
    *,
    skip_user_message: bool = False,
) -> str | None:
    """
    Save user + assistant messages, or assistant only after resume (user already persisted at interrupt).
    Returns conversation_id.
    """
    try:
        from supabase_service import create_conversation, create_message, get_conversation

        conv_id = conversation_id
        if skip_user_message:
            if not conv_id:
                return None
            conv = get_conversation(conv_id, user_id)
            if not conv:
                return None
        else:
            q = (query or "").strip()
            if not conv_id:
                title = (q[:80] + ("..." if len(q) > 80 else "")).strip() or "New conversation"
                conv = create_conversation(user_id, title=title)
                conv_id = conv["id"]
            else:
                conv = get_conversation(conv_id, user_id)
                if not conv:
                    return None
            if q:
                create_message(conv_id, user_id, "user", q)

        plan = response.get("plan") or {}
        clarifying = plan.get("clarifying_questions") or []
        explanation = response.get("explanation", "")
        if not explanation and clarifying:
            explanation = clarifying[0] if isinstance(clarifying[0], str) else "; ".join(clarifying)
        metadata = _metadata_for_storage(response)
        if clarifying:
            metadata["clarifying_questions"] = clarifying
        create_message(conv_id, user_id, "assistant", explanation or "No response.", metadata=metadata)
        return conv_id
    except Exception:
        return conversation_id


def _build_ask_response(state: dict) -> dict:
    """Build response dict from graph state."""
    return {
        "plan": state.get("plan"),
        "data_feasibility": state.get("data_feasibility"),
        "nearest_plan": state.get("nearest_plan"),
        "missing_explanation": state.get("missing_explanation"),
        "tables_used": state.get("tables_used"),
        "sql": state.get("sql"),
        "bytes_scanned": state.get("bytes_scanned"),
        "estimated_cost": state.get("estimated_cost"),
        "results": state.get("raw_results"),
        "validation_ok": state.get("validation_ok"),
        "chart_spec": state.get("chart_spec"),
        "explanation": state.get("explanation"),
        "answer_summary": state.get("answer_summary"),
        "follow_up_suggestions": state.get("follow_up_suggestions"),
        "trace": state.get("trace", []),
        "data_range": state.get("data_range"),
        "empty_result_reason": state.get("empty_result_reason"),
    }


def _maybe_index_query_kb(last_state: dict, user_query: str) -> None:
    """After a successful full pipeline, embed and store query + SQL for future matches."""
    if last_state.get("from_query_cache_adapt"):
        return
    if not last_state.get("validation_ok"):
        return
    sql = last_state.get("sql")
    if not sql or not str(sql).strip():
        return
    plan = last_state.get("plan")
    if not isinstance(plan, dict):
        return
    try:
        from agents.query_kb_helpers import (
            build_index_text,
            guess_columns_from_sql,
            is_trivial_kb_followup,
            kb_embedding_match_text,
            resolve_kb_user_question_for_index,
            result_preview_payload,
            schema_fingerprint_from_schema,
        )
        from agents.context import get_effective_connector, get_effective_schema
        from embeddings import embed_text
        from query_kb_store import insert_kb_entry

        connector = get_effective_connector(last_state)
        if not connector:
            return
        dialect = connector.dialect
        schema = get_effective_schema(last_state)
        fingerprint = schema_fingerprint_from_schema(schema)
        hist = last_state.get("conversation_history") or []
        if not isinstance(hist, list):
            hist = []
        q = resolve_kb_user_question_for_index((user_query or "").strip(), hist)
        if not q or is_trivial_kb_followup(q):
            return
        tables_used = last_state.get("tables_used") or []
        if not isinstance(tables_used, list):
            tables_used = []
        tables_used = [str(t) for t in tables_used]
        cols = guess_columns_from_sql(str(sql))
        index_text = build_index_text(q, tables_used, cols)
        match_text = kb_embedding_match_text(q)
        doc_vec = embed_text(match_text, task_type="RETRIEVAL_QUERY")
        preview = result_preview_payload(last_state.get("raw_results"))
        insert_kb_entry(
            executed_at=datetime.now(timezone.utc),
            index_text=index_text,
            embedding=doc_vec,
            user_question=q,
            sql=str(sql).strip(),
            dialect=dialect,
            schema_fingerprint=fingerprint,
            plan_snapshot=plan,
            tables_used=tables_used,
            columns_used=cols,
            result_preview=preview,
        )
    except Exception:
        logger.exception("Query KB indexing failed (non-fatal)")


def _merge_interrupt_client(state: dict, payload: dict) -> dict:
    """Merge LangGraph interrupt payload with checkpoint state so sql/cost are always exposed."""
    p = dict(payload) if isinstance(payload, dict) else {}

    def pick(key: str):
        v = p.get(key)
        return v if v is not None else state.get(key)

    sql = pick("sql")
    bytes_scanned = pick("bytes_scanned")
    estimated_cost = pick("estimated_cost")
    reason = p.get("reason") or "unknown"
    p["reason"] = reason
    if sql is not None:
        p["sql"] = sql
    if bytes_scanned is not None:
        p["bytes_scanned"] = bytes_scanned
    if estimated_cost is not None:
        p["estimated_cost"] = estimated_cost
    tables_used = state.get("tables_used")
    if tables_used is None:
        tables_used = p.get("tables") or []
    return {
        "data": p,
        "trace": state.get("trace", []),
        "plan": state.get("plan"),
        "data_feasibility": state.get("data_feasibility"),
        "tables_used": tables_used,
        "sql": sql,
        "bytes_scanned": bytes_scanned,
        "estimated_cost": estimated_cost,
    }


@app.post("/ask")
def ask(
    body: dict = Body(default={"query": ""}),
    user=Depends(get_current_user_optional),
):
    """
    Submit a natural language question. Runs the multi-agent pipeline and returns
    plan, data_feasibility, results, chart_spec, explanation, and trace.
    Optionally pass conversation_id and Authorization to persist chat.
    Uses thread_id for interrupt/resume; returns thread_id when interrupted.
    """
    query = (body or {}).get("query", "").strip()
    conversation_id = (body or {}).get("conversation_id")
    thread_id = (body or {}).get("thread_id") or str(uuid.uuid4())
    source_id = (body or {}).get("source_id")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    history = _get_conversation_history(user["id"] if user else "", conversation_id) if user else []

    try:
        from langgraph.types import Command
        from agents.graph import get_graph
        from data_sources.runtime import build_initial_runtime_state

        graph = get_graph()
        config = {"configurable": {"thread_id": thread_id}}
        rt = build_initial_runtime_state(user["id"] if user else None, source_id)
        initial_state = {"query": query, "trace": [], "conversation_history": history, **rt}

        try:
            result = graph.invoke(initial_state, config=config)
        except Exception as inv_err:
            # LangGraph may raise on interrupt; check for interrupt in exception
            err_str = str(inv_err)
            if "interrupt" in err_str.lower() or "GraphInterrupt" in err_str:
                state_snapshot = graph.get_state(config)
                state = state_snapshot.values if hasattr(state_snapshot, "values") else {}
                out = {
                    "thread_id": thread_id,
                    "interrupt": {"reason": "unknown", "data": {}},
                    "trace": state.get("trace", []),
                    "plan": state.get("plan"),
                    "data_feasibility": state.get("data_feasibility"),
                    "tables_used": state.get("tables_used"),
                }
                if user and query:
                    cid = _save_user_turn_only(user["id"], conversation_id, query)
                    if cid:
                        out["conversation_id"] = cid
                return out
            raise inv_err

        # Check for interrupt (LangGraph may return state with __interrupt__)
        interrupt_data = result.get("__interrupt__") if isinstance(result, dict) else None
        if interrupt_data:
            # Extract interrupt payload (may be list of Interrupt objects)
            payload = interrupt_data[0].value if hasattr(interrupt_data[0], "value") else interrupt_data[0]
            if isinstance(payload, dict):
                merged = _merge_interrupt_client(result, payload)
                out = {
                    "thread_id": thread_id,
                    "interrupt": merged["data"],
                    "trace": merged["trace"],
                    "plan": merged["plan"],
                    "data_feasibility": merged["data_feasibility"],
                    "tables_used": merged["tables_used"],
                    "sql": merged["sql"],
                    "bytes_scanned": merged["bytes_scanned"],
                    "estimated_cost": merged["estimated_cost"],
                }
                if user and query:
                    cid = _save_user_turn_only(user["id"], conversation_id, query)
                    if cid:
                        out["conversation_id"] = cid
                return out

        response = _build_ask_response(result)
        response["thread_id"] = thread_id

        _maybe_index_query_kb(result, query)

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


async def _ask_stream_generator(
    query: str,
    user: dict | None,
    conversation_id: str | None,
    thread_id: str,
    conversation_history: list[dict] | None = None,
    resume: bool | dict | None = None,
    persist_query: str | None = None,
    source_id: str | None = None,
):
    """Async generator that yields SSE events for real-time agent progress. Handles interrupts."""
    try:
        from langgraph.types import Command
        from agents.graph import get_graph

        graph = get_graph()
        config = {"configurable": {"thread_id": thread_id}}
        history = conversation_history or []
        prev_trace_len = 0
        last_state = None

        if resume is not None:
            input_data = Command(resume=resume)
            # Checkpoint already holds trace through the interrupt; streaming re-yields full state
            # first, so without this we would emit duplicate progress for planner/discovery/optimizer.
            try:
                snap = graph.get_state(config)
                vals = getattr(snap, "values", None) if snap is not None else None
                if isinstance(vals, dict):
                    prev_trace_len = len(vals.get("trace") or [])
            except Exception:
                prev_trace_len = 0
        else:
            from data_sources.runtime import build_initial_runtime_state

            rt = build_initial_runtime_state(user["id"] if user else None, source_id)
            input_data = {"query": query, "trace": [], "conversation_history": history, **rt}

        # stream_mode includes "custom" so append_trace() can use get_stream_writer (used by LangGraph).
        # Do not yield SSE from custom "trace_progress" here: the next "values" chunk already contains
        # the same trace rows, and catch-up below would re-emit them — duplicating every substep in the UI.
        async for raw in graph.astream(
            input_data, config=config, stream_mode=["values", "custom"]
        ):
            if isinstance(raw, tuple) and len(raw) == 2:
                mode, data = raw
                if mode == "custom":
                    continue
                if mode == "values":
                    chunk = data
                else:
                    continue
            else:
                chunk = raw

            if not isinstance(chunk, dict):
                continue

            # Check for interrupt (chunk may be dict with __interrupt__)
            interrupt_data = chunk.get("__interrupt__")
            if interrupt_data:
                first = interrupt_data[0] if interrupt_data else None
                payload = first.value if first and hasattr(first, "value") else (first or {})
                if not isinstance(payload, dict):
                    payload = {}
                # Use last_state for trace/plan (chunk with interrupt may not have full state)
                state = last_state if last_state is not None else {}
                merged = _merge_interrupt_client(state, payload)
                interrupt_event = {
                    "type": "interrupt",
                    "thread_id": thread_id,
                    **merged,
                }
                if user and resume is None and (query or "").strip():
                    persisted = _save_user_turn_only(user["id"], conversation_id, query)
                    if persisted:
                        interrupt_event["conversation_id"] = persisted
                yield f"data: {json.dumps(interrupt_event)}\n\n"
                return

            last_state = chunk
            trace = chunk.get("trace") or []
            # Catch-up for invoke() / tests without custom stream, or any missed lines
            for i in range(prev_trace_len, len(trace)):
                entry = trace[i]
                event = {"type": "progress", "agent": entry.get("agent", ""), "trace_entry": entry}
                yield f"data: {json.dumps(event)}\n\n"
            prev_trace_len = len(trace)

        if last_state is not None:
            response = _build_ask_response(last_state)
            response["thread_id"] = thread_id
            if user:
                eff_conv = conversation_id
                if resume is not None:
                    q_orig = (persist_query or "").strip()
                    if not eff_conv and q_orig:
                        eff_conv = _save_user_turn_only(user["id"], None, q_orig)
                    if eff_conv:
                        saved_conv_id = _save_ask_messages(
                            user["id"],
                            eff_conv,
                            query,
                            response,
                            skip_user_message=True,
                        )
                    elif q_orig:
                        saved_conv_id = _save_ask_messages(
                            user["id"],
                            None,
                            q_orig,
                            response,
                            skip_user_message=False,
                        )
                    else:
                        saved_conv_id = None
                else:
                    saved_conv_id = _save_ask_messages(
                        user["id"],
                        eff_conv,
                        (query or "").strip(),
                        response,
                        skip_user_message=False,
                    )
                if saved_conv_id:
                    response["conversation_id"] = saved_conv_id
            _maybe_index_query_kb(last_state, (query or "").strip() or (persist_query or "").strip())
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
    When an interrupt occurs (table approval, execute confirmation), returns type: "interrupt" with thread_id.
    Use POST /ask/continue with that thread_id to resume.
    """
    query = (body or {}).get("query", "").strip()
    conversation_id = (body or {}).get("conversation_id")
    thread_id = (body or {}).get("thread_id") or str(uuid.uuid4())
    source_id = (body or {}).get("source_id")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    history = _get_conversation_history(user["id"] if user else "", conversation_id) if user else []

    try:
        return StreamingResponse(
            _ask_stream_generator(
                query,
                user,
                conversation_id,
                thread_id,
                conversation_history=history,
                source_id=source_id,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Agent error: {str(e)}")


@app.post("/ask/continue")
async def ask_continue(
    body: dict = Body(default={"thread_id": ""}),
    user=Depends(get_current_user_optional),
):
    """
    Resume graph execution after an interrupt (table approval or execute confirmation).
    Pass thread_id from the interrupt event. Streams from the resume point.
    For query-cache hits, pass resume: { "kind": "query_cache_hit", "action": "full_pipeline" | "use_cached_sql" }.
    """
    thread_id = (body or {}).get("thread_id", "").strip()
    conversation_id = (body or {}).get("conversation_id")
    source_id = (body or {}).get("source_id")
    resume_payload = (body or {}).get("resume")
    if resume_payload is not None:
        resume_val: bool | dict = resume_payload
    else:
        resume_val = (body or {}).get("approved", True)
    original_query = (body or {}).get("original_query", "").strip()
    if not thread_id:
        raise HTTPException(status_code=400, detail="thread_id is required")

    history = _get_conversation_history(user["id"] if user else "", conversation_id) if user else []

    try:
        return StreamingResponse(
            _ask_stream_generator(
                "",
                user,
                conversation_id,
                thread_id,
                conversation_history=history,
                resume=resume_val,
                persist_query=original_query or None,
                source_id=source_id,
            ),
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
        from llm import get_gemini, invoke_with_retry

        model = get_gemini()
        response = invoke_with_retry(model, message)
        content = response.content if hasattr(response, "content") else str(response)
        return {"reply": content}
        # print("Calling llm_chat api")
        # return {"reply": "Hello! What can you help me with?"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"LLM error: {str(e)}")
