"""
Chat persistence – conversations and messages in Supabase.
"""
import os
from typing import Any
from uuid import UUID

_CHAT_CLIENT = None


def _get_supabase():
    """Lazy-init Supabase client. Service role only — server requests have no user JWT, so RLS blocks anon."""
    global _CHAT_CLIENT
    if _CHAT_CLIENT is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for chat. "
                "The backend cannot list or save conversations without the service role key "
                "(Project Settings → API in Supabase). The anon key is not sufficient for server-side REST."
            )
        from supabase import create_client
        _CHAT_CLIENT = create_client(url, key)
    return _CHAT_CLIENT


def list_conversations(user_id: str) -> list[dict[str, Any]]:
    """List conversations for a user, newest first."""
    client = _get_supabase()
    response = (
        client.table("conversations")
        .select("id, title, created_at, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return [dict(row) for row in (response.data or [])]


def create_conversation(user_id: str, title: str = "New conversation") -> dict[str, Any]:
    """Create a new conversation."""
    client = _get_supabase()
    title = (title or "").strip() or "New conversation"
    # postgrest-py 2.28+: insert() returns SyncQueryRequestBuilder (no .select()).
    # Default returning=representation returns inserted row(s) in response.data.
    response = (
        client.table("conversations")
        .insert({"user_id": user_id, "title": title})
        .execute()
    )
    if not response.data or len(response.data) == 0:
        raise ValueError("Failed to create conversation")
    return dict(response.data[0])


def get_conversation(conversation_id: str, user_id: str) -> dict[str, Any] | None:
    """Get a conversation by ID if it belongs to the user."""
    client = _get_supabase()
    response = (
        client.table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not response.data or len(response.data) == 0:
        return None
    return dict(response.data[0])


def list_messages(conversation_id: str, user_id: str) -> list[dict[str, Any]]:
    """List messages in a conversation."""
    conv = get_conversation(conversation_id, user_id)
    if not conv:
        return []
    client = _get_supabase()
    response = (
        client.table("messages")
        .select("id, role, content, metadata, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=False)
        .execute()
    )
    return [dict(row) for row in (response.data or [])]


def create_message(
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
    metadata: dict | None = None,
) -> dict[str, Any]:
    """Create a message in a conversation."""
    conv = get_conversation(conversation_id, user_id)
    if not conv:
        raise ValueError("Conversation not found")
    client = _get_supabase()
    response = (
        client.table("messages")
        .insert({
            "conversation_id": conversation_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
        })
        .execute()
    )
    if not response.data or len(response.data) == 0:
        raise ValueError("Failed to create message")
    # Update conversation updated_at
    from datetime import datetime, timezone
    client.table("conversations").update({
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
    return dict(response.data[0])


def update_conversation_title(conversation_id: str, user_id: str, title: str) -> None:
    """Update conversation title."""
    conv = get_conversation(conversation_id, user_id)
    if not conv:
        raise ValueError("Conversation not found")
    client = _get_supabase()
    from datetime import datetime, timezone
    client.table("conversations").update({
        "title": title,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", conversation_id).execute()
