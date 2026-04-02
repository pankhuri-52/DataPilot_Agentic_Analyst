"""FastAPI routes for managed data sources."""
from __future__ import annotations

import json
import logging
import os
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile

from api_deps import require_user

logger = logging.getLogger("datapilot.data_sources.router")

router = APIRouter(prefix="/data-sources", tags=["data-sources"])


def _demo_postgres_database() -> str:
    return (os.getenv("DEMO_POSTGRES_DB") or os.getenv("DEMO_POSTGRES_DATABASE") or "").strip()


def _introspect_include_samples() -> bool:
    raw = (os.getenv("DATAPILOT_INTROSPECT_INCLUDE_SAMPLES") or "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _introspect_sample_row_limit() -> int:
    return max(5, min(int(os.getenv("DATAPILOT_INTROSPECT_SAMPLE_ROW_LIMIT", "25")), 200))


def _introspect_max_tables() -> int:
    return max(1, min(int(os.getenv("DATAPILOT_INTROSPECT_MAX_TABLES", "8")), 50))


@router.get("/demo-postgres-fields")
def demo_postgres_fields():
    """Non-secret + masked password for read-only demo form (values from env)."""
    host = (os.getenv("DEMO_POSTGRES_HOST") or "").strip()
    port = (os.getenv("DEMO_POSTGRES_PORT") or "5432").strip()
    database = _demo_postgres_database()
    schema = (os.getenv("DEMO_POSTGRES_SCHEMA") or "public").strip()
    user = (os.getenv("DEMO_POSTGRES_USER") or "").strip()
    has_pw = bool((os.getenv("DEMO_POSTGRES_PASSWORD") or "").strip())
    return {
        "configured": bool(host and database and user and has_pw),
        "host": host,
        "port": port,
        "database": database,
        "schema": schema,
        "user": user,
        "password_display": "••••••••" if has_pw else "",
    }


@router.post("/connect/demo-postgres")
def connect_demo_postgres(user=Depends(require_user)):
    host = (os.getenv("DEMO_POSTGRES_HOST") or "").strip()
    port = (os.getenv("DEMO_POSTGRES_PORT") or "5432").strip()
    database = _demo_postgres_database()
    schema = (os.getenv("DEMO_POSTGRES_SCHEMA") or "public").strip()
    pg_user = (os.getenv("DEMO_POSTGRES_USER") or "").strip()
    password = (os.getenv("DEMO_POSTGRES_PASSWORD") or "").strip()
    label = (os.getenv("DEMO_POSTGRES_LABEL") or "Finance demo (PostgreSQL)").strip()
    if not host or not database or not pg_user or not password:
        raise HTTPException(
            status_code=503,
            detail="Set DEMO_POSTGRES_HOST, DEMO_POSTGRES_DB (or DEMO_POSTGRES_DATABASE), DEMO_POSTGRES_USER, DEMO_POSTGRES_PASSWORD in .env",
        )
    connect_kwargs = {
        "host": host,
        "port": int(port),
        "dbname": database,
        "user": pg_user,
        "password": password,
    }
    try:
        import psycopg2

        c = psycopg2.connect(**connect_kwargs)
        c.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}") from e

    try:
        from core.credentials_crypto import encrypt_config
        from data_sources.introspect import introspect_postgres, schema_fingerprint
        from data_sources.service import find_source_by_type, insert_source, update_source

        catalog = introspect_postgres(
            schema,
            connect_kwargs=connect_kwargs,
            include_samples=_introspect_include_samples(),
            sample_row_limit=_introspect_sample_row_limit(),
            max_tables_sampled=_introspect_max_tables(),
        )
        fp = schema_fingerprint(catalog)
        enc = encrypt_config({**connect_kwargs, "schema": schema})
        existing = find_source_by_type(user["id"], "postgres")
        if existing:
            row = update_source(
                user["id"], existing["id"],
                label=label, encrypted_config=enc,
                schema_snapshot=catalog, schema_fingerprint=fp,
                healthy=True, last_error=None,
            )
        else:
            row = insert_source(user["id"], label, "postgres", enc, catalog, fp, healthy=True, last_error=None)
        return {"id": str(row["id"]), "label": row["label"], "source_type": "postgres", "healthy": True}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("connect_demo_postgres persist failed")
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/connect/postgres")
def connect_postgres(body: dict = Body(default_factory=dict), user=Depends(require_user)):
    connection_url = (body or {}).get("connection_url", "").strip()
    schema = ((body or {}).get("schema") or "public").strip() or "public"
    label = ((body or {}).get("label") or "PostgreSQL").strip() or "PostgreSQL"
    if not connection_url:
        raise HTTPException(status_code=400, detail="connection_url is required")
    try:
        import psycopg2

        from core.postgres_dsn import sanitize_postgres_uri_for_psycopg2

        safe_url = sanitize_postgres_uri_for_psycopg2(connection_url)
        c = psycopg2.connect(safe_url)
        c.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}") from e
    try:
        from core.credentials_crypto import encrypt_config
        from data_sources.introspect import introspect_postgres, schema_fingerprint
        from data_sources.service import find_source_by_type, insert_source, update_source

        catalog = introspect_postgres(
            schema,
            connection_url=connection_url,
            include_samples=_introspect_include_samples(),
            sample_row_limit=_introspect_sample_row_limit(),
            max_tables_sampled=_introspect_max_tables(),
        )
        fp = schema_fingerprint(catalog)
        enc = encrypt_config({"connection_url": connection_url, "schema": schema})
        existing = find_source_by_type(user["id"], "postgres")
        if existing:
            row = update_source(
                user["id"], existing["id"],
                label=label, encrypted_config=enc,
                schema_snapshot=catalog, schema_fingerprint=fp,
                healthy=True, last_error=None,
            )
        else:
            row = insert_source(user["id"], label, "postgres", enc, catalog, fp, healthy=True, last_error=None)
        return {"id": str(row["id"]), "label": row["label"], "source_type": "postgres", "healthy": True}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("connect_postgres persist failed")
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/connect/bigquery")
def connect_bigquery(body: dict = Body(default_factory=dict), user=Depends(require_user)):
    label = (body or {}).get("label", "BigQuery").strip() or "BigQuery"
    project_id = (body or {}).get("project_id", "").strip()
    dataset_id = (body or {}).get("dataset_id", "").strip()
    raw_sa = (body or {}).get("service_account_json")
    if not project_id or not dataset_id:
        raise HTTPException(status_code=400, detail="project_id and dataset_id are required")
    if raw_sa is None:
        raise HTTPException(status_code=400, detail="service_account_json is required")
    if isinstance(raw_sa, str):
        try:
            sa = json.loads(raw_sa)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid service_account_json: {e}") from e
    elif isinstance(raw_sa, dict):
        sa = raw_sa
    else:
        raise HTTPException(status_code=400, detail="service_account_json must be object or JSON string")

    try:
        from google.cloud import bigquery
        from google.oauth2 import service_account

        creds = service_account.Credentials.from_service_account_info(sa)
        client = bigquery.Client(project=project_id, credentials=creds)
        client.get_dataset(f"{project_id}.{dataset_id}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"BigQuery validation failed: {e}") from e

    try:
        from core.credentials_crypto import encrypt_config
        from data_sources.introspect import introspect_bigquery, schema_fingerprint
        from data_sources.service import insert_source

        catalog = introspect_bigquery(
            project_id,
            dataset_id,
            client,
            include_samples=_introspect_include_samples(),
            sample_row_limit=_introspect_sample_row_limit(),
            max_tables_sampled=_introspect_max_tables(),
        )
        fp = schema_fingerprint(catalog)
        enc = encrypt_config(
            {"project_id": project_id, "dataset_id": dataset_id, "credentials_json": sa},
        )
        row = insert_source(
            user["id"],
            label,
            "bigquery",
            enc,
            catalog,
            fp,
            healthy=True,
            last_error=None,
        )
        return {"id": str(row["id"]), "label": row["label"], "source_type": "bigquery", "healthy": True}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("connect_bigquery persist failed")
        raise HTTPException(status_code=503, detail=str(e)) from e


_MAX_IMPORT_CONTEXT_LEN = 4000


@router.post("/upload-csv")
async def upload_csv(
    user=Depends(require_user),
    file: UploadFile = File(...),
    label: str = Form(""),
    import_context: str = Form(""),
):
    pg_url = (os.getenv("SUPABASE_POSTGRES_URL") or "").strip()
    if not pg_url:
        raise HTTPException(
            status_code=503,
            detail=(
                "Set SUPABASE_POSTGRES_URL to your Postgres URI. In Supabase: open the project → click "
                "Connect (top) → copy the URI (use Session pooler / port 5432 on Windows if direct connection fails). "
                "Or: left sidebar Database → Connection string. Paste into backend .env and restart the API."
            ),
        )
    upload_schema = (os.getenv("CSV_UPLOAD_SCHEMA") or "user_uploads").strip()
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(status_code=400, detail="File too large (max ~5MB for demo)")
    disp = (label or "").strip() or (file.filename or "Uploaded CSV")
    ctx = (import_context or "").strip()
    if len(ctx) > _MAX_IMPORT_CONTEXT_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Import context too long (max {_MAX_IMPORT_CONTEXT_LEN} characters).",
        )
    try:
        from core.credentials_crypto import encrypt_config
        from data_sources.csv_loader import load_csv_into_schema
        from data_sources.introspect import schema_fingerprint
        from data_sources.service import insert_source

        table_name, catalog = load_csv_into_schema(
            raw,
            connection_url=pg_url,
            upload_schema=upload_schema,
            table_label=disp,
            import_context=ctx or None,
        )
        fp = schema_fingerprint(catalog)
        enc = encrypt_config(
            {"connection_url": pg_url, "schema": upload_schema, "table": table_name},
        )
        row = insert_source(
            user["id"],
            disp,
            "csv_upload",
            enc,
            catalog,
            fp,
            healthy=True,
            last_error=None,
        )
        return {
            "id": str(row["id"]),
            "label": row["label"],
            "source_type": "csv_upload",
            "table": table_name,
            "schema": upload_schema,
            "healthy": True,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("upload_csv failed")
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.get("/managed")
def list_managed(user=Depends(require_user)):
    from data_sources.service import list_sources

    try:
        rows = list_sources(user["id"])
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {"sources": rows}


@router.delete("/managed/{source_id}")
def delete_managed(source_id: str, user=Depends(require_user)):
    from data_sources.service import delete_source

    if not delete_source(user["id"], source_id):
        raise HTTPException(status_code=404, detail="Source not found")
    return {"ok": True}


@router.post("/managed/{source_id}/refresh-schema")
def refresh_schema(source_id: str, user=Depends(require_user)):
    from core.credentials_crypto import decrypt_config
    from data_sources.introspect import introspect_bigquery, introspect_postgres, schema_fingerprint
    from data_sources.service import get_source, update_source_health

    row = get_source(user["id"], source_id)
    if not row:
        raise HTTPException(status_code=404, detail="Source not found")
    try:
        cfg = decrypt_config(row["encrypted_config"])
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    st = row["source_type"]
    try:
        if st == "csv_upload":
            url = cfg["connection_url"]
            schema = cfg.get("schema") or "public"
            table = cfg.get("table")
            full = introspect_postgres(
                schema,
                connection_url=url,
                include_samples=_introspect_include_samples(),
                sample_row_limit=_introspect_sample_row_limit(),
                max_tables_sampled=_introspect_max_tables(),
            )
            if table:
                tables = [t for t in (full.get("tables") or []) if t.get("name") == table]
                catalog = {**full, "tables": tables, "description": row.get("label") or full.get("description")}
            else:
                catalog = full
        elif st == "postgres":
            schema = cfg.get("schema") or "public"
            if cfg.get("host") and cfg.get("dbname"):
                kw = {
                    "host": cfg["host"],
                    "port": int(cfg.get("port") or 5432),
                    "dbname": cfg["dbname"],
                    "user": cfg["user"],
                    "password": cfg.get("password") or "",
                }
                catalog = introspect_postgres(
                    schema,
                    connect_kwargs=kw,
                    include_samples=_introspect_include_samples(),
                    sample_row_limit=_introspect_sample_row_limit(),
                    max_tables_sampled=_introspect_max_tables(),
                )
            else:
                url = cfg.get("connection_url")
                if not url:
                    raise HTTPException(status_code=400, detail="Missing connection_url or host/dbname in config")
                catalog = introspect_postgres(
                    schema,
                    connection_url=url,
                    include_samples=_introspect_include_samples(),
                    sample_row_limit=_introspect_sample_row_limit(),
                    max_tables_sampled=_introspect_max_tables(),
                )
        elif st == "bigquery":
            sa = cfg.get("credentials_json")
            if isinstance(sa, str):
                sa = json.loads(sa)
            from google.cloud import bigquery
            from google.oauth2 import service_account

            creds = service_account.Credentials.from_service_account_info(sa)
            client = bigquery.Client(project=cfg["project_id"], credentials=creds)
            catalog = introspect_bigquery(
                cfg["project_id"],
                cfg["dataset_id"],
                client,
                include_samples=_introspect_include_samples(),
                sample_row_limit=_introspect_sample_row_limit(),
                max_tables_sampled=_introspect_max_tables(),
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown source_type {st}")
        fp = schema_fingerprint(catalog)
        update_source_health(
            user["id"],
            source_id,
            healthy=True,
            last_error=None,
            schema_snapshot=catalog,
            schema_fingerprint=fp,
        )
        return {"ok": True, "schema_fingerprint": fp}
    except Exception as e:
        update_source_health(user["id"], source_id, healthy=False, last_error=str(e))
        raise HTTPException(status_code=400, detail=str(e)) from e
