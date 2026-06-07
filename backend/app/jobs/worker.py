# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""ARQ worker settings — executes GPU/ML jobs off the lean API.

Run with: ``arq app.jobs.worker.WorkerSettings`` (this is the worker image CMD).

ARQ invokes registered functions as ``func(ctx, *args)``. Our job definitions in
``definitions.py`` are ctx-free (``func(job_id, ...)``) so they can also run
in-process via ``runner.py``. We therefore wrap each definition in a thin adapter
that drops ARQ's ``ctx`` and preserves ``__name__`` (ARQ resolves enqueued jobs by
name, so ``dispatch.enqueue_job("embed_deployment_job", ...)`` matches the wrapper).

Requires Redis + ARQ (worker/dev images). The API image only needs the ARQ
*client* to enqueue (see ``dispatch.py``); it never imports this module.
"""

from __future__ import annotations

from functools import wraps

try:
    from arq.connections import RedisSettings

    from app.config import settings
    from app.jobs.definitions import JOBS

    def _arq_adapter(func):
        """Adapt a ctx-free job definition to ARQ's ``func(ctx, *args)`` signature."""

        @wraps(func)  # preserves __name__ so ARQ resolves the job by name
        async def wrapper(ctx, *args, **kwargs):
            return await func(*args, **kwargs)

        return wrapper

    # ARQ-registered callables (one adapter per definition, same names).
    ARQ_FUNCTIONS = [_arq_adapter(fn) for fn in JOBS]

    async def on_startup(ctx) -> None:
        import structlog

        structlog.get_logger().info("arq_worker_startup", functions=len(ARQ_FUNCTIONS))

    async def on_shutdown(ctx) -> None:
        import structlog

        structlog.get_logger().info("arq_worker_shutdown")

    class WorkerSettings:
        """ARQ worker configuration (consumed by the ``arq`` CLI)."""

        functions = ARQ_FUNCTIONS
        redis_settings = RedisSettings.from_dsn(settings.REDIS_URL) if settings.REDIS_URL else None
        on_startup = on_startup
        on_shutdown = on_shutdown

        # GPU embedding runs can be long; allow generous timeouts.
        max_jobs = 4
        job_timeout = 3600  # 1 hour per job (large deployments / scoped runs)
        keep_result = 3600
        health_check_interval = 30

except ImportError:
    # ARQ not installed (lean API image). Enqueueing still works via the arq client
    # in dispatch.py; only the worker entrypoint needs this module.
    WorkerSettings = None  # type: ignore[assignment,misc]
