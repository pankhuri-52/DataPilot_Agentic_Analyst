"""Shared FastAPI auth dependencies (avoids circular imports with routers)."""
from fastapi import Header, HTTPException


def _get_bearer_token(authorization: str | None = Header(default=None)) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[7:].strip()


def get_current_user_optional(authorization: str | None = Header(default=None)):
    token = _get_bearer_token(authorization)
    if not token:
        return None
    from supabase_service import get_user_from_token

    return get_user_from_token(token)


def require_user(authorization: str | None = Header(default=None)):
    user = get_current_user_optional(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
