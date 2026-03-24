-- Query Knowledge Base: RPCs for vector match and insert.
-- Prereq: run 000_query_kb_entries.sql first (CREATE EXTENSION vector + query_kb_entries table).
-- SECURITY DEFINER functions use search_path public, extensions so ::vector resolves (type lives in extensions).

CREATE OR REPLACE FUNCTION public.match_query_kb(
  p_query_embedding text,
  p_match_threshold double precision,
  p_match_count integer,
  p_dialect text,
  p_fingerprint text
)
RETURNS TABLE (
  id uuid,
  user_question text,
  sql text,
  similarity double precision,
  plan_snapshot jsonb,
  tables_used text[],
  columns_used text[],
  result_preview jsonb,
  executed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    e.id,
    e.user_question,
    e.sql,
    (1 - (e.embedding <=> p_query_embedding::vector))::double precision AS similarity,
    e.plan_snapshot,
    e.tables_used,
    e.columns_used,
    e.result_preview,
    e.executed_at
  FROM public.query_kb_entries e
  WHERE e.dialect = p_dialect
    AND e.schema_fingerprint = p_fingerprint
    AND (1 - (e.embedding <=> p_query_embedding::vector)) >= p_match_threshold
  ORDER BY e.embedding <=> p_query_embedding::vector
  LIMIT GREATEST(1, p_match_count);
$$;

CREATE OR REPLACE FUNCTION public.insert_query_kb_entry(
  p_executed_at timestamptz,
  p_index_text text,
  p_embedding text,
  p_user_question text,
  p_sql text,
  p_dialect text,
  p_schema_fingerprint text,
  p_plan_snapshot jsonb,
  p_tables_used text[],
  p_columns_used text[],
  p_result_preview jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.query_kb_entries (
    executed_at,
    index_text,
    embedding,
    user_question,
    sql,
    dialect,
    schema_fingerprint,
    plan_snapshot,
    tables_used,
    columns_used,
    result_preview
  )
  VALUES (
    p_executed_at,
    p_index_text,
    p_embedding::vector,
    p_user_question,
    p_sql,
    p_dialect,
    p_schema_fingerprint,
    p_plan_snapshot,
    COALESCE(p_tables_used, '{}'),
    COALESCE(p_columns_used, '{}'),
    p_result_preview
  )
  RETURNING query_kb_entries.id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.match_query_kb(text, double precision, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_query_kb_entry(timestamptz, text, text, text, text, text, text, jsonb, text[], text[], jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.match_query_kb(text, double precision, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_query_kb_entry(timestamptz, text, text, text, text, text, text, jsonb, text[], text[], jsonb) TO service_role;
