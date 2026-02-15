"""
DataPilot backend – FastAPI app.
Health check and CORS for frontend; agents and Gemini in later steps.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
