-- Per-user saved warehouse connections (credentials encrypted by the API, not in this column as plaintext in app code paths).
CREATE TABLE IF NOT EXISTS public.user_data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('postgres', 'bigquery', 'csv_upload')),
  encrypted_config TEXT NOT NULL,
  schema_fingerprint TEXT,
  schema_snapshot JSONB NOT NULL DEFAULT '{}',
  healthy BOOLEAN NOT NULL DEFAULT false,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_data_sources_user_id ON public.user_data_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_sources_user_updated ON public.user_data_sources(user_id, updated_at DESC);

-- Backend uses service role only for this table; no RLS policies needed for PostgREST if table is not exposed to anon.
ALTER TABLE public.user_data_sources ENABLE ROW LEVEL SECURITY;

-- Deny direct client access; API uses service role which bypasses RLS.
CREATE POLICY "No direct access for authenticated users"
  ON public.user_data_sources FOR ALL
  USING (false)
  WITH CHECK (false);
