-- Query KB storage table. Run BEFORE 003_query_kb.sql (RPCs read/write this table).
-- vector(768) must match GEMINI_EMBEDDING_DIMENSION in backend .env (default 768).

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.query_kb_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_at timestamptz NOT NULL DEFAULT now(),
  index_text text NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  user_question text NOT NULL,
  sql text NOT NULL,
  dialect text NOT NULL,
  schema_fingerprint text NOT NULL,
  plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  tables_used text[] NOT NULL DEFAULT '{}'::text[],
  columns_used text[] NOT NULL DEFAULT '{}'::text[],
  result_preview jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.query_kb_entries IS 'DataPilot: stored questions + SQL + embeddings for match_query_kb.';
