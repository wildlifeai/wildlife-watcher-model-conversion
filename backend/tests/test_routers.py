# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Integration tests for routers — health check and basic endpoint validation.

Tests that require Redis are marked with @pytest.mark.skipif to gracefully
degrade when Redis is not available (local dev without Docker).
"""

import pytest

_redis_available = False
try:
    import redis as _redis_sync

    _r = _redis_sync.Redis.from_url("redis://localhost:6379")
    _r.ping()
    _redis_available = True
    _r.close()
except Exception:
    pass

needs_redis = pytest.mark.skipif(not _redis_available, reason="Redis not available")


def test_health_check(client):
    """GET /health should return 200 with status ok."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_docs_accessible(client):
    """GET /docs should return 200 (Swagger UI)."""
    response = client.get("/docs")
    assert response.status_code == 200


def test_openapi_schema_valid(client):
    """GET /openapi.json should return valid OpenAPI schema."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "Wildlife Watcher API"
    assert schema["info"]["version"] == "2.0.0"
    assert "/health" in schema["paths"]
    assert "/api/jobs/{job_id}" in schema["paths"]


@needs_redis
def test_job_not_found(client):
    """GET /api/jobs/{unknown_id} should return 404 (for an authenticated caller)."""
    from types import SimpleNamespace

    from app.dependencies import get_current_user
    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="test-user", email="t@ww.ai")
    try:
        response = client.get("/api/jobs/nonexistent-job-id")
        assert response.status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_job_status_requires_auth(client):
    """GET /api/jobs/{id} must reject unauthenticated callers (was an open IDOR)."""
    response = client.get("/api/jobs/some-id")
    assert response.status_code in (401, 403, 422)  # missing/invalid Authorization header


@needs_redis
def test_sscma_catalog(client):
    """GET /api/models/sscma/catalog should return 200 with data array."""
    response = client.get("/api/models/sscma/catalog")
    assert response.status_code == 200
    body = response.json()
    assert "data" in body


def test_unhandled_exception_returns_cors_headers():
    """A 500 must carry CORS headers for an allowed origin, so the browser shows the
    real error instead of a misleading "blocked by CORS policy" message."""
    import asyncio
    from unittest.mock import MagicMock

    from app.config import settings
    from app.main import unhandled_exception_handler

    origin = settings.cors_origins[0]
    req = MagicMock()
    req.url.path = "/api/whatever"
    req.headers = {"origin": origin}

    resp = asyncio.run(unhandled_exception_handler(req, RuntimeError("boom")))
    assert resp.status_code == 500
    assert resp.headers.get("access-control-allow-origin") == origin
    assert resp.headers.get("access-control-allow-credentials") == "true"


def test_unhandled_exception_no_cors_for_unknown_origin():
    """An origin that isn't allow-listed gets no ACAO header (no origin reflection)."""
    import asyncio
    from unittest.mock import MagicMock

    from app.main import unhandled_exception_handler

    req = MagicMock()
    req.url.path = "/api/whatever"
    req.headers = {"origin": "https://evil.example"}

    resp = asyncio.run(unhandled_exception_handler(req, RuntimeError("boom")))
    assert resp.status_code == 500
    assert resp.headers.get("access-control-allow-origin") is None
