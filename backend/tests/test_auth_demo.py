# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for POST /api/auth/demo-session."""

from unittest.mock import MagicMock, patch

from app.config import settings


def test_demo_session_disabled_when_not_configured(client):
    """Without DEMO_EMAIL/DEMO_PASSWORD the endpoint returns a DEMO_DISABLED error envelope."""
    with patch.object(settings, "DEMO_EMAIL", ""), patch.object(settings, "DEMO_PASSWORD", ""):
        response = client.post("/api/auth/demo-session")
    assert response.status_code == 200
    body = response.json()
    assert body["error"]["code"] == "DEMO_DISABLED"
    assert body["data"] is None


def test_demo_session_returns_tokens(client):
    """With credentials configured, a successful sign-in returns the session tokens."""
    session = MagicMock(access_token="demo-access", refresh_token="demo-refresh")
    auth_response = MagicMock(session=session)
    mock_client = MagicMock()
    mock_client.auth.sign_in_with_password.return_value = auth_response

    with (
        patch.object(settings, "DEMO_EMAIL", "demo@wildlife.ai"),
        patch.object(settings, "DEMO_PASSWORD", "secret"),
        patch("app.routers.auth.supabase_client.create_anon_client", return_value=mock_client),
    ):
        response = client.post("/api/auth/demo-session")

    assert response.status_code == 200
    body = response.json()
    assert body["error"] is None
    assert body["data"] == {"access_token": "demo-access", "refresh_token": "demo-refresh"}
    mock_client.auth.sign_in_with_password.assert_called_once_with({"email": "demo@wildlife.ai", "password": "secret"})


def test_demo_session_sign_in_failure_is_retryable_error(client):
    """A Supabase failure surfaces as DEMO_UNAVAILABLE, not a 500."""
    mock_client = MagicMock()
    mock_client.auth.sign_in_with_password.side_effect = Exception("invalid login credentials")

    with (
        patch.object(settings, "DEMO_EMAIL", "demo@wildlife.ai"),
        patch.object(settings, "DEMO_PASSWORD", "wrong"),
        patch("app.routers.auth.supabase_client.create_anon_client", return_value=mock_client),
    ):
        response = client.post("/api/auth/demo-session")

    assert response.status_code == 200
    body = response.json()
    assert body["error"]["code"] == "DEMO_UNAVAILABLE"
    assert body["error"]["retryable"] is True
