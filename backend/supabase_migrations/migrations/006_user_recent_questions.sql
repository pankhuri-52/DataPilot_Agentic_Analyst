-- Recent distinct user questions (for suggestion context). Service role only.

CREATE OR REPLACE FUNCTION public.get_user_recent_questions(p_user_id uuid, p_limit int DEFAULT 10)
RETURNS TABLE(display_text text, last_asked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sub.display_text, sub.last_asked_at
  FROM (
    SELECT DISTINCT ON (lower(trim(m.content)))
      trim(m.content)::text AS display_text,
      m.created_at AS last_asked_at
    FROM public.messages m
    INNER JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.user_id = p_user_id
      AND m.role = 'user'
      AND m.content IS NOT NULL
      AND length(trim(m.content)) > 0
    ORDER BY lower(trim(m.content)), m.created_at DESC
  ) sub
  ORDER BY sub.last_asked_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 10), 30));
$$;

COMMENT ON FUNCTION public.get_user_recent_questions(uuid, int) IS
  'DataPilot: distinct recent user questions (one row per normalized text), newest activity first.';

REVOKE ALL ON FUNCTION public.get_user_recent_questions(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_recent_questions(uuid, int) TO service_role;
