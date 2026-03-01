"""
DataPilot backend – FastAPI app.
Health check and CORS for frontend; agents and Gemini in later steps.
"""
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Load .env from project root if present
from pathlib import Path
_root = Path(__file__).resolve().parents[1]
_env = _root.parent / ".env"
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


@app.get("/bigquery/tables")
def bigquery_tables():
    """List BigQuery POC tables if BIGQUERY_PROJECT_ID and BIGQUERY_DATASET are set."""
    project_id = os.getenv("BIGQUERY_PROJECT_ID")
    dataset_id = os.getenv("BIGQUERY_DATASET", "datapilot_poc")
    if not project_id or project_id == "your-gcp-project-id":
        raise HTTPException(
            status_code=503,
            detail="BigQuery not configured. Set BIGQUERY_PROJECT_ID and BIGQUERY_DATASET in .env",
        )
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
