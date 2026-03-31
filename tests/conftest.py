"""
Root conftest – adds backend/ to sys.path so all test modules can
import backend packages directly (e.g. `from agents.sql_allowlist import ...`).
"""
import sys
from pathlib import Path

# Make backend/ importable without installing it as a package.
BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
