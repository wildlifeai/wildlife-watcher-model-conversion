# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Job dispatch — route a job to the ARQ worker (GPU offload) or run it in-process.

Single seam used by GPU/ML-heavy endpoints (the Wildlife Brain) so the routers
don't care *where* a job runs:

- ``REDIS_URL`` set  → enqueue to Redis; the ``embedding-worker`` (``--profile gpu``,
  ``target: worker`` with the heavy ML stack) picks it up. The lean API image never
  imports torch/hdbscan/umap.
- ``REDIS_URL`` empty → fall back to the in-process asyncio runner (``runner.py``).
  Suitable for the ``dev`` image, which bundles the ML stack.

Job status is shared across processes via the Supabase ``api_jobs`` mirror in
``store.py`` (the API's ``get_job`` falls back to Supabase), so progress polling
works regardless of which process executed the job.
"""

from __future__ import annotations

import structlog

from app.config import settings

logger = structlog.get_logger()


async def enqueue_job(name: str, *args) -> str:
    """Dispatch a job by its definition function name.

    ``name`` must match a function in ``app.jobs.definitions`` (and, for the ARQ
    path, be registered in ``app.jobs.worker.WorkerSettings.functions``).

    Returns the routing mode actually used ("arq" or "local") for logging/telemetry.
    """
    if settings.REDIS_URL:
        try:
            from arq import create_pool
            from arq.connections import RedisSettings

            pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
            try:
                await pool.enqueue_job(name, *args)
            finally:
                await pool.aclose()
            logger.info("job_enqueued_arq", job=name)
            return "arq"
        except Exception as exc:
            # Redis unreachable / arq missing → don't lose the job, run it locally.
            logger.warning("arq_enqueue_failed_fallback_local", job=name, error=str(exc))

    # In-process fallback. Imports the definition lazily so the API image only
    # pulls heavy ML modules if it actually executes the job here.
    from app.jobs import definitions
    from app.jobs.runner import enqueue_local_job

    func = getattr(definitions, name, None)
    if func is None:
        raise ValueError(f"Unknown job: {name}")
    enqueue_local_job(func(*args))
    logger.info("job_enqueued_local", job=name)
    return "local"
