-- Optional prep migration if you later want to move Query KB to 1536-d vectors.
-- This migration is NON-DESTRUCTIVE: it keeps existing rows and adds a shadow column.
--
-- Recommended flow:
-- 1) Keep production using embedding (vector(768)).
-- 2) Backfill embedding_v2 with fresh OpenAI embeddings.
-- 3) Switch RPCs/app reads to embedding_v2.
-- 4) Drop old embedding only after verification.

ALTER TABLE public.query_kb_entries
  ADD COLUMN IF NOT EXISTS embedding_v2 extensions.vector(1536);
