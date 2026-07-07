# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""enqueue_job forwards ARQ scheduling kwargs (the AI-annotate debounce)."""

from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import app.jobs.dispatch as dispatch


async def test_enqueue_job_forwards_defer_by(monkeypatch):
    """`_defer_by` (and any other ARQ kwarg) must reach pool.enqueue_job — that's what makes the
    upload AI job wait, so the ~18 per-chunk enqueues collapse into one deferred run."""
    captured = {}

    async def _enqueue_job(name, *args, **kwargs):
        captured["name"] = name
        captured["args"] = args
        captured["kwargs"] = kwargs
        job = MagicMock()
        job.job_id = "jid123"
        return job

    pool = MagicMock()
    pool.enqueue_job = _enqueue_job
    pool.lpush = AsyncMock()
    pool.aclose = AsyncMock()

    async def _create_pool(*a, **k):
        return pool

    monkeypatch.setattr(dispatch.settings, "REDIS_URL", "redis://localhost:6379", raising=False)
    monkeypatch.setattr("arq.create_pool", _create_pool)
    monkeypatch.setattr("arq.connections.RedisSettings.from_dsn", lambda dsn: MagicMock())

    mode = await dispatch.enqueue_job("annotate_deployments_job", "aijob", ["dep1"], "user1", _defer_by=timedelta(seconds=60))

    assert mode == "arq"
    assert captured["name"] == "annotate_deployments_job"
    assert captured["args"] == ("aijob", ["dep1"], "user1")
    assert captured["kwargs"].get("_defer_by") == timedelta(seconds=60)
