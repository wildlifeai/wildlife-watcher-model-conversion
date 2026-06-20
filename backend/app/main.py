# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""FastAPI application — entry point.

Wires together: CORS, lifespan (Redis connect/disconnect), middleware, and routers.
"""

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.middleware.logging import LoggingMiddleware
from app.middleware.rate_limit import limiter
from app.middleware.request_id import RequestIDMiddleware
from app.routers import (
    auth,
    brain,
    camtrapdp,
    clustering,
    deployments,
    exif,
    inaturalist,
    intelligence,
    jobs,
    lorawan,
    manifest,
    media,
    models,
    pipeline,
    public_api,
    qa,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown hooks."""
    logger.info("app_startup", log_level=settings.LOG_LEVEL)

    # Optional Sentry init
    if settings.SENTRY_DSN:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.fastapi import FastApiIntegration

            sentry_sdk.init(
                dsn=settings.SENTRY_DSN,
                integrations=[FastApiIntegration()],
                traces_sample_rate=0.1,
            )
            logger.info("sentry_initialized")
        except ImportError:
            logger.warning("sentry_sdk_not_installed")

    # Start recovery of jobs from Supabase
    from app.jobs.store import recover_stuck_jobs

    try:
        await recover_stuck_jobs()
    except Exception as e:
        logger.warning("stuck_jobs_recovery_failed", error=str(e))

    yield

    # Shutdown
    logger.info("app_shutdown")


app = FastAPI(
    title="Wildlife Watcher API",
    description="V2 backend — async job system, LoRaWAN ingestion, model conversion",
    version="2.0.0",
    lifespan=lifespan,
)

# ── Middleware (order matters: outermost first) ──────────────────────
app.add_middleware(RequestIDMiddleware)
app.add_middleware(LoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ── Unhandled-exception handler (CORS-safe) ──────────────────────────
# An uncaught exception is turned into a 500 by Starlette's ServerErrorMiddleware,
# which sits OUTSIDE the CORS middleware — so by default a 500 response carries no
# Access-Control-Allow-Origin header, and the browser reports a misleading "blocked
# by CORS policy" error that hides the real server error. Reflect the CORS headers
# here so 500s surface as actual errors to the frontend.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    from fastapi.responses import JSONResponse

    logger.error("unhandled_exception", path=str(request.url.path), error=str(exc))
    headers: dict[str, str] = {}
    origin = request.headers.get("origin")
    if origin and origin in settings.cors_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Vary"] = "Origin"
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "Internal server error", "retryable": False}},
        headers=headers,
    )


# ── Routers ──────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(deployments.router)
app.include_router(exif.router)
app.include_router(lorawan.router)
app.include_router(manifest.router)
app.include_router(models.router)
app.include_router(media.router)
app.include_router(public_api.router)
app.include_router(inaturalist.router)
app.include_router(clustering.router)
if settings.FF_CAMTRAPDP_IMPORT_ENABLED:
    app.include_router(camtrapdp.router)
if settings.FF_PIPELINE_ENABLED:
    app.include_router(pipeline.router)
if settings.FF_WILDLIFE_BRAIN_ENABLED:
    app.include_router(brain.router)
if settings.FF_ACTIVE_LEARNING_ENABLED:
    app.include_router(qa.router)
if settings.FF_INTELLIGENCE_ENABLED:
    app.include_router(intelligence.router)


# ── Health check ─────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health_check():
    """Simple health probe for Docker/Render health checks."""
    return {"status": "ok"}
