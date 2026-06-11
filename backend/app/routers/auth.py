# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Auth helper endpoints.

POST /api/auth/demo-session → sign in the shared demo account server-side

The demo account is a real Supabase user (seeded by scripts/seed_demo.py)
holding only a viewer role on a curated demo project, so the returned
session flows through the normal auth path — RLS and role checks apply
unchanged. Keeping the sign-in server-side keeps the demo password out
of the frontend bundle and lets us rate-limit session minting per IP.
"""

import asyncio

import structlog
from fastapi import APIRouter, Request

from app.config import settings
from app.middleware.rate_limit import limiter
from app.schemas.common import ApiError, ApiResponse
from app.services import supabase_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/demo-session", response_model=ApiResponse)
@limiter.limit("10/minute")
async def create_demo_session(request: Request):
    """Mint a session for the shared demo account.

    Unauthenticated by design — this is the "Try the demo" button. The
    endpoint self-disables when DEMO_EMAIL/DEMO_PASSWORD are not configured.
    """
    if not settings.DEMO_EMAIL or not settings.DEMO_PASSWORD:
        return ApiResponse(
            error=ApiError(code="DEMO_DISABLED", message="The demo account is not configured on this server.")
        )

    client = supabase_client.create_anon_client()
    try:
        auth_response = await asyncio.to_thread(
            client.auth.sign_in_with_password,
            {"email": settings.DEMO_EMAIL, "password": settings.DEMO_PASSWORD},
        )
    except Exception as exc:
        logger.error("demo_session_sign_in_failed", error=str(exc))
        return ApiResponse(
            error=ApiError(code="DEMO_UNAVAILABLE", message="The demo is temporarily unavailable.", retryable=True)
        )

    session = auth_response.session if auth_response else None
    if not session:
        logger.error("demo_session_no_session_returned")
        return ApiResponse(
            error=ApiError(code="DEMO_UNAVAILABLE", message="The demo is temporarily unavailable.", retryable=True)
        )

    return ApiResponse(
        data={
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
        }
    )
