# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Wildlife Brain router — DINOv3 embeddings, clusters, similarity.

Thin HTTP layer (envelope responses); all logic in domain/wildlife_brain.py and
the Qdrant service. Gated behind ``FF_WILDLIFE_BRAIN_ENABLED``.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, Query, Request

from app.config import settings
from app.dependencies import get_current_user
from app.schemas.brain import ConfirmClusterRequest, EmbedRequest, ReprocessAllRequest, ReprocessRequest, ReviewDecisionRequest
from app.schemas.common import ApiError, ApiMeta, ApiResponse
from app.services.supabase_client import create_service_client

logger = structlog.get_logger()

router = APIRouter(prefix="/api/brain", tags=["brain"])


def _disabled(req_id):
    return ApiResponse(
        error=ApiError(code="FEATURE_DISABLED", message="Wildlife Brain is disabled (FF_WILDLIFE_BRAIN_ENABLED)."),
        meta=ApiMeta(request_id=req_id),
    )


def _al_disabled(req_id):
    return ApiResponse(
        error=ApiError(code="FEATURE_DISABLED", message="Active learning is disabled (FF_ACTIVE_LEARNING_ENABLED)."),
        meta=ApiMeta(request_id=req_id),
    )


@router.post("/embed/{deployment_id}")
async def embed_deployment(request: Request, deployment_id: str, body: EmbedRequest | None = None, user=Depends(get_current_user)):
    """Embed + cluster a deployment. Server mode enqueues a GPU job."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)
    body = body or EmbedRequest()

    if body.mode == "client_vectors":
        if not settings.FF_LOCAL_EMBEDDING_ENABLED:
            return ApiResponse(
                error=ApiError(code="FEATURE_DISABLED", message="Local embedding disabled (FF_LOCAL_EMBEDDING_ENABLED)."),
                meta=ApiMeta(request_id=req_id),
            )
        return ApiResponse(
            error=ApiError(code="NOT_IMPLEMENTED", message="client_vectors ingestion lands in the WebGPU slice."),
            meta=ApiMeta(request_id=req_id),
        )

    from app.jobs.dispatch import enqueue_job
    from app.jobs.store import create_job

    job_id = await create_job()
    await enqueue_job("embed_deployment_job", job_id, deployment_id, body.model_name)
    return ApiResponse(
        data={"job_id": job_id, "status": "queued", "deployment_id": deployment_id},
        meta=ApiMeta(request_id=req_id),
    )


@router.get("/clusters/{deployment_id}")
async def list_clusters(request: Request, deployment_id: str, user=Depends(get_current_user)):
    """List HDBSCAN clusters for the deployment's latest embedding run."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    svc = create_service_client()

    def _fetch():
        latest = (
            svc.table("embedding_runs")
            .select("id")
            .eq("deployment_id", deployment_id)
            .eq("status", "complete")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if not latest.data:
            return None, []
        run_id = latest.data[0]["id"]
        clusters = (
            svc.table("cluster_assignments")
            .select("*")
            .eq("deployment_id", deployment_id)
            .eq("embedding_run_id", run_id)
            .order("image_count", desc=True)
            .execute()
        )
        return run_id, clusters.data or []

    run_id, clusters = await asyncio.to_thread(_fetch)
    return ApiResponse(data={"embedding_run_id": run_id, "clusters": clusters}, meta=ApiMeta(request_id=req_id))


@router.get("/umap/{deployment_id}")
async def umap_coords(request: Request, deployment_id: str, user=Depends(get_current_user)):
    """UMAP scatter data for the deployment (stable persisted coords)."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    svc = create_service_client()

    def _fetch():
        resp = (
            svc.table("media_embeddings")
            .select("media_id, umap_x, umap_y, cluster_id, is_outlier, cluster_purity")
            .eq("deployment_id", deployment_id)
            .execute()
        )
        return resp.data or []

    points = await asyncio.to_thread(_fetch)
    return ApiResponse(data={"points": points, "count": len(points)}, meta=ApiMeta(request_id=req_id))


@router.get("/outliers/{deployment_id}")
async def list_outliers(request: Request, deployment_id: str, user=Depends(get_current_user)):
    """HDBSCAN-rejected images (candidate expert-review queue)."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    svc = create_service_client()

    def _fetch():
        resp = (
            svc.table("media_embeddings")
            .select("media_id, cluster_confidence")
            .eq("deployment_id", deployment_id)
            .eq("is_outlier", True)
            .order("cluster_confidence", desc=False)
            .execute()
        )
        return resp.data or []

    rows = await asyncio.to_thread(_fetch)
    return ApiResponse(data={"outliers": rows, "count": len(rows)}, meta=ApiMeta(request_id=req_id))


@router.get("/similar/{media_id}")
async def similar(request: Request, media_id: str, n: int = Query(20, ge=1, le=100), org_scoped: bool = True, user=Depends(get_current_user)):
    """Qdrant nearest-neighbour search for a media item."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    from app.services.qdrant_client import get_qdrant_service

    svc = create_service_client()

    def _run_model():
        me = svc.table("media_embeddings").select("embedding_run_id").eq("media_id", media_id).maybe_single().execute()
        run_id = (me.data or {}).get("embedding_run_id")
        if not run_id:
            return None
        run = svc.table("embedding_runs").select("model_name").eq("id", run_id).maybe_single().execute()
        return (run.data or {}).get("model_name")

    model_name = await asyncio.to_thread(_run_model)
    qdrant = get_qdrant_service(model_name)  # variant collection (falls back to default)
    vector = await qdrant.retrieve_vector(media_id)
    if vector is None:
        return ApiResponse(error=ApiError(code="NOT_FOUND", message="No embedding for this media"), meta=ApiMeta(request_id=req_id))

    # +1 then drop self.
    results = await qdrant.search(vector, limit=n + 1)
    hits = [{"media_id": r.id, "score": r.score, "payload": r.payload} for r in results if r.id != media_id][:n]
    return ApiResponse(data={"media_id": media_id, "results": hits}, meta=ApiMeta(request_id=req_id))


@router.post("/clusters/{cluster_assignment_id}/confirm")
async def confirm_cluster(request: Request, cluster_assignment_id: str, body: ConfirmClusterRequest, user=Depends(get_current_user)):
    """Confirm a cluster as a taxon — bulk-creates human observations for members."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    svc = create_service_client()
    now = datetime.now(timezone.utc).isoformat()

    def _confirm():
        ca = svc.table("cluster_assignments").select("*").eq("id", cluster_assignment_id).maybe_single().execute()
        if not ca.data:
            return None, 0
        assignment = ca.data
        members = (
            svc.table("media_embeddings")
            .select("media_id")
            .eq("deployment_id", assignment["deployment_id"])
            .eq("embedding_run_id", assignment["embedding_run_id"])
            .eq("cluster_id", assignment["cluster_id"])
            .execute()
        )
        obs_rows = [
            {
                "deployment_id": assignment["deployment_id"],
                "media_id": m["media_id"],
                "observation_level": "media",
                "observation_type": "animal",
                "taxon_id": body.taxon_id,
                "scientific_name": body.scientific_name,
                "vernacular_name": body.vernacular_name,
                "source_type": "human",
                "review_status": "human_reviewed",
                "classification_method": "human",
                "reviewer_id": user.id,
                "embedding_run_id": assignment["embedding_run_id"],
                "cluster_id": assignment["cluster_id"],
            }
            for m in (members.data or [])
        ]
        for i in range(0, len(obs_rows), 50):
            svc.table("observations").insert(obs_rows[i : i + 50]).execute()

        svc.table("cluster_assignments").update(
            {
                "taxon_id": body.taxon_id,
                "scientific_name": body.scientific_name,
                "review_state": "confirmed",
                "confirmed_by": user.id,
                "confirmed_at": now,
            }
        ).eq("id", cluster_assignment_id).execute()
        return assignment, len(obs_rows)

    assignment, created = await asyncio.to_thread(_confirm)
    if assignment is None:
        return ApiResponse(error=ApiError(code="NOT_FOUND", message="Cluster assignment not found"), meta=ApiMeta(request_id=req_id))
    return ApiResponse(
        data={"cluster_assignment_id": cluster_assignment_id, "observations_created": created},
        meta=ApiMeta(request_id=req_id),
    )


# ── Embedding lifecycle (Phase 5.5) ──────────────────────────────────


@router.get("/embedding-runs/{deployment_id}")
async def embedding_runs(request: Request, deployment_id: str, user=Depends(get_current_user)):
    """List embedding runs for a deployment (model version, status, image count)."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    from app.domain.embedding_lifecycle import list_embedding_runs

    runs = await list_embedding_runs(deployment_id)
    return ApiResponse(data={"runs": runs}, meta=ApiMeta(request_id=req_id))


@router.post("/reprocess/deployment/{deployment_id}")
async def reprocess_deployment_endpoint(request: Request, deployment_id: str, body: ReprocessRequest | None = None, user=Depends(get_current_user)):
    """Supersede current runs and re-embed a deployment (new embedding_run)."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)
    body = body or ReprocessRequest()

    from app.jobs.dispatch import enqueue_job
    from app.jobs.store import create_job

    job_id = await create_job()
    await enqueue_job("reprocess_deployment_job", job_id, deployment_id, body.model_name)
    return ApiResponse(data={"job_id": job_id, "status": "queued", "deployment_id": deployment_id}, meta=ApiMeta(request_id=req_id))


@router.post("/reprocess/project/{project_id}")
async def reprocess_project_endpoint(request: Request, project_id: str, body: ReprocessRequest | None = None, user=Depends(get_current_user)):
    """Reprocess all deployments in a project."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)
    body = body or ReprocessRequest()

    from app.jobs.dispatch import enqueue_job
    from app.jobs.store import create_job

    job_id = await create_job()
    await enqueue_job("reprocess_project_job", job_id, project_id, body.model_name)
    return ApiResponse(data={"job_id": job_id, "status": "queued", "project_id": project_id}, meta=ApiMeta(request_id=req_id))


@router.post("/reprocess/all")
async def reprocess_all_endpoint(request: Request, body: ReprocessAllRequest | None = None, user=Depends(get_current_user)):
    """Platform-wide re-embed. Default dry-run returns a cost estimate; executing requires confirm=true."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)
    body = body or ReprocessAllRequest()

    if body.dry_run or not body.confirm:
        from app.domain.embedding_lifecycle import reprocess_all

        estimate = await reprocess_all(model_name=body.model_name, dry_run=True)
        if not body.dry_run and not body.confirm:
            estimate["note"] = "Set confirm=true (and dry_run=false) to execute this global re-embed."
        return ApiResponse(data=estimate, meta=ApiMeta(request_id=req_id))

    from app.jobs.dispatch import enqueue_job
    from app.jobs.store import create_job

    job_id = await create_job()
    await enqueue_job("reprocess_all_job", job_id, body.model_name)
    return ApiResponse(data={"job_id": job_id, "status": "queued", "scope": "global"}, meta=ApiMeta(request_id=req_id))


@router.get("/compare-runs")
async def compare_runs_endpoint(request: Request, run_a: str = Query(...), run_b: str = Query(...), user=Depends(get_current_user)):
    """Compare cluster assignments between two embedding runs."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    from app.domain.embedding_lifecycle import compare_runs

    result = await compare_runs(run_a, run_b)
    return ApiResponse(data=result, meta=ApiMeta(request_id=req_id))


# ── Active learning + review queue (Phase 8) ─────────────────────────


@router.post("/recalculate-al-scores/{deployment_id}")
async def recalculate_al_scores(request: Request, deployment_id: str, user=Depends(get_current_user)):
    """Enqueue an active-learning score recompute for a deployment."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_ACTIVE_LEARNING_ENABLED:
        return _al_disabled(req_id)

    from app.jobs.dispatch import enqueue_job
    from app.jobs.store import create_job

    job_id = await create_job()
    await enqueue_job("recompute_al_job", job_id, deployment_id)
    return ApiResponse(data={"job_id": job_id, "status": "queued", "deployment_id": deployment_id}, meta=ApiMeta(request_id=req_id))


@router.get("/review-queue/{deployment_id}")
async def review_queue(request: Request, deployment_id: str, limit: int = Query(50, ge=1, le=200), user=Depends(get_current_user)):
    """Media ranked by active_learning_score DESC, with AI label + score reasons."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_ACTIVE_LEARNING_ENABLED:
        return _al_disabled(req_id)

    from app.domain.active_learning import get_review_queue

    rows = await get_review_queue(deployment_id, limit)
    return ApiResponse(data={"queue": rows, "count": len(rows)}, meta=ApiMeta(request_id=req_id))


@router.post("/review/{media_id}")
async def review_media(request: Request, media_id: str, body: ReviewDecisionRequest, user=Depends(get_current_user)):
    """Record a reviewer decision on one media item (creates a human observation)."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    svc = create_service_client()
    review_status = "expert_reviewed" if body.decision == "expert" else "human_reviewed"

    def _write():
        m = svc.table("media").select("deployment_id").eq("id", media_id).maybe_single().execute()
        if not m.data:
            return False
        svc.table("observations").insert(
            {
                "deployment_id": m.data["deployment_id"],
                "media_id": media_id,
                "observation_level": "media",
                "observation_type": "animal",
                "taxon_id": body.taxon_id,
                "scientific_name": body.scientific_name,
                "vernacular_name": body.vernacular_name,
                "source_type": "human",
                "review_status": review_status,
                "classification_method": "human",
                "reviewer_id": user.id,
            }
        ).execute()
        return True

    ok = await asyncio.to_thread(_write)
    if not ok:
        return ApiResponse(error=ApiError(code="NOT_FOUND", message="Media not found"), meta=ApiMeta(request_id=req_id))
    return ApiResponse(data={"media_id": media_id, "decision": body.decision, "review_status": review_status}, meta=ApiMeta(request_id=req_id))


@router.post("/backup")
async def backup_qdrant_endpoint(request: Request, user=Depends(get_current_user)):
    """Enqueue a Qdrant snapshot → private Supabase Storage backup (DR)."""
    req_id = getattr(request.state, "request_id", None)
    if not settings.FF_WILDLIFE_BRAIN_ENABLED:
        return _disabled(req_id)

    from app.jobs.dispatch import enqueue_job
    from app.jobs.store import create_job

    job_id = await create_job()
    await enqueue_job("qdrant_backup_job", job_id)
    return ApiResponse(data={"job_id": job_id, "status": "queued"}, meta=ApiMeta(request_id=req_id))
