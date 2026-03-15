-- Schema documentation for chat history persistence
-- Run 001_conversations.sql first. This file adds comments and documents the structure.

COMMENT ON TABLE public.conversations IS 'Chat conversations per user. Each conversation has a title and contains multiple messages.';
COMMENT ON COLUMN public.conversations.user_id IS 'References auth.users. Conversations are scoped per user via RLS.';
COMMENT ON COLUMN public.conversations.title IS 'Display title, often derived from first user message.';

COMMENT ON TABLE public.messages IS 'Individual messages in a conversation. Supports user and assistant roles with rich metadata for agent responses.';
COMMENT ON COLUMN public.messages.role IS 'user | assistant';
COMMENT ON COLUMN public.messages.content IS 'Primary text content. For assistant: explanation or clarifying question.';
COMMENT ON COLUMN public.messages.metadata IS 'JSONB. For assistant messages: plan, data_feasibility, results, chart_spec, sql, clarifying_questions. Used for conversational context when user replies (e.g. "Sure" to proceed with available data range).';
