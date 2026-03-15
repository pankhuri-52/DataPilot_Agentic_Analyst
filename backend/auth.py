"""
Auth module – Supabase Auth for signup, login, and JWT validation.
"""
import os
from typing import Any

_SUPABASE_CLIENT = None


def _get_supabase():
    """Lazy-init Supabase client."""
    global _SUPABASE_CLIENT
    if _SUPABASE_CLIENT is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_KEY) must be set")
        from supabase import create_client
        _SUPABASE_CLIENT = create_client(url, key)
    return _SUPABASE_CLIENT


def sign_up(email: str, password: str) -> dict[str, Any]:
    """Create a new user. Returns user and session.
    When email confirmation is enabled in Supabase, session is None until user confirms.
    """
    client = _get_supabase()
    response = client.auth.sign_up({"email": email, "password": password})
    user = response.user
    session = response.session
    if not user:
        raise ValueError("Sign up failed")
    requires_confirmation = session is None
    return {
        "user": {
            "id": user.id,
            "email": user.email,
        },
        "access_token": session.access_token if session else None,
        "refresh_token": session.refresh_token if session else None,
        "expires_at": session.expires_at if session else None,
        "requires_confirmation": requires_confirmation,
    }


def sign_in(email: str, password: str) -> dict[str, Any]:
    """Sign in with email and password. Returns user and session."""
    client = _get_supabase()
    response = client.auth.sign_in_with_password({"email": email, "password": password})
    user = response.user
    session = response.session
    if not user or not session:
        raise ValueError("Invalid email or password")
    return {
        "user": {
            "id": user.id,
            "email": user.email,
        },
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "expires_at": session.expires_at,
    }


def reset_password_for_email(email: str, redirect_to: str | None = None) -> None:
    """Send a password reset email to the user. Supabase sends the email with a link."""
    client = _get_supabase()
    options = {}
    if redirect_to:
        options["redirect_to"] = redirect_to
    client.auth.reset_password_for_email(email, options)


def get_user_from_token(access_token: str) -> dict[str, Any] | None:
    """Validate JWT and return user info. Returns None if invalid."""
    if not access_token:
        return None
    try:
        client = _get_supabase()
        response = client.auth.get_user(access_token)
        user = response.user
        if not user:
            return None
        return {"id": user.id, "email": user.email}
    except Exception:
        return None
