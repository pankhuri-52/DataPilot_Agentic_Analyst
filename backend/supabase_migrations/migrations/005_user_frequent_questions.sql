-- Per-user frequent questions (for new-chat suggestions). Called from the API via service role.

CREATE OR REPLACE FUNCTION public.get_user_frequent_questions(p_user_id uuid, p_limit int DEFAULT 3)
RETURNS TABLE(display_text text, ask_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (array_agg(trim(m.content) ORDER BY m.created_at DESC))[1]::text AS display_text,
    COUNT(*)::bigint AS ask_count
  FROM public.messages m
  INNER JOIN public.conversations c ON c.id = m.conversation_id
  WHERE c.user_id = p_user_id
    AND m.role = 'user'
    AND m.content IS NOT NULL
    AND length(trim(m.content)) > 0
  GROUP BY lower(trim(m.content))
  ORDER BY count(*) DESC, max(m.created_at) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 3), 20));
$$;

COMMENT ON FUNCTION public.get_user_frequent_questions(uuid, int) IS
  'DataPilot: top repeated user questions for suggestions (grouped by lower(trim(content))).';

REVOKE ALL ON FUNCTION public.get_user_frequent_questions(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_frequent_questions(uuid, int) TO service_role;
