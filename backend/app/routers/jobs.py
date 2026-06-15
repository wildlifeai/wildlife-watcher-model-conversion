# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Job status polling endpoints.

GET /api/jobs            → the authenticated user's recent jobs (processing history)
GET /api/jobs/{id}       → current status + progress
GET /api/jobs/{id}/result → download or signed URL (when completed)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.dependencies import get_current_user
from app.jobs.store import get_job, list_jobs
from app.schemas.common import ApiMeta, ApiResponse

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
async def list_user_jobs(
    request: Request,
    user=Depends(get_current_user),
    limit: int = Query(50, ge=1, le=200),
):
    """List the authenticated user's recent processing jobs (newest first).

    Powers the avatar-menu "Processing history" view so a user can see whether a
    past upload / AI run finished or failed after the live dock has gone away.
    Scoped to the caller — only jobs stamped with their ``user_id`` are returned.
    """
    jobs = await list_jobs(user.id, limit=limit)
    return ApiResponse(
        data={"jobs": jobs},
        meta=ApiMeta(request_id=getattr(request.state, "request_id", None)),
    )


@router.get("/{job_id}")
async def get_job_status(job_id: str, request: Request):
    """Poll the current status of an async job."""
    job = await get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return ApiResponse(
        data=job.model_dump(),
        meta=ApiMeta(request_id=getattr(request.state, "request_id", None)),
    )


@router.get("/{job_id}/result")
async def get_job_result(job_id: str, request: Request):
    """Get the result of a completed job (download URL or streamed file)."""
    job = await get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status.value not in ("completed", "completed_with_errors"):
        raise HTTPException(
            status_code=409,
            detail=f"Job is not completed (current status: {job.status.value})",
        )

    if not job.result_url:
        raise HTTPException(
            status_code=404,
            detail="Job completed but result is no longer available",
        )

    return ApiResponse(
        data={"result_url": job.result_url},
        meta=ApiMeta(request_id=getattr(request.state, "request_id", None)),
    )
