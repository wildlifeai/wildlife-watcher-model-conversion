# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""CVAT REST API client and pull-mode annotation ingestion.

Phase 3A: removes FiftyOne from the writeback path entirely.

Why this matters
----------------
The Phase 1/2 webhook handler reads completed annotations from the FiftyOne
dataset (MongoDB). If the FiftyOne process restarts between job completion
and webhook delivery, the detections are gone and writeback fails.

This module pulls annotations directly from CVAT's REST API, which persists
independently of FiftyOne. Writeback is now reliable even if FiftyOne is
restarted, or if the webhook is delivered hours after completion.

The FiftyOne path (sync_cvat_job_to_supabase) is kept as a fallback for
scenarios where CVAT REST API is unavailable.

CVAT shape format
-----------------
Rectangle shapes come as [x1, y1, x2, y2] in absolute pixel coordinates.
We normalise to [x, y, w, h] relative to frame dimensions:
    bbox_x = x1 / frame_width
    bbox_y = y1 / frame_height
    bbox_w = (x2 - x1) / frame_width
    bbox_h = (y2 - y1) / frame_height
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import structlog

from app.services.supabase_client import create_service_client
from app.services.cvat_service import (
    SOURCE_PRIORITY,
    check_snapshot_staleness,
    upsert_annotation_version,
)

logger = structlog.get_logger()

_CVAT_TOKEN_CACHE: dict[str, str] = {}  # url → token (in-process cache)


# ─────────────────────────────────────────────────────────────────────────────
# CVAT REST API client
# ─────────────────────────────────────────────────────────────────────────────

class CvatRestClient:
    """Thin async wrapper around the CVAT v2 REST API.

    Authentication:
        Uses token-based auth (DRF `Token <hex>`).
        Token is obtained via POST /api/auth/token/login and cached in-process.
        On 401, cache is cleared and login is retried once.
    """

    def __init__(self, cvat_url: str, username: str, password: str):
        self.base = cvat_url.rstrip("/")
        self.username = username
        self.password = password
        self._token: str | None = _CVAT_TOKEN_CACHE.get(cvat_url)

    async def _login(self) -> None:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{self.base}/api/auth/token/login",
                json={"username": self.username, "password": self.password},
            )
            resp.raise_for_status()
            self._token = resp.json()["token"]
            _CVAT_TOKEN_CACHE[self.base] = self._token
            logger.info("cvat_rest_login_ok", url=self.base)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Token {self._token}",
            "Accept": "application/json",
        }

    async def _get(self, path: str, **params) -> Any:
        """GET with one automatic re-login on 401."""
        if not self._token:
            await self._login()

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base}{path}",
                headers=self._headers(),
                params=params,
            )
            if resp.status_code == 401:
                _CVAT_TOKEN_CACHE.pop(self.base, None)
                await self._login()
                resp = await client.get(
                    f"{self.base}{path}",
                    headers=self._headers(),
                    params=params,
                )
            resp.raise_for_status()
            return resp.json()

    async def _delete(self, path: str) -> None:
        if not self._token:
            await self._login()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.delete(
                f"{self.base}{path}",
                headers=self._headers(),
            )
            if resp.status_code == 401:
                _CVAT_TOKEN_CACHE.pop(self.base, None)
                await self._login()
                resp = await client.delete(
                    f"{self.base}{path}",
                    headers=self._headers(),
                )
            resp.raise_for_status()

    # ── High-level helpers ─────────────────────────────────────────────────

    async def get_job_annotations(self, cvat_job_id: int) -> dict:
        """Fetch all shapes for a CVAT job.

        Returns CVAT annotation payload:
          {shapes: [...], tags: [...], tracks: [...]}

        Shape (rectangle) format:
          {id, frame, type:"rectangle", points:[x1,y1,x2,y2],
           label_id, attributes:[{spec_id, value}], occluded}
        """
        return await self._get(f"/api/jobs/{cvat_job_id}/annotations")

    async def get_task_frame_meta(self, cvat_task_id: int) -> list[dict]:
        """Fetch per-frame image dimensions for a task.

        Returns list of {width, height, name, has_related_context}.
        Index corresponds to frame number.
        """
        resp = await self._get(f"/api/tasks/{cvat_task_id}/data/meta")
        return resp.get("frames", [])

    async def get_task_labels(self, cvat_task_id: int) -> dict[int, str]:
        """Map CVAT label_id → label_name for a task.

        Returns {label_id: scientific_name}
        """
        task = await self._get(f"/api/tasks/{cvat_task_id}")
        labels = task.get("labels", []) or task.get("project", {}).get("labels", [])
        return {lbl["id"]: lbl["name"] for lbl in labels}

    async def get_job_detail(self, cvat_job_id: int) -> dict:
        return await self._get(f"/api/jobs/{cvat_job_id}")

    async def delete_task(self, cvat_task_id: int) -> None:
        await self._delete(f"/api/tasks/{cvat_task_id}")


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3A: pull_annotations_from_cvat_api
# ─────────────────────────────────────────────────────────────────────────────

async def pull_annotations_from_cvat_api(
    *,
    cvat_task_id: int,
    cvat_job_id: int,
    cvat_client: CvatRestClient,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Fetch completed annotations from CVAT REST API and write to Supabase.

    This replaces the FiftyOne-based sync_cvat_job_to_supabase() for reliability.
    FiftyOne is NOT required to be running.

    Steps:
      1. Resolve annotation_targets for this (task, job) pair
      2. Fetch frame dimensions from CVAT task metadata
      3. Fetch shapes from CVAT job annotations endpoint
      4. Build frame_index → shapes map
      5. For each annotation_target, upsert_annotation_version() for its shapes
      6. Mark targets synced / failed

    Returns: {synced, failed, pulled_shapes}
    """
    svc = create_service_client()

    # 1. Resolve targets
    targets_resp = (
        svc.table("annotation_targets")
        .select(
            "id, media_id, observation_id, annotation_job_id, "
            "deployment_id, cvat_frame_index, status, dataset_name"
        )
        .eq("cvat_task_id", cvat_task_id)
        .eq("cvat_job_id", cvat_job_id)
        .execute()
    )
    targets = targets_resp.data or []
    if not targets:
        logger.warning("cvat_pull_no_targets", task=cvat_task_id, job=cvat_job_id)
        return {"synced": 0, "failed": 0, "pulled_shapes": 0}

    annotation_job_id = targets[0]["annotation_job_id"]
    deployment_id = targets[0]["deployment_id"]

    # Phase 2: staleness check
    stale = await check_snapshot_staleness(annotation_job_id, deployment_id, svc)
    if stale:
        svc.table("annotation_jobs").update({
            "error_message": (
                "⚠ Deployment data changed after annotation job was created. "
                "Review synced annotations before publishing."
            )
        }).eq("id", annotation_job_id).execute()

    # Skip already-synced targets
    pending_targets = [
        t for t in targets
        if t.get("status") in ("pending", "assigned", "annotating", "failed")
    ]
    if not pending_targets:
        return {"synced": 0, "failed": 0, "pulled_shapes": 0, "note": "all already synced"}

    # 2. Fetch frame dimensions
    try:
        frames_meta = await cvat_client.get_task_frame_meta(cvat_task_id)
    except Exception as exc:
        logger.error("cvat_pull_meta_failed", task=cvat_task_id, error=str(exc))
        frames_meta = []

    def _frame_dims(frame_idx: int) -> tuple[int, int]:
        if frame_idx < len(frames_meta):
            return frames_meta[frame_idx].get("width", 1), frames_meta[frame_idx].get("height", 1)
        return 1, 1

    # 3. Fetch label map
    try:
        label_map = await cvat_client.get_task_labels(cvat_task_id)
    except Exception as exc:
        logger.warning("cvat_pull_labels_failed", task=cvat_task_id, error=str(exc))
        label_map = {}

    # 4. Fetch all shapes for this job
    try:
        annotations = await cvat_client.get_job_annotations(cvat_job_id)
    except Exception as exc:
        logger.error("cvat_pull_annotations_failed", job=cvat_job_id, error=str(exc))
        return {"synced": 0, "failed": len(pending_targets), "pulled_shapes": 0}

    shapes = annotations.get("shapes", [])
    tracks = annotations.get("tracks", [])

    # Expand tracks into per-frame shapes
    track_shapes: list[dict] = []
    for track in tracks:
        for shape in track.get("shapes", []):
            track_shapes.append({**shape, "label_id": track.get("label_id")})
    all_shapes = shapes + track_shapes

    # Group shapes by frame index
    shapes_by_frame: dict[int, list[dict]] = {}
    for shape in all_shapes:
        f = shape.get("frame", 0)
        shapes_by_frame.setdefault(f, []).append(shape)

    # 5. Process each pending target
    synced = 0
    failed = 0
    total_shape_count = 0

    for target in pending_targets:
        frame_idx = target["cvat_frame_index"]
        frame_shapes = shapes_by_frame.get(frame_idx, [])
        frame_w, frame_h = _frame_dims(frame_idx)

        try:
            annotation_ids: list[str] = []

            for shape in frame_shapes:
                shape_type = shape.get("type", "")
                pts = shape.get("points", [])

                # Normalise bounding box
                bbox = None
                if shape_type == "rectangle" and len(pts) >= 4:
                    x1, y1, x2, y2 = pts[:4]
                    bbox = {
                        "x": x1 / frame_w,
                        "y": y1 / frame_h,
                        "w": (x2 - x1) / frame_w,
                        "h": (y2 - y1) / frame_h,
                    }
                elif shape_type == "skeleton":
                    # Skeletons: take bounding box of all points
                    xs = pts[0::2]
                    ys = pts[1::2]
                    if xs and ys:
                        bbox = {
                            "x": min(xs) / frame_w,
                            "y": min(ys) / frame_h,
                            "w": (max(xs) - min(xs)) / frame_w,
                            "h": (max(ys) - min(ys)) / frame_h,
                        }

                # Extract label
                label_id = shape.get("label_id")
                scientific_name = label_map.get(label_id, f"label_{label_id}")

                # Extract custom attributes (confidence_level etc.)
                attrs = {
                    a.get("spec_id", "attr"): a.get("value")
                    for a in (shape.get("attributes") or [])
                }
                confidence_level = attrs.get("confidence_level", "certain")
                confidence_map = {"certain": 0.95, "probable": 0.75, "uncertain": 0.45}
                confidence = confidence_map.get(str(confidence_level).lower(), 0.75)

                # source_ref = CVAT shape ID (idempotency key)
                source_ref = f"cvat-shape-{shape.get('id', 'unknown')}"

                result = await asyncio.to_thread(
                    upsert_annotation_version,
                    observation_id=target["observation_id"],
                    source="cvat",
                    bbox=bbox,
                    scientific_name=scientific_name,
                    confidence=confidence,
                    created_by=user_id,
                    annotation_job_id=annotation_job_id,
                    annotation_target_id=target["id"],
                    source_ref=source_ref,
                    attributes=attrs,
                    svc=svc,
                )
                annotation_ids.append(result["annotation_id"])
                total_shape_count += 1

            # Mark target synced
            svc.table("annotation_targets").update({
                "status": "synced",
                "synced_at": "now()",
                "error_message": None,
                "cvat_shape_ids": [int(s.get("id")) for s in frame_shapes if s.get("id")],
            }).eq("id", target["id"]).execute()
            synced += 1

        except Exception as exc:
            logger.error(
                "cvat_pull_target_failed",
                target=target["id"],
                frame=frame_idx,
                error=str(exc),
            )
            svc.table("annotation_targets").update({
                "status": "failed",
                "error_message": str(exc),
            }).eq("id", target["id"]).execute()
            failed += 1

    # Update annotation_job
    svc.table("annotation_jobs").update({
        "observations_updated": synced,
        "status": "synced" if failed == 0 else "failed",
        "synced_at": "now()" if synced > 0 else None,
        "writeback_method": "cvat_rest",  # audit which path was used
    }).eq("id", annotation_job_id).execute()

    logger.info(
        "cvat_pull_complete",
        task=cvat_task_id,
        job=cvat_job_id,
        synced=synced,
        failed=failed,
        shapes=total_shape_count,
    )
    return {"synced": synced, "failed": failed, "pulled_shapes": total_shape_count}


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3B: CVAT pre-auth session token
# ─────────────────────────────────────────────────────────────────────────────

async def get_cvat_session_token(cvat_url: str, username: str, password: str) -> str:
    """Obtain a CVAT REST API token for the service account.

    Used to generate pre-authenticated CVAT task URLs so annotators
    do not need to manually log in.

    Returns the raw token string (caller constructs the URL).
    """
    client = CvatRestClient(cvat_url, username, password)
    if not client._token:
        await client._login()
    return client._token  # type: ignore[return-value]
