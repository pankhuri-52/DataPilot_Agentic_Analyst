"""
Supabase integration: auth (anon key) and chat persistence (service role).
Consolidates former auth.py + chat.py with logging and transient-error retries.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from core.retry import retry_sync

logger = logging.getLogger("datapilot.supabase")

_ANON_CLIENT = None
_SERVICE_CLIENT = None


def _get_anon_client():
    """Lazy-init Supabase client with anon key (auth endpoints)."""
    global _ANON_CLIENT
    if _ANON_CLIENT is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_KEY) must be set")
        from supabase import create_client

        _ANON_CLIENT = create_client(url, key)
        logger.info("Supabase anon client initialized")
    return _ANON_CLIENT


def _get_service_client():
    """Lazy-init Supabase client with service role (chat REST)."""
    global _SERVICE_CLIENT
    if _SERVICE_CLIENT is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for chat. "
                "The backend cannot list or save conversations without the service role key "
                "(Project Settings → API in Supabase). The anon key is not sufficient for server-side REST."
            )
        from supabase import create_client

        _SERVICE_CLIENT = create_client(url, key)
        logger.info("Supabase service-role client initialized")
    return _SERVICE_CLIENT


# ---- Auth (anon) ----


def sign_up(email: str, password: str, name: str | None = None) -> dict[str, Any]:
    """Create a new user. Returns user and session."""
    client = _get_anon_client()
    credentials: dict[str, Any] = {"email": email, "password": password}
    if name and name.strip():
        credentials["options"] = {"data": {"full_name": name.strip()}}

    def _run():
        response = client.auth.sign_up(credentials)
        user = response.user
        session = response.session
        if not user:
            raise ValueError("Sign up failed")
        requires_confirmation = session is None
        user_data: dict[str, Any] = {"id": user.id, "email": user.email}
        meta = getattr(user, "user_metadata", None) or getattr(user, "raw_user_meta_data", None) or {}
        if meta and meta.get("full_name"):
            user_data["name"] = meta["full_name"]
        return {
            "user": user_data,
            "access_token": session.access_token if session else None,
            "refresh_token": session.refresh_token if session else None,
            "expires_at": session.expires_at if session else None,
            "requires_confirmation": requires_confirmation,
        }

    return retry_sync("supabase.auth.sign_up", _run)


def sign_in(email: str, password: str) -> dict[str, Any]:
    """Sign in with email and password. Returns user and session."""

    def _run():
        client = _get_anon_client()
        response = client.auth.sign_in_with_password({"email": email, "password": password})
        user = response.user
        session = response.session
        if not user or not session:
            raise ValueError("Invalid email or password")
        user_data: dict[str, Any] = {"id": user.id, "email": user.email}
        meta = getattr(user, "user_metadata", None) or getattr(user, "raw_user_meta_data", None) or {}
        if meta and meta.get("full_name"):
            user_data["name"] = meta["full_name"]
        return {
            "user": user_data,
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expires_at": session.expires_at,
        }

    return retry_sync("supabase.auth.sign_in_with_password", _run)


def reset_password_for_email(email: str, redirect_to: str | None = None) -> None:
    """Send a password reset email to the user."""

    def _run():
        client = _get_anon_client()
        options: dict[str, Any] = {}
        if redirect_to:
            options["redirect_to"] = redirect_to
        client.auth.reset_password_for_email(email, options)

    return retry_sync("supabase.auth.reset_password_for_email", _run)


def refresh_session(refresh_token: str) -> dict[str, Any]:
    """Refresh access token using Supabase refresh token."""
    rt = (refresh_token or "").strip()
    if not rt:
        raise ValueError("refresh_token is required")

    def _run():
        client = _get_anon_client()
        response = client.auth.refresh_session(rt)
        session = response.session
        user = response.user or (session.user if session else None)
        if not session or not user:
            raise ValueError("Invalid or expired refresh token")
        user_data: dict[str, Any] = {"id": user.id, "email": user.email}
        meta = getattr(user, "user_metadata", None) or getattr(user, "raw_user_meta_data", None) or {}
        if meta and meta.get("full_name"):
            user_data["name"] = meta["full_name"]
        return {
            "user": user_data,
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expires_at": session.expires_at,
        }

    return retry_sync("supabase.auth.refresh_session", _run)


def get_user_from_token(access_token: str) -> dict[str, Any] | None:
    """Validate JWT and return user info. Returns None if invalid."""
    if not access_token:
        return None

    def _run():
        client = _get_anon_client()
        response = client.auth.get_user(access_token)
        user = response.user
        if not user:
            return None
        result: dict[str, Any] = {"id": user.id, "email": user.email}
        meta = getattr(user, "user_metadata", None) or getattr(user, "raw_user_meta_data", None) or {}
        if meta and meta.get("full_name"):
            result["name"] = meta["full_name"]
        return result

    try:
        return retry_sync("supabase.auth.get_user", _run)
    except Exception:
        logger.debug("get_user_from_token: invalid or rejected token", exc_info=True)
        return None


# ---- Chat (service role) ----


def list_conversations(user_id: str) -> list[dict[str, Any]]:
    """List conversations for a user, newest first."""

    def _run():
        client = _get_service_client()
        response = (
            client.table("conversations")
            .select("id, title, created_at, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return [dict(row) for row in (response.data or [])]

    return retry_sync("supabase.chat.list_conversations", _run)


def create_conversation(user_id: str, title: str = "New conversation") -> dict[str, Any]:
    """Create a new conversation."""
    title = (title or "").strip() or "New conversation"

    def _run():
        client = _get_service_client()
        response = (
            client.table("conversations")
            .insert({"user_id": user_id, "title": title})
            .execute()
        )
        if not response.data or len(response.data) == 0:
            raise ValueError("Failed to create conversation")
        return dict(response.data[0])

    return retry_sync("supabase.chat.create_conversation", _run)


def get_conversation(conversation_id: str, user_id: str) -> dict[str, Any] | None:
    """Get a conversation by ID if it belongs to the user."""

    def _run():
        client = _get_service_client()
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

    return retry_sync("supabase.chat.get_conversation", _run)


def list_messages(conversation_id: str, user_id: str) -> list[dict[str, Any]]:
    """List messages in a conversation."""

    def _run():
        conv = get_conversation(conversation_id, user_id)
        if not conv:
            return []
        client = _get_service_client()
        response = (
            client.table("messages")
            .select("id, role, content, metadata, created_at")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=False)
            .execute()
        )
        return [dict(row) for row in (response.data or [])]

    return retry_sync("supabase.chat.list_messages", _run)


def create_message(
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
    metadata: dict | None = None,
) -> dict[str, Any]:
    """Create a message in a conversation."""

    def _run():
        conv = get_conversation(conversation_id, user_id)
        if not conv:
            raise ValueError("Conversation not found")
        client = _get_service_client()
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
        client.table("conversations").update({
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", conversation_id).execute()
        return dict(response.data[0])

    return retry_sync("supabase.chat.create_message", _run)


def frequent_user_questions(user_id: str, limit: int = 3) -> list[dict[str, Any]]:
    """Top repeated user message texts for this user (normalized by lower(trim(content)))."""

    lim = max(1, min(int(limit), 20))

    def _run():
        client = _get_service_client()
        response = client.rpc(
            "get_user_frequent_questions",
            {"p_user_id": str(user_id), "p_limit": lim},
        ).execute()
        return [dict(row) for row in (response.data or [])]

    return retry_sync("supabase.chat.frequent_user_questions", _run)


def recent_user_questions(user_id: str, limit: int = 10) -> list[dict[str, Any]]:
    """Distinct user questions, most recently touched first (normalized by lower(trim(content)))."""

    lim = max(1, min(int(limit), 30))

    def _run():
        client = _get_service_client()
        response = client.rpc(
            "get_user_recent_questions",
            {"p_user_id": str(user_id), "p_limit": lim},
        ).execute()
        return [dict(row) for row in (response.data or [])]

    return retry_sync("supabase.chat.recent_user_questions", _run)


def update_conversation_title(conversation_id: str, user_id: str, title: str) -> None:
    """Update conversation title."""

    def _run():
        conv = get_conversation(conversation_id, user_id)
        if not conv:
            raise ValueError("Conversation not found")
        client = _get_service_client()
        client.table("conversations").update({
            "title": title,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", conversation_id).execute()

    return retry_sync("supabase.chat.update_conversation_title", _run)
