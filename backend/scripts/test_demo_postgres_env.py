"""
Verify DEMO_POSTGRES_* from repo-root .env (same file main.py loads).

Run from repo root:
  py -3.12 backend/scripts/test_demo_postgres_env.py

Does not print your password. Reports length / hidden characters / connect result.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_root = Path(__file__).resolve().parents[2]
_env = _root / ".env"
if not _env.exists():
    print("ERROR: No .env at", _env)
    sys.exit(1)

from dotenv import load_dotenv

load_dotenv(_env)

host = (os.getenv("DEMO_POSTGRES_HOST") or "").strip()
port = int((os.getenv("DEMO_POSTGRES_PORT") or "5432").strip())
dbname = (os.getenv("DEMO_POSTGRES_DB") or os.getenv("DEMO_POSTGRES_DATABASE") or "").strip()
user = (os.getenv("DEMO_POSTGRES_USER") or "").strip()
password_raw = os.getenv("DEMO_POSTGRES_PASSWORD")
password = (password_raw or "").strip()

print("--- Loaded from .env ---")
print("host:", repr(host))
print("port:", port)
print("dbname:", repr(dbname))
print("user:", repr(user))
print("password set:", bool(password_raw))
if password_raw is not None:
    print("password raw len:", len(password_raw))
    print("password strip len:", len(password))
    print("contains carriage return (\\r):", "\r" in password_raw)
    print("contains newline:", "\n" in password_raw)
    if password_raw != password:
        print("NOTE: .strip() changes length — fix trailing/leading whitespace in .env")

if not all([host, dbname, user, password]):
    print("ERROR: missing DEMO_POSTGRES_HOST, DEMO_POSTGRES_DB, DEMO_POSTGRES_USER, or DEMO_POSTGRES_PASSWORD")
    sys.exit(1)

print("\n--- Connecting (psycopg2 keyword args, same as API) ---")
try:
    import psycopg2

    conn = psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
        connect_timeout=10,
    )
    conn.close()
    print("SUCCESS: PostgreSQL accepted user/password on TCP", host, port)
except Exception as e:
    print("FAILED:", e)
    print(
        "\nIf this fails, PostgreSQL is rejecting this password for this user over TCP.\n"
        "Fix: use the exact password that works in pgAdmin Query Tool, or reset:\n"
        "  ALTER USER postgres WITH PASSWORD 'YourNewPassword';\n"
        "Then set DEMO_POSTGRES_PASSWORD in .env to match (restart API)."
    )
    sys.exit(2)
