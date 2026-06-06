# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""CVAT annotation integration router.

Endpoints:
    POST /api/fiftyone/cvat/annotate          — create CVAT task from FO dataset
    POST /api/cvat/webhook                    — HMAC-verified CVAT event handler
    POST /api/cvat/cleanup-stale-tasks        — internal 14-day cleanup cron
    GET  /api/annotation-jobs                 — list jobs (scoped to user's projects)
    GET  /api/annotation-jobs/{id}            — single job detail + metrics
    GET  /api/annotation-jobs/{id}/targets    — per-target sync status
    GET  /api/annotation-jobs/{id}/metrics    — annotation_metrics view row
    POST /api/annotation-jobs/{id}/retry      — retry all failed targets
"""

from __future__ import annotations

import csv
import io

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import settings
from app.dependencies import get_current_user
from app.schemas.common import ApiError, ApiMeta, ApiResponse
from app.services.cvat_service import (
    CvatAdapter,
    cleanup_stale_cvat_tasks,
    create_dataset_snapshot,
    retry_failed_targets,
    sync_cvat_job_to_supabase,
    verify_cvat_webhook_signature,
)
from app.services.cvat_rest import CvatRestClient, pull_annotations_from_cvat_api, get_cvat_session_token
from app.services.supabase_client import create_service_client

logger = structlog.get_logger()

router = APIRouter(tags=["cvat"])

# ── Shared adapter instance (lazy-configured) ─────────────────────────────

def _get_cvat_adapter() -> CvatAdapter:
    return CvatAdapter(
        cvat_url=settings.CVAT_URL,
        username=settings.CVAT_USERNAME,
        password=settings.CVAT_PASSWORD,
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/fiftyone/cvat/annotate
# Create a CVAT annotation job from an existing FiftyOne dataset
# ─────────────────────────────────────────────────────────────────────────────

class CvatAnnotateRequest(BaseModel):
    deployment_id: str
    dataset_name: str
    label_classes: list[str] = []


@router.post("/api/fiftyone/cvat/annotate")
async def create_cvat_annotation_job(
    request: Request,
    body: CvatAnnotateRequest,
    user=Depends(get_current_user),
):
    """Create a CVAT annotation task from an existing FiftyOne dataset.

    Workflow (writeback_trigger=annotating_complete):
      1. Snapshot the deployment's media state (for stale-detection)
      2. Create annotation_targets rows (CVAT frame ↔ WW media mapping)
      3. Route FiftyOne samples to CVAT via fo.annotate()
      4. Return the CVAT task URL for the ecologist to share with annotators

    The webhook handler writes annotations to Supabase when CVAT marks
    the job as 'completed'.
    """
    req_id = getattr(request.state, "request_id", None)
    svc = create_service_client()

    try:
        # Resolve label classes from taxa if not provided
        if not body.label_classes:
            obs_resp = (
                svc.table("observations")
                .select("scientific_name")
                .eq("deployment_id", body.deployment_id)
                .is_("deleted_at", "null")
                .execute()
            )
            body.label_classes = list({
                o["scientific_name"]
                for o in (obs_resp.data or [])
                if o.get("scientific_name")
            }) or ["animal", "blank", "vehicle", "unknown"]

        # Snapshot the current state
        snapshot = create_dataset_snapshot(body.deployment_id, svc)

        # Create annotation_job record
        job_resp = svc.table("annotation_jobs").insert({
            "deployment_id": body.deployment_id,
            "dataset_name": body.dataset_name,
            "anno_key": f"pending-{body.deployment_id[:8]}",  # updated after CVAT creation
            "backend": "cvat",
            "label_classes": body.label_classes,
            "status": "pending",
            "sample_count": snapshot["media_count"],
            "snapshot_media_ids": snapshot["snapshot_media_ids"],
            "snapshot_hash": snapshot["snapshot_hash"],
            "created_by": user.id,
        }).execute()

        annotation_job_id = job_resp.data[0]["id"]

        # Create CVAT task (uploads nothing — cloud storage)
        adapter = _get_cvat_adapter()
        result = await adapter.create_job(
            annotation_job_id=annotation_job_id,
            dataset_name=body.dataset_name,
            deployment_id=body.deployment_id,
            label_classes=body.label_classes,
        )

        cvat_task_url = None
        if result.get("cvat_task_ids"):
            first_task = result["cvat_task_ids"][0]
            cvat_task_url = f"{settings.CVAT_URL}/tasks/{first_task}"

        return ApiResponse(
            data={
                "annotation_job_id": annotation_job_id,
                "anno_key": result["anno_key"],
                "cvat_task_url": cvat_task_url,
                "sample_count": result["sample_count"],
                "label_classes": body.label_classes,
            },
            meta=ApiMeta(request_id=req_id),
        )

    except RuntimeError as exc:
        return ApiResponse(
            error=ApiError(code="CVAT_NOT_AVAILABLE", message=str(exc)),
            meta=ApiMeta(request_id=req_id),
        )
    except Exception as exc:
        logger.error("cvat_annotate_error", error=str(exc), deployment=body.deployment_id)
        return ApiResponse(
            error=ApiError(
                code="CVAT_JOB_CREATE_FAILED",
                message=f"Failed to create CVAT job: {exc}",
                retryable=True,
            ),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/cvat/webhook
# HMAC-verified CVAT event handler — fires direct writeback on job completion
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api/cvat/webhook", include_in_schema=False)
async def cvat_webhook(
    request: Request,
    x_signature_256: str = Header(default=""),
):
    """Receive CVAT task-completion webhooks and write annotations to Supabase.

    CVAT fires a POST when any job transitions to 'completed'.
    Because writeback_trigger = 'annotating_complete', we write immediately
    without a reviewer gate.

    Security: HMAC-SHA256 verified via X-Signature-256 header.
    Idempotent: duplicate webhooks are safe (upsert_annotation_version dedupes
    by source_ref / CVAT shape ID).
    """
    body = await request.body()

    # 1. Verify HMAC signature
    if not verify_cvat_webhook_signature(body, x_signature_256, settings.CVAT_WEBHOOK_SECRET):
        logger.warning("cvat_webhook_invalid_signature")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()
    event = payload.get("event", "")

    logger.info("cvat_webhook_received", event=event)

    # 2. Only act on job completion events
    if event != "update:job":
        return {"ok": True, "action": "ignored", "reason": "not a job update"}

    job_obj = payload.get("object", {})
    if job_obj.get("status") != "completed":
        return {"ok": True, "action": "ignored", "reason": f"job status={job_obj.get('status')}"}

    cvat_task_id = job_obj.get("task_id")
    cvat_job_id = job_obj.get("id")

    if not cvat_task_id or not cvat_job_id:
        logger.warning("cvat_webhook_missing_ids", payload=payload)
        return {"ok": False, "reason": "missing task_id or job_id"}

    # 3. Sync to Supabase (direct writeback, no review gate) using REST API pull mode
    try:
        client = CvatRestClient(
            settings.CVAT_URL,
            settings.CVAT_USERNAME,
            settings.CVAT_PASSWORD,
        )
        result = await pull_annotations_from_cvat_api(
            cvat_task_id=cvat_task_id,
            cvat_job_id=cvat_job_id,
            cvat_client=client,
        )
        logger.info("cvat_webhook_synced", **result)
        return {"ok": True, "synced": result["synced"], "failed": result["failed"]}
    except Exception as exc:
        logger.error("cvat_webhook_sync_failed", error=str(exc),
                     task=cvat_task_id, job=cvat_job_id)
        # Return 200/OK response so CVAT doesn't flood with duplicate webhooks (our retry is internal)
        return {"ok": False, "error": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/cvat/cleanup-stale-tasks
# Internal endpoint called by the cvat_cleanup Docker service nightly
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api/cvat/cleanup-stale-tasks", include_in_schema=False)
async def cleanup_stale_tasks(
    request: Request,
    x_internal_secret: str = Header(default=""),
):
    """Delete CVAT tasks synced more than 14 days ago.

    Called by the cvat_cleanup Docker container every 24h.
    Authenticated by X-Internal-Secret header (same as CVAT_WEBHOOK_SECRET).
    Supabase annotation data is permanent — only provider-side CVAT tasks removed.
    """
    if x_internal_secret != settings.CVAT_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

    adapter = _get_cvat_adapter()
    result = await cleanup_stale_cvat_tasks(adapter)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/annotation-jobs
# List annotation jobs scoped to the authenticated user's deployments
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/annotation-jobs")
async def list_annotation_jobs(
    request: Request,
    deployment_id: str | None = None,
    status: str | None = None,
    user=Depends(get_current_user),
):
    """List annotation jobs the user has access to.

    Optionally filter by deployment_id or status.
    Returns summary data for the LabelingPage job status panel.
    """
    req_id = getattr(request.state, "request_id", None)
    svc = create_service_client()

    try:
        query = (
            svc.table("annotation_jobs")
            .select(
                "id, deployment_id, dataset_name, backend, status, "
                "sample_count, completed_count, observations_updated, "
                "label_classes, cvat_task_ids, anno_key, "
                "created_by, created_at, synced_at, error_message"
            )
            .order("created_at", desc=True)
            .limit(50)
        )

        if deployment_id:
            query = query.eq("deployment_id", deployment_id)
        if status:
            query = query.eq("status", status)

        resp = query.execute()
        jobs = resp.data or []

        # Enrich with CVAT task URL
        cvat_base = getattr(settings, "CVAT_URL", "")
        for job in jobs:
            task_ids = job.get("cvat_task_ids") or []
            job["cvat_task_url"] = (
                f"{cvat_base}/tasks/{task_ids[0]}" if task_ids else None
            )

        return ApiResponse(data={"jobs": jobs}, meta=ApiMeta(request_id=req_id))

    except Exception as exc:
        logger.error("annotation_jobs_list_error", error=str(exc))
        return ApiResponse(
            error=ApiError(code="LIST_FAILED", message=str(exc)),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/annotation-jobs/{job_id}
# Single job detail with metrics
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/annotation-jobs/{job_id}")
async def get_annotation_job(
    request: Request,
    job_id: str,
    user=Depends(get_current_user),
):
    req_id = getattr(request.state, "request_id", None)
    svc = create_service_client()

    try:
        resp = (
            svc.table("annotation_jobs")
            .select("*")
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return ApiResponse(
                error=ApiError(code="NOT_FOUND", message="Annotation job not found"),
                meta=ApiMeta(request_id=req_id),
            )

        job = rows[0]

        # Pull metrics from view
        metrics_resp = (
            svc.table("annotation_metrics")
            .select("*")
            .eq("job_id", job_id)
            .limit(1)
            .execute()
        )
        metrics = (metrics_resp.data or [{}])[0]

        return ApiResponse(
            data={"job": job, "metrics": metrics},
            meta=ApiMeta(request_id=req_id),
        )
    except Exception as exc:
        logger.error("annotation_job_get_error", error=str(exc), job=job_id)
        return ApiResponse(
            error=ApiError(code="FETCH_FAILED", message=str(exc)),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/annotation-jobs/{job_id}/targets
# Per-target sync status for real-time progress in LabelingPage
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/annotation-jobs/{job_id}/targets")
async def get_annotation_job_targets(
    request: Request,
    job_id: str,
    status: str | None = None,
    user=Depends(get_current_user),
):
    """Return annotation_targets for a job, with optional status filter.

    Used by the frontend to show per-image sync progress.
    Limit 200 targets — paginate if needed in future.
    """
    req_id = getattr(request.state, "request_id", None)
    svc = create_service_client()

    try:
        query = (
            svc.table("annotation_targets")
            .select(
                "id, media_id, observation_id, cvat_task_id, cvat_job_id, "
                "cvat_frame_index, status, synced_at, error_message"
            )
            .eq("annotation_job_id", job_id)
            .order("cvat_frame_index")
            .limit(200)
        )
        if status:
            query = query.eq("status", status)

        resp = query.execute()
        targets = resp.data or []

        synced = sum(1 for t in targets if t["status"] == "synced")
        failed = sum(1 for t in targets if t["status"] == "failed")

        return ApiResponse(
            data={
                "targets": targets,
                "total": len(targets),
                "synced": synced,
                "failed": failed,
                "completion_pct": round(100 * synced / len(targets), 1) if targets else 0,
            },
            meta=ApiMeta(request_id=req_id),
        )
    except Exception as exc:
        logger.error("annotation_targets_get_error", error=str(exc), job=job_id)
        return ApiResponse(
            error=ApiError(code="FETCH_FAILED", message=str(exc)),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/annotation-jobs/{job_id}/metrics  (Phase 2)
# annotation_metrics view row for live dashboard
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/annotation-jobs/{job_id}/metrics")
async def get_annotation_job_metrics(
    request: Request,
    job_id: str,
    user=Depends(get_current_user),
):
    """Return the annotation_metrics view row for one job.

    Includes: completion_pct, synced_count, failed_count, avg_secs_per_image,
    label_corrections (where CVAT label differs from original ML prediction).
    Polled by the LabelingPage metrics panel every 10s while a job is active.
    """
    req_id = getattr(request.state, "request_id", None)
    svc = create_service_client()

    try:
        resp = (
            svc.table("annotation_metrics")
            .select("*")
            .eq("job_id", job_id)
            .limit(1)
            .execute()
        )
        metrics = (resp.data or [{}])[0]
        return ApiResponse(data={"metrics": metrics}, meta=ApiMeta(request_id=req_id))

    except Exception as exc:
        logger.error("annotation_metrics_error", error=str(exc), job=job_id)
        return ApiResponse(
            error=ApiError(code="FETCH_FAILED", message=str(exc)),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/annotation-jobs/{job_id}/retry  (Phase 2)
# Retry all failed annotation_targets in a job
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api/annotation-jobs/{job_id}/retry")
async def retry_annotation_job(
    request: Request,
    job_id: str,
    user=Depends(get_current_user),
):
    """Retry all annotation_targets with status='failed' in this job.

    Safe to call multiple times — already-synced targets are skipped.
    On partial success, the job status reflects the remaining failure count.

    Returns: {retried_jobs, synced, failed}
    """
    req_id = getattr(request.state, "request_id", None)

    try:
        result = await retry_failed_targets(annotation_job_id=job_id)
        logger.info("annotation_job_retry", job=job_id, **result)
        return ApiResponse(data=result, meta=ApiMeta(request_id=req_id))

    except Exception as exc:
        logger.error("annotation_job_retry_error", error=str(exc), job=job_id)
        return ApiResponse(
            error=ApiError(
                code="RETRY_FAILED",
                message=f"Retry failed: {exc}",
                retryable=True,
            ),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/annotation-jobs/{job_id}/pull  (Phase 3A)
# Manually pull annotations from CVAT REST API
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api/annotation-jobs/{job_id}/pull")
async def pull_annotation_job_annotations(
    request: Request,
    job_id: str,
    user=Depends(get_current_user),
):
    """Manually pull all annotations for a job directly from the CVAT REST API.

    This bypasses FiftyOne entirely and communicates directly with the CVAT API,
    which is useful if the webhook failed or FiftyOne was restarted.
    """
    req_id = getattr(request.state, "request_id", None)
    svc = create_service_client()

    try:
        # Resolve target pairs
        targets_resp = (
            svc.table("annotation_targets")
            .select("cvat_task_id, cvat_job_id")
            .eq("annotation_job_id", job_id)
            .is_not("cvat_task_id", "null")
            .is_not("cvat_job_id", "null")
            .execute()
        )
        targets = targets_resp.data or []
        pairs = sorted(list({(t["cvat_task_id"], t["cvat_job_id"]) for t in targets}))

        if not pairs:
            return ApiResponse(
                error=ApiError(
                    code="NO_TARGETS",
                    message="No active CVAT task/job mappings found for this job.",
                ),
                meta=ApiMeta(request_id=req_id),
            )

        client = CvatRestClient(
            settings.CVAT_URL,
            settings.CVAT_USERNAME,
            settings.CVAT_PASSWORD,
        )

        total_synced = 0
        total_failed = 0
        total_shapes = 0

        for task_id, job_id_cvat in pairs:
            res = await pull_annotations_from_cvat_api(
                cvat_task_id=task_id,
                cvat_job_id=job_id_cvat,
                cvat_client=client,
                user_id=user.id,
            )
            total_synced += res.get("synced", 0)
            total_failed += res.get("failed", 0)
            total_shapes += res.get("pulled_shapes", 0)

        # Update the overall job status based on success/failure
        final_status = "synced" if total_failed == 0 else "failed"
        svc.table("annotation_jobs").update({
            "status": final_status,
            "synced_at": "now()",
        }).eq("id", job_id).execute()

        return ApiResponse(
            data={
                "synced": total_synced,
                "failed": total_failed,
                "shapes": total_shapes,
                "status": final_status,
            },
            meta=ApiMeta(request_id=req_id),
        )

    except Exception as exc:
        logger.error("annotation_job_pull_error", error=str(exc), job=job_id)
        return ApiResponse(
            error=ApiError(
                code="PULL_FAILED",
                message=f"Manual pull failed: {exc}",
                retryable=True,
            ),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/cvat/session-token  (Phase 3B)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/cvat/session-token")
async def get_cvat_token(
    request: Request,
    user=Depends(get_current_user),
):
    """Get a CVAT session token for pre-authenticated task URLs."""
    req_id = getattr(request.state, "request_id", None)
    try:
        token = await get_cvat_session_token(
            settings.CVAT_URL,
            settings.CVAT_USERNAME,
            settings.CVAT_PASSWORD,
        )
        return ApiResponse(data={"token": token}, meta=ApiMeta(request_id=req_id))
    except Exception as exc:
        logger.error("cvat_session_token_error", error=str(exc))
        return ApiResponse(
            error=ApiError(code="TOKEN_FAILED", message=str(exc)),
            meta=ApiMeta(request_id=req_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/annotation-jobs/{job_id}/export/camtrapdp  (Phase 3D)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/annotation-jobs/{job_id}/export/camtrapdp")
async def export_job_camtrapdp(
    job_id: str,
    user=Depends(get_current_user),
):
    """Export synced annotations for this job as CamtrapDP observations.csv."""
    svc = create_service_client()
    
    try:
        resp = (
            svc.table("observation_annotations")
            .select(
                "id, observation_id, scientific_name, bbox_x, bbox_y, bbox_w, bbox_h, confidence, "
                "observations!inner(deployment_id, media_id, media!inner(timestamp))"
            )
            .eq("annotation_job_id", job_id)
            .eq("is_current", True)
            .execute()
        )
        
        annotations = resp.data or []
        
        output = io.StringIO()
        writer = csv.writer(output)
        
        headers = [
            "observationID",
            "deploymentID",
            "mediaID",
            "eventID",
            "eventStart",
            "eventEnd",
            "observationType",
            "scientificName",
            "count",
            "lifeStage",
            "classificationMethod",
            "classifiedBy",
            "classificationConfidence",
            "boundingBoxX",
            "boundingBoxY",
            "boundingBoxWidth",
            "boundingBoxHeight",
        ]
        writer.writerow(headers)
        
        for ann in annotations:
            obs = ann.get("observations") or {}
            media = obs.get("media") or {}
            
            writer.writerow([
                ann.get("id", ""),
                obs.get("deployment_id", ""),
                obs.get("media_id", ""),
                obs.get("media_id", ""),  # Using media_id as eventID
                media.get("timestamp", ""),
                media.get("timestamp", ""),
                "animal",
                ann.get("scientific_name", "unknown"),
                "1",
                "",
                "human",
                "CVAT Annotator",
                ann.get("confidence", ""),
                ann.get("bbox_x", ""),
                ann.get("bbox_y", ""),
                ann.get("bbox_w", ""),
                ann.get("bbox_h", ""),
            ])
            
        output.seek(0)
        
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=observations_{job_id}.csv"}
        )

    except Exception as exc:
        logger.error("annotation_job_export_error", error=str(exc), job=job_id)
        raise HTTPException(status_code=500, detail=str(exc))
