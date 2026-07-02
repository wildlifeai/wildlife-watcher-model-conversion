# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Job status store — Redis-backed with in-memory fallback.

Every job has a key ``job:{id}`` in Redis containing its current status,
progress, summary, and configuration.  TTL is 24 hours.

Events are stored in a **separate** Redis list ``job:{id}:events`` to avoid
bloating the main job key (important for large batches with many events).
Each event carries a monotonic ``seq`` number so the frontend can safely
consume events even when the list is trimmed.

When Redis is unavailable (e.g. local dev), falls back to simple
in-memory dicts so endpoints don't crash.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

import structlog

from app.schemas.job import (
    EventType,
    JobInfo,
    JobStatus,
    ProgressEvent,
    ProgressPhase,
)
from app.services.supabase_client import create_service_client

logger = structlog.get_logger()

# In-memory stores (Primary fast path)
_memory_store: Dict[str, str] = {}
_memory_events: Dict[str, List[str]] = {}

# Per-job locks to serialise summary updates
_summary_locks: Dict[str, asyncio.Lock] = {}

MAX_EVENTS_RETURNED = 50


def _hydrate_from_supabase(job_id: str) -> Optional[str]:
    """Load a job from Supabase into this process's memory store; returns the raw JSON.

    The memory store is **per-process**: jobs are created on the API process, but ARQ jobs
    (e.g. the offloaded AI pipeline) run on the worker process. Without hydration, the
    worker's ``update_job``/``emit_event`` calls found nothing in memory and silently
    no-opped — so AI jobs stayed 'queued' in ``api_jobs`` forever and the frontend's
    "Processing" banner never cleared. Mirrors the lazy load in :func:`get_job`.
    """
    try:
        client = create_service_client()
        resp = client.table("api_jobs").select("job_data").eq("id", job_id).execute()
        if resp.data:
            db_data = resp.data[0]["job_data"] or {}
            events = db_data.pop("events", [])
            _memory_events[f"job:{job_id}:events"] = [json.dumps(e) for e in events]
            raw = json.dumps(db_data)
            _memory_store[f"job:{job_id}"] = raw
            return raw
    except Exception as e:
        logger.debug("job_hydrate_failed", job_id=job_id, error=str(e))
    return None


async def _get_raw(job_id: str) -> Optional[str]:
    """Raw job JSON from memory, hydrating from Supabase on a cross-process miss."""
    raw = _memory_store.get(f"job:{job_id}")
    if raw:
        return raw
    return await asyncio.to_thread(_hydrate_from_supabase, job_id)


def _refresh_if_newer(job_id: str, local_updated_at: Optional[str]) -> Optional[str]:
    """Re-hydrate a job from Supabase only if the DB copy is newer than memory.

    The complement of :func:`_hydrate_from_supabase` for polling: a job created on the API
    but *executed on the worker* leaves the API's memory copy frozen at 'queued' — polls
    (``get_job``) must pick up the worker's Supabase writes or the upload dock never sees the
    AI job finish. Jobs running in *this* process always have memory >= DB (memory is written
    first, then synced), so the strict ISO-timestamp comparison never clobbers in-flight state.
    """
    try:
        client = create_service_client()
        resp = client.table("api_jobs").select("job_data").eq("id", job_id).execute()
        if not resp.data:
            return None
        db_data = resp.data[0]["job_data"] or {}
        db_updated = db_data.get("updated_at") or ""
        if local_updated_at and db_updated <= local_updated_at:
            return None  # memory is current (or newer — this process owns the job)
        events = db_data.pop("events", [])
        _memory_events[f"job:{job_id}:events"] = [json.dumps(e) for e in events]
        raw = json.dumps(db_data)
        _memory_store[f"job:{job_id}"] = raw
        return raw
    except Exception as e:
        logger.debug("job_refresh_failed", job_id=job_id, error=str(e))
        return None


async def _sync_to_supabase(job_id: str) -> None:
    """Synchronize local memory state to Supabase in the background."""
    raw_data = _memory_store.get(f"job:{job_id}")
    if not raw_data:
        return

    mem_events = _memory_events.get(f"job:{job_id}:events", [])
    events_json = [json.loads(e) for e in mem_events]
    data_json = json.loads(raw_data)

    # Bundle events inside the data for storage
    data_json["events"] = events_json

    def _run_sync():
        try:
            client = create_service_client()
            status_val = data_json.get("status", "queued")
            client.table("api_jobs").upsert({"id": job_id, "status": status_val, "job_data": data_json}).execute()
        except Exception as e:
            logger.debug("supabase_sync_skipped", error=str(e))

    asyncio.create_task(asyncio.to_thread(_run_sync))


async def reap_stale_jobs(max_age_minutes: int = 60) -> int:
    """Fail queued/processing jobs whose last update is older than ``max_age_minutes``.

    Replaces the old ``recover_stuck_jobs`` (which failed EVERY 'processing' job at API
    startup — wrong now that AI jobs legitimately run on the separate worker process across
    API restarts). A job orphaned by a lost enqueue, a worker crash, or a pre-hydration-fix
    silent no-op otherwise sits 'queued'/'processing' in ``api_jobs`` forever — keeping the
    Annotations "Processing" banner up for days. Runs periodically from the API lifespan.

    The threshold is deliberately generous: active jobs refresh ``updated_at`` on every
    progress/status write (at minimum once per deployment for AI jobs), so anything silent
    for an hour is genuinely dead. Returns the number of jobs reaped.
    """
    from datetime import timedelta  # noqa: PLC0415

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)).isoformat()

    def _run() -> int:
        client = create_service_client()
        resp = (
            client.table("api_jobs").select("id, job_data, updated_at").in_("status", [JobStatus.QUEUED.value, JobStatus.PROCESSING.value]).execute()
        )
        reaped = 0
        for row in resp.data or []:
            jd = row.get("job_data") or {}
            last = jd.get("updated_at") or row.get("updated_at") or ""
            if not last or last >= cutoff:
                continue
            jd["status"] = JobStatus.FAILED.value
            jd["error"] = f"Stalled: no progress for over {max_age_minutes} minutes."
            jd["message"] = "❌ Failed: the job stalled and was cleaned up automatically."
            jd["updated_at"] = datetime.now(timezone.utc).isoformat()
            client.table("api_jobs").update({"status": jd["status"], "job_data": jd}).eq("id", row["id"]).execute()
            # Keep this process's memory copy consistent so polls don't resurrect it.
            _memory_store[f"job:{row['id']}"] = json.dumps(jd)
            reaped += 1
            logger.warning("stale_job_reaped", job_id=row["id"], last_update=last, kind=jd.get("kind"))
        return reaped

    try:
        return await asyncio.to_thread(_run)
    except Exception as e:
        logger.warning("reap_stale_jobs_failed", error=str(e))
        return 0


async def create_job(
    user_id: Optional[str] = None,
    kind: Optional[str] = None,
    label: Optional[str] = None,
    deployment_ids: Optional[List[str]] = None,
) -> str:
    """Create a new job entry locally and sync to Supabase.

    ``user_id`` is stamped into ``job_data`` so the owner can list their own jobs
    (`api_jobs` has no owner column — see :func:`list_jobs`). ``kind`` is a coarse
    category ('upload', 'ai_pipeline', 'export', …) and ``label`` a human summary,
    both surfaced in the processing-history view. ``deployment_ids`` records which
    deployments the job touches so the Annotations grid can show a "being processed"
    banner for the deployments in view (see :func:`set_job_deployments` for jobs
    whose deployments are only known mid-run, like uploads).
    """
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    job_data = {
        "job_id": job_id,
        "status": JobStatus.QUEUED.value,
        "progress": 0.0,
        "created_at": now,
        "updated_at": now,
        "result_url": None,
        "error": None,
        "message": None,
        "current_phase": None,
        "summary": None,
        "user_id": user_id,
        "kind": kind,
        "label": label,
        "deployment_ids": deployment_ids or [],
        "_next_seq": 0,
    }

    _memory_store[f"job:{job_id}"] = json.dumps(job_data)
    await _sync_to_supabase(job_id)
    return job_id


async def set_job_deployments(job_id: str, deployment_ids: List[str]) -> None:
    """Record the deployments a job touches once they're known (best-effort).

    Uploads resolve their deployments mid-run (EXIF / folder binding after the file
    buffer), so they call this from the AI phase rather than at :func:`create_job`.
    """
    raw = await _get_raw(job_id)
    if not raw:
        return
    data = json.loads(raw)
    merged = sorted({*(data.get("deployment_ids") or []), *deployment_ids})
    data["deployment_ids"] = merged
    _memory_store[f"job:{job_id}"] = json.dumps(data)
    await _sync_to_supabase(job_id)


async def list_jobs(user_id: str, limit: int = 50) -> List[dict]:
    """Return summaries of a user's recent jobs (newest first), from Supabase.

    Scoped by ``job_data->>user_id`` because ``api_jobs`` has no owner column.
    Returns light summaries (no event lists) for the processing-history view;
    callers fetch full events per job via :func:`get_job`.
    """

    def _run() -> List[dict]:
        client = create_service_client()
        resp = (
            client.table("api_jobs")
            .select("id, status, job_data, created_at, updated_at")
            .eq("job_data->>user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        out: List[dict] = []
        for row in resp.data or []:
            jd = row.get("job_data") or {}
            out.append(
                {
                    "job_id": row["id"],
                    "status": row.get("status"),
                    "kind": jd.get("kind"),
                    "label": jd.get("label"),
                    "deployment_ids": jd.get("deployment_ids") or [],
                    "progress": jd.get("progress"),
                    "summary": jd.get("summary"),
                    "error": jd.get("error"),
                    "created_at": jd.get("created_at") or row.get("created_at"),
                    "updated_at": jd.get("updated_at") or row.get("updated_at"),
                    "event_count": len(jd.get("events") or []),
                }
            )
        return out

    try:
        return await asyncio.to_thread(_run)
    except Exception as e:
        logger.warning("list_jobs_failed", user_id=user_id, error=str(e))
        return []


async def find_queued_ai_jobs() -> List[dict]:
    """**Queued** ``ai_pipeline`` jobs → ``[{job_id, deployment_ids}]`` (from Supabase).

    Used to coalesce the upload flow's AI fan-out: a chunked upload (N batches) previously
    enqueued N annotate jobs for the *same* deployment, each paying the model's fixed
    per-run cost. Deployments covered by a still-queued AI job are skipped — that job
    fetches its media when it *starts*, so it will include the images just registered.
    (``processing`` jobs are deliberately excluded: they may have already fetched their
    media list and would miss later registrations.)
    """

    def _run() -> List[dict]:
        client = create_service_client()
        resp = client.table("api_jobs").select("id, job_data").eq("status", JobStatus.QUEUED.value).eq("job_data->>kind", "ai_pipeline").execute()
        out = []
        for row in resp.data or []:
            jd = row.get("job_data") or {}
            out.append({"job_id": row["id"], "deployment_ids": jd.get("deployment_ids") or []})
        return out

    try:
        return await asyncio.to_thread(_run)
    except Exception as e:
        logger.warning("find_queued_ai_jobs_failed", error=str(e))
        return []


async def get_job(job_id: str) -> Optional[JobInfo]:
    """Read current job state (memory-first, Supabase for cross-process freshness)."""
    raw = await _get_raw(job_id)
    if not raw:
        return None

    data = json.loads(raw)
    # A non-terminal job may be executing on another process (the ARQ worker) — pick up
    # its Supabase writes when they're newer than our memory copy.
    if data.get("status") in (JobStatus.QUEUED.value, JobStatus.PROCESSING.value):
        fresh = await asyncio.to_thread(_refresh_if_newer, job_id, data.get("updated_at"))
        if fresh:
            data = json.loads(fresh)

    event_key = f"job:{job_id}:events"
    mem_events = _memory_events.get(event_key, [])
    events = [json.loads(e) for e in mem_events[-MAX_EVENTS_RETURNED:]]

    data["events"] = events
    data["event_count"] = len(mem_events)
    data.pop("_next_seq", None)

    return JobInfo(**data)


async def update_job(
    job_id: str,
    *,
    status: Optional[JobStatus] = None,
    progress: Optional[float] = None,
    result_url: Optional[str] = None,
    error: Optional[str] = None,
    message: Optional[str] = None,
    current_phase: Optional[ProgressPhase] = None,
) -> None:
    raw = await _get_raw(job_id)
    if not raw:
        logger.warning("update_job_not_found", job_id=job_id)
        return

    data = json.loads(raw)
    if status is not None:
        data["status"] = status.value
    if progress is not None:
        data["progress"] = progress
    if result_url is not None:
        data["result_url"] = result_url
    if error is not None:
        data["error"] = error
    if message is not None:
        data["message"] = message
    if current_phase is not None:
        data["current_phase"] = current_phase.value

    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    _memory_store[f"job:{job_id}"] = json.dumps(data)

    # Background sync
    await _sync_to_supabase(job_id)


async def emit_event(job_id: str, event: ProgressEvent) -> None:
    event.job_id = job_id
    raw = await _get_raw(job_id)

    if raw:
        data = json.loads(raw)
        seq = data.get("_next_seq", 0)
        event.seq = seq
        data["_next_seq"] = seq + 1
        data["message"] = event.message
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        _memory_store[f"job:{job_id}"] = json.dumps(data)

    event_json = json.dumps(event.model_dump(mode="json"), default=str)
    event_key = f"job:{job_id}:events"
    _memory_events.setdefault(event_key, []).append(event_json)

    await _sync_to_supabase(job_id)


async def update_summary(
    job_id: str,
    *,
    total: Optional[int] = None,
    downloaded_inc: int = 0,
    uploaded_inc: int = 0,
    skipped_inc: int = 0,
    failed_inc: int = 0,
    started_at: Optional[datetime] = None,
) -> None:
    lock = _summary_locks.setdefault(job_id, asyncio.Lock())

    async with lock:
        raw = await _get_raw(job_id)
        if not raw:
            return

        data = json.loads(raw)
        summary = data.get("summary") or {
            "total": 0,
            "downloaded": 0,
            "uploaded": 0,
            "skipped": 0,
            "failed": 0,
            "started_at": None,
        }

        if total is not None:
            summary["total"] = total
        summary["downloaded"] += downloaded_inc
        summary["uploaded"] += uploaded_inc
        summary["skipped"] += skipped_inc
        summary["failed"] += failed_inc
        if started_at is not None:
            summary["started_at"] = started_at.isoformat()

        data["summary"] = summary
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        _memory_store[f"job:{job_id}"] = json.dumps(data)

    await _sync_to_supabase(job_id)


_PHASE_START_MSG = {
    ProgressPhase.DOWNLOAD: "📥 Downloading images from Azure Storage...",
    ProgressPhase.DRIVE_UPLOAD: "☁️ Uploading images to Google Drive...",
    ProgressPhase.CLEANUP: "🧹 Cleaning up temporary files from Azure Storage...",
}

_PHASE_COMPLETE_MSG = {
    ProgressPhase.DOWNLOAD: "📥 All images downloaded from Azure Storage ✓",
    ProgressPhase.DRIVE_UPLOAD: "☁️ All images uploaded to Google Drive ✓",
    ProgressPhase.CLEANUP: "🧹 Temporary files cleaned up from Azure Storage ✓",
}


async def start_phase(job_id: str, phase: ProgressPhase) -> None:
    await update_job(job_id, current_phase=phase)
    await emit_event(
        job_id,
        ProgressEvent(
            type=EventType.PHASE_START,
            phase=phase,
            message=_PHASE_START_MSG.get(phase, f"Starting {phase.value}..."),
        ),
    )


async def complete_phase(job_id: str, phase: ProgressPhase) -> None:
    await emit_event(
        job_id,
        ProgressEvent(
            type=EventType.PHASE_COMPLETE,
            phase=phase,
            message=_PHASE_COMPLETE_MSG.get(phase, f"{phase.value} complete"),
        ),
    )
