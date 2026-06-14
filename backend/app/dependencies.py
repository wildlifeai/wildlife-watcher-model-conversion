# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""FastAPI dependency injection — auth, Supabase clients, rate limiting.

All request-scoped dependencies live here so routers stay thin.
"""

import asyncio
from typing import Optional

from fastapi import Depends, Header, HTTPException

from app.services import supabase_client
from app.services.cache import cached


async def get_current_user(authorization: str = Header(...)):
    """Validate Supabase JWT from the Authorization header.

    Runs auth.get_user() in a thread so the synchronous Supabase HTTP call
    does not block the asyncio event loop under concurrent requests.
    Returns the authenticated user object, or raises 401.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")

    token = authorization.replace("Bearer ", "")
    client = supabase_client.create_anon_client()
    try:
        user_response = await asyncio.to_thread(client.auth.get_user, token)
    except Exception as exc:
        # Supabase raises AuthApiError for an invalid/expired token or a session
        # that no longer exists (e.g. after a DB reset). That's a 401, not a 500 —
        # let the client know to re-authenticate instead of surfacing a server error.
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    if not user_response or not user_response.user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user_response.user


def is_email_confirmed(user) -> bool:
    """True when the Supabase user has a confirmed email.

    The gotrue user object exposes ``email_confirmed_at`` (and legacy
    ``confirmed_at``); either being set means the address is verified.
    """
    return bool(getattr(user, "email_confirmed_at", None) or getattr(user, "confirmed_at", None))


async def get_verified_user(user=Depends(get_current_user)):
    """Authenticated user **with a confirmed email**.

    Gates write / resource-consuming actions (uploads, AI inference, embedding,
    model conversion) so an unverified throwaway account can't abuse them. This
    is defence-in-depth alongside Supabase's "Confirm email" auth setting.
    """
    if not is_email_confirmed(user):
        raise HTTPException(
            status_code=403,
            detail="Please confirm your email address before uploading images or running analysis.",
        )
    return user


async def get_optional_user(
    authorization: Optional[str] = Header(None),
):
    """Like get_current_user but returns None for unauthenticated requests."""
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.replace("Bearer ", "")
    client = supabase_client.create_anon_client()

    try:
        user_response = client.auth.get_user(token)
        if user_response and user_response.user:
            return user_response.user
    except Exception:
        pass

    return None


async def get_user_client(authorization: str = Header(...)):
    """Supabase client authenticated as the requesting user (RLS applies)."""
    token = authorization.replace("Bearer ", "")
    client = supabase_client.create_anon_client()
    client.auth.set_session(access_token=token, refresh_token="")
    client.postgrest.auth(token)
    return client


async def get_privileged_client():
    """Service-role Supabase client for admin operations. Use sparingly."""
    return supabase_client.create_service_client()


async def get_manager_roles(user=Depends(get_current_user)):
    """Return all roles where the user is an organisation_manager.

    The result is cached per user for 5 minutes.  The JWT is still fully
    validated on every request by get_current_user() — only the role-lookup
    DB query is cached.  A 5-minute window is acceptable; role changes take
    effect at most 5 minutes later, which is standard RBAC cache practice.
    """

    async def _fetch() -> list:
        client = supabase_client.create_service_client()
        query = (
            client.table("user_roles")
            .select("scope_id, role")
            .eq("user_id", user.id)
            .eq("scope_type", "organisation")
            .eq("role", "organisation_manager")
            .eq("is_active", True)
            .is_("deleted_at", "null")
        )
        roles = await asyncio.to_thread(query.execute)
        return roles.data or []

    return await cached(
        key=f"manager_roles:{user.id}",
        ttl=300,  # 5 minutes
        fetch_fn=_fetch,
    )
