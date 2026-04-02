"""
Re-embed existing Query KB rows with OpenAI embeddings, preserving metadata and IDs.

Default behavior updates public.query_kb_entries.embedding (vector(768)) in place.
No rows are deleted.

Usage (from repo root):
  py -3.12 backend/scripts/reembed_query_kb_openai.py

Optional:
  py -3.12 backend/scripts/reembed_query_kb_openai.py --target-column embedding_v2
  py -3.12 backend/scripts/reembed_query_kb_openai.py --batch-size 200 --limit 1000
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any


def _load_env() -> None:
    root = Path(__file__).resolve().parents[2]
    backend = root / "backend"
    try:
        from dotenv import load_dotenv
    except Exception:
        return
    for p in (root / ".env", backend / ".env"):
        if p.exists():
            load_dotenv(p, override=False)


def _repo_imports() -> None:
    root = Path(__file__).resolve().parents[2]
    backend = root / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


def _get_service_client():
    from supabase_service import _get_service_client

    return _get_service_client()


def _row_text(row: dict[str, Any]) -> str:
    from agents.query_kb_helpers import kb_embedding_match_text

    user_q = str(row.get("user_question") or "").strip()
    if user_q:
        return kb_embedding_match_text(user_q)
    idx = str(row.get("index_text") or "").strip()
    if idx:
        return idx
    sql = str(row.get("sql") or "").strip()
    return sql[:8000]


def _fetch_rows(offset: int, batch_size: int) -> list[dict[str, Any]]:
    client = _get_service_client()
    end = offset + batch_size - 1
    res = (
        client.table("query_kb_entries")
        .select("id,index_text,user_question,sql")
        .order("executed_at", desc=False)
        .range(offset, end)
        .execute()
    )
    return [dict(r) for r in (res.data or [])]


def _update_embedding(row_id: str, vector_text: str, target_column: str) -> None:
    client = _get_service_client()
    client.table("query_kb_entries").update({target_column: vector_text}).eq("id", row_id).execute()


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-embed Query KB rows using OpenAI")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Rows per page from Supabase (default: 100)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max rows to process (0 = all rows)",
    )
    parser.add_argument(
        "--target-column",
        default="embedding",
        choices=["embedding", "embedding_v2"],
        help="Column to update (default: embedding)",
    )
    args = parser.parse_args()

    _load_env()
    _repo_imports()

    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY is not set.")
        return 1
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        return 1

    from embeddings import embed_text
    from query_kb_store import vector_param

    processed = 0
    failed = 0
    offset = 0
    batch_size = max(1, int(args.batch_size))
    limit = max(0, int(args.limit))

    while True:
        rows = _fetch_rows(offset, batch_size)
        if not rows:
            break
        for row in rows:
            if limit and processed >= limit:
                print(f"Reached limit={limit}. Stopping.")
                print(f"Done. processed={processed} failed={failed}")
                return 0
            rid = str(row.get("id") or "").strip()
            text = _row_text(row).strip()
            if not rid or not text:
                failed += 1
                continue
            try:
                vec = embed_text(text, task_type="RETRIEVAL_QUERY")
                _update_embedding(rid, vector_param(vec), args.target_column)
                processed += 1
                if processed % 50 == 0:
                    print(f"Processed {processed} rows...")
            except Exception as exc:
                failed += 1
                print(f"Failed row {rid}: {exc}")
        offset += len(rows)

    print(f"Done. processed={processed} failed={failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
