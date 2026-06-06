# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""CVAT annotation integration service.

Implements the AnnotationProviderAdapter interface for CVAT.
All permanent data is written to Supabase; CVAT is annotation staging only.

Architecture:
    Supabase → FiftyOne → CVAT (annotators draw bboxes)
                       ← webhook fires on job completion
    Supabase ← upsert_annotation_version() (idempotent)

Decision record (2026-06-05):
    - writeback_trigger = "annotating_complete" (no reviewer gate)
    - CVAT task retention = 14 days after writeback
    - CVAT hosted on same Docker host as WW backend
    - Images served from Azure Blob via signed SAS (no CVAT upload)
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import io
import json
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any
import structlog
from PIL import Image, ImageOps

from app.services.supabase_client import create_service_client

logger = structlog.get_logger()

# Lazy FiftyOne import (heavyweight optional dependency)
_fo = None


def _ensure_fiftyone() -> None:
    global _fo
    if _fo is not None:
        return
    try:
        import fiftyone as fo
        _fo = fo
    except ImportError as exc:
        raise RuntimeError(
            "fiftyone is not installed. Run: pip install fiftyone"
        ) from exc


# ── Priority map (mirrors DB generated column) ─────────────────────────────

SOURCE_PRIORITY: dict[str, int] = {
    "ml_model":   1,
    "camtrapdp":  2,
    "cvat":       3,
    "ww_canvas":  4,
    "qa_review":  5,
}

def sanitise_for_annotation(image_bytes: bytes) -> bytes:
    """Strip EXIF metadata (including GPS) from an image to ensure privacy before serving to annotators.
    Applies EXIF rotation before stripping to ensure bounding boxes map correctly.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img_clean = ImageOps.exif_transpose(img)
            out_buf = io.BytesIO()
            img_clean.save(out_buf, format=img.format or 'JPEG')
            return out_buf.getvalue()
    except Exception as e:
        logger.warning("sanitise_for_annotation_failed", error=str(e))
        return image_bytes



# ─────────────────────────────────────────────────────────────────────────────
# Abstract provider interface
# ─────────────────────────────────────────────────────────────────────────────

class AnnotationProviderAdapter(ABC):
    """All annotation backends must implement this interface.

    CVAT is the current implementation.  Label Studio, FiftyOne Enterprise,
    or any future tool must satisfy the same contract so WW business logic
    never couples to a specific provider.
    """

    @abstractmethod
    async def create_job(
        self,
        *,
        annotation_job_id: str,
        dataset_name: str,
        deployment_id: str,
        label_classes: list[str],
    ) -> dict[str, Any]:
        """Upload samples and create annotation job.

        Returns:
            {
                "anno_key": str,
                "cvat_task_ids": list[int],
                "sample_count": int,
            }
        """

    @abstractmethod
    async def get_job_status(self, annotation_job_id: str) -> str:
        """Return current workflow status string."""

    @abstractmethod
    async def delete_job(self, annotation_job_id: str) -> None:
        """Delete the provider-side job (called after 14-day retention)."""


# ─────────────────────────────────────────────────────────────────────────────
# CVAT adapter
# ─────────────────────────────────────────────────────────────────────────────

class CvatAdapter(AnnotationProviderAdapter):
    """FiftyOne-backed CVAT annotation integration.

    Uses fo.annotate() to create CVAT tasks and fo.load_annotations()
    to retrieve completed shapes.  Images are served from Azure Blob
    via signed SAS tokens — CVAT never stores a copy (upload_media=False).
    """

    def __init__(self, cvat_url: str, username: str, password: str):
        self.cvat_url = cvat_url
        self.username = username
        self.password = password
        self._configured = False

    def _configure(self) -> None:
        if self._configured:
            return
        _ensure_fiftyone()
        try:
            import fiftyone.utils.cvat as fouc
            fouc.login(
                url=self.cvat_url,
                username=self.username,
                password=self.password,
            )
            self._configured = True
            logger.info("cvat_configured", url=self.cvat_url)
        except Exception as exc:
            raise RuntimeError(f"Failed to connect to CVAT at {self.cvat_url}: {exc}") from exc

    async def create_job(
        self,
        *,
        annotation_job_id: str,
        dataset_name: str,
        deployment_id: str,
        label_classes: list[str],
    ) -> dict[str, Any]:
        """Create annotation targets and CVAT task from FiftyOne dataset."""
        self._configure()
        svc = create_service_client()

        # 1. Create per-sample annotation_targets rows (mapping table)
        targets_result = await create_annotation_targets(
            dataset_name=dataset_name,
            annotation_job_id=annotation_job_id,
            deployment_id=deployment_id,
            svc=svc,
        )
        logger.info("annotation_targets_created", **targets_result)

        # 2. Send to CVAT via FiftyOne
        anno_key = f"ww-anno-{annotation_job_id[:8]}-{int(time.time())}"

        def _annotate():
            dataset = _fo.load_dataset(dataset_name)
            view = dataset.match_tags("unreviewed").sort_by(["observation_event_id", "timestamp"])

            results = view.annotate(
                anno_key,
                label_schema={
                    "detections": {
                        "type": "detections",
                        "classes": label_classes,
                        "attributes": {
                            "confidence_level": {
                                "type": "select",
                                "values": ["certain", "probable", "uncertain"],
                                "default": "certain",
                                "mutable": True,
                            }
                        },
                    }
                },
                backend="cvat",
                project_name=f"WW-{deployment_id[:8]}",
                task_size=50,
                segment_size=10,
                upload_media=False,   # Images served from Azure Blob
                chunk_type="video",
                track_id_field="observation_event_id",
            )

            # Persist anno_key on dataset for recovery after restart
            dataset.info["cvat_anno_key"] = anno_key
            dataset.info["annotation_job_id"] = annotation_job_id
            dataset.save()

            return results

        results = await asyncio.to_thread(_annotate)

        # 3. Write CVAT task/job/frame IDs back to annotation_targets
        task_ids = list(results.task_to_jobs.keys()) if hasattr(results, "task_to_jobs") else []
        await asyncio.to_thread(
            populate_cvat_ids,
            annotation_job_id=annotation_job_id,
            cvat_results=results,
            svc=svc,
        )

        # 4. Update annotation_job with CVAT task IDs and anno_key
        svc.table("annotation_jobs").update({
            "anno_key": anno_key,
            "cvat_task_ids": task_ids,
            "status": "assigned",
        }).eq("id", annotation_job_id).execute()

        return {
            "anno_key": anno_key,
            "cvat_task_ids": task_ids,
            "sample_count": targets_result["targets_created"],
        }

    async def get_job_status(self, annotation_job_id: str) -> str:
        svc = create_service_client()
        resp = (
            svc.table("annotation_jobs")
            .select("status")
            .eq("id", annotation_job_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0]["status"] if rows else "unknown"

    async def delete_job(self, annotation_job_id: str) -> None:
        """Delete CVAT task after 14-day retention period."""
        svc = create_service_client()
        resp = (
            svc.table("annotation_jobs")
            .select("anno_key, cvat_task_ids")
            .eq("id", annotation_job_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return

        anno_key = rows[0].get("anno_key")
        if anno_key:
            self._configure()

            def _delete():
                dataset_list = _fo.list_datasets()
                for ds_name in dataset_list:
                    ds = _fo.load_dataset(ds_name)
                    if ds.info.get("cvat_anno_key") == anno_key:
                        try:
                            ds.delete_annotation_run(anno_key)
                            logger.info("cvat_task_deleted", anno_key=anno_key)
                        except Exception as exc:
                            logger.warning("cvat_task_delete_failed", anno_key=anno_key, error=str(exc))
                        break

            await asyncio.to_thread(_delete)

        # Mark job as cleaned up (targets + annotation_annotations persist)
        svc.table("annotation_jobs").update({
            "status": "synced",
            "error_message": None,
        }).eq("id", annotation_job_id).execute()


# ─────────────────────────────────────────────────────────────────────────────
# Dataset snapshot
# ─────────────────────────────────────────────────────────────────────────────

def create_dataset_snapshot(deployment_id: str, svc) -> dict[str, Any]:
    """Freeze current media + observation state as a content-addressed hash.

    The snapshot is stored on annotation_jobs.snapshot_hash.
    Before writeback, compare current hash vs snapshot_hash to detect
    if the deployment changed while annotation was in progress.

    Returns:
        {
            "snapshot_media_ids": list[str],
            "snapshot_hash": str (SHA-256),
            "media_count": int,
        }
    """
    media_resp = (
        svc.table("media")
        .select("id")
        .eq("deployment_id", deployment_id)
        .is_("deleted_at", "null")
        .order("timestamp")
        .execute()
    )
    media_ids = [m["id"] for m in (media_resp.data or [])]

    obs_resp = (
        svc.table("observations")
        .select("id")
        .eq("deployment_id", deployment_id)
        .is_("deleted_at", "null")
        .execute()
    )
    obs_ids = [o["id"] for o in (obs_resp.data or [])]

    content = json.dumps(
        {"media": sorted(media_ids), "obs": sorted(obs_ids)},
        sort_keys=True,
    ).encode()
    snapshot_hash = hashlib.sha256(content).hexdigest()

    return {
        "snapshot_media_ids": media_ids,
        "snapshot_hash": snapshot_hash,
        "media_count": len(media_ids),
    }


def check_snapshot_staleness(annotation_job_id: str, deployment_id: str, svc) -> bool:
    """Returns True if deployment changed since the annotation snapshot was taken."""
    resp = (
        svc.table("annotation_jobs")
        .select("snapshot_hash")
        .eq("id", annotation_job_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return False

    original_hash = rows[0].get("snapshot_hash")
    if not original_hash:
        return False

    current = create_dataset_snapshot(deployment_id, svc)
    stale = current["snapshot_hash"] != original_hash
    if stale:
        logger.warning(
            "annotation_snapshot_stale",
            job=annotation_job_id,
            deployment=deployment_id,
        )
    return stale


# ─────────────────────────────────────────────────────────────────────────────
# annotation_targets population
# ─────────────────────────────────────────────────────────────────────────────

def create_annotation_targets(
    *,
    dataset_name: str,
    annotation_job_id: str,
    deployment_id: str,
    svc,
) -> dict[str, int]:
    """Create one annotation_targets row per FiftyOne sample.

    This establishes the CVAT frame_index ↔ Supabase media_id mapping
    BEFORE the CVAT task is created, so webhook sync is unambiguous.

    Call this synchronously inside asyncio.to_thread if needed.
    """
    _ensure_fiftyone()
    dataset = _fo.load_dataset(dataset_name)
    view = dataset.match_tags("unreviewed")

    targets = []
    for frame_idx, sample in enumerate(view.iter_samples(progress=False)):
        targets.append({
            "annotation_job_id": annotation_job_id,
            "deployment_id": deployment_id,
            "media_id": sample.get("media_id") or sample.get("ww_media_id"),
            "observation_id": sample.get("observation_id"),
            "dataset_name": dataset_name,
            "fiftyone_sample_id": str(sample.id),
            "cvat_frame_index": frame_idx,
            "status": "pending",
        })

    if targets:
        # Chunk to avoid supabase payload limits
        chunk_size = 500
        for i in range(0, len(targets), chunk_size):
            svc.table("annotation_targets").insert(targets[i:i + chunk_size]).execute()

    return {"targets_created": len(targets)}


def populate_cvat_ids(*, annotation_job_id: str, cvat_results, svc) -> None:
    """Write CVAT task_id / job_id back to annotation_targets after fo.annotate().

    FiftyOne returns a results object with task_to_jobs mapping.
    We iterate over frame ranges to set the right CVAT IDs per target.
    """
    if not hasattr(cvat_results, "task_to_jobs"):
        logger.warning("populate_cvat_ids_no_task_map", job=annotation_job_id)
        return

    for task_id, jobs in cvat_results.task_to_jobs.items():
        for job in jobs:
            start = getattr(job, "start_frame", 0)
            stop = getattr(job, "stop_frame", start)
            for frame_idx in range(start, stop + 1):
                svc.table("annotation_targets").update({
                    "cvat_task_id": task_id,
                    "cvat_job_id": getattr(job, "id", None),
                    "status": "assigned",
                }).eq("annotation_job_id", annotation_job_id).eq(
                    "cvat_frame_index", frame_idx
                ).execute()


# ─────────────────────────────────────────────────────────────────────────────
# Annotation version writer (idempotent)
# ─────────────────────────────────────────────────────────────────────────────

def upsert_annotation_version(
    *,
    observation_id: str,
    source: str,
    bbox: dict[str, float] | None,
    scientific_name: str | None,
    confidence: float | None,
    created_by: str | None,
    annotation_job_id: str | None,
    annotation_target_id: str | None,
    source_ref: str | None,
    attributes: dict | None,
    svc,
) -> dict[str, Any]:
    """Append a new immutable annotation version and make it current.

    Safe to call multiple times — idempotent because:
    - source_ref (CVAT shape ID) uniqueness prevents exact duplicates
    - Priority check prevents lower-priority sources overwriting higher ones

    Returns: {"annotation_id": str, "version": int, "became_current": bool}
    """
    new_priority = SOURCE_PRIORITY.get(source, 0)

    # Check if an identical source_ref already exists (idempotency guard)
    if source_ref:
        existing = (
            svc.table("observation_annotations")
            .select("id, version")
            .eq("observation_id", observation_id)
            .eq("source_ref", source_ref)
            .limit(1)
            .execute()
        )
        if existing.data:
            row = existing.data[0]
            logger.info("annotation_already_exists", ref=source_ref, obs=observation_id)
            return {"annotation_id": row["id"], "version": row["version"], "became_current": False}

    # Get current version
    existing_versions = (
        svc.table("observation_annotations")
        .select("id, version, priority, is_current, source")
        .eq("observation_id", observation_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    existing_rows = existing_versions.data or []
    next_version = (existing_rows[0]["version"] + 1) if existing_rows else 1

    current_row = next(
        (r for r in existing_rows if r.get("is_current")),
        existing_rows[0] if existing_rows else None,
    )
    current_priority = current_row["priority"] if current_row else 0
    current_id = current_row["id"] if current_row else None

    # Determine if this new version should become current
    becomes_current = new_priority >= current_priority

    # De-flag old current
    if becomes_current and current_id:
        svc.table("observation_annotations").update({
            "is_current": False
        }).eq("id", current_id).execute()

    # Insert new version
    new_id = str(uuid.uuid4())
    svc.table("observation_annotations").insert({
        "id": new_id,
        "observation_id": observation_id,
        "version": next_version,
        "parent_id": current_id,
        "source": source,
        "scientific_name": scientific_name,
        "bbox_x": bbox.get("x") if bbox else None,
        "bbox_y": bbox.get("y") if bbox else None,
        "bbox_w": bbox.get("w") if bbox else None,
        "bbox_h": bbox.get("h") if bbox else None,
        "confidence": confidence,
        "attributes": attributes or {},
        "is_current": becomes_current,
        "created_by": created_by,
        "annotation_job_id": annotation_job_id,
        "annotation_target_id": annotation_target_id,
        "source_ref": source_ref,
    }).execute()

    logger.info(
        "annotation_version_created",
        obs=observation_id,
        source=source,
        version=next_version,
        became_current=becomes_current,
    )
    return {"annotation_id": new_id, "version": next_version, "became_current": becomes_current}


# ─────────────────────────────────────────────────────────────────────────────
# EXIF sanitiser (strip GPS before sending to CVAT)
# ─────────────────────────────────────────────────────────────────────────────

_GPS_EXIF_KEYS = frozenset({
    "GPSLatitude", "GPSLongitude", "GPSAltitude",
    "GPSLatitudeRef", "GPSLongitudeRef", "GPSAltitudeRef",
    "GPS GPSLatitude", "GPS GPSLongitude", "GPS GPSAltitude",
    "GPSInfo", "GPS",
})


def sanitise_media_row_for_annotation(media_row: dict) -> dict:
    """Remove location-sensitive EXIF fields before sending to CVAT.

    Wildlife trap locations are sensitive. Annotators should not see GPS
    coordinates embedded in image metadata.
    """
    sanitised = dict(media_row)
    raw_exif = sanitised.get("exif_metadata") or {}
    if raw_exif:
        clean_exif = {k: v for k, v in raw_exif.items() if k not in _GPS_EXIF_KEYS}
        sanitised["exif_metadata"] = clean_exif
    return sanitised


# ─────────────────────────────────────────────────────────────────────────────
# Webhook-triggered writeback
# ─────────────────────────────────────────────────────────────────────────────

async def sync_cvat_job_to_supabase(
    *,
    cvat_task_id: int,
    cvat_job_id: int,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Write completed CVAT annotations directly to Supabase.

    Called by the webhook handler when CVAT job status = 'completed'.
    writeback_trigger = 'annotating_complete' — no reviewer gate.

    Steps:
      1. Resolve annotation_targets for this CVAT job
      2. For each target, load the FiftyOne sample's current detections
      3. upsert_annotation_version() for each detection
      4. Mark annotation_target.status = 'synced'

    Returns: {"synced": int, "failed": int}
    """
    svc = create_service_client()

    # 1. Resolve targets for this CVAT job
    targets_resp = (
        svc.table("annotation_targets")
        .select(
            "id, media_id, observation_id, annotation_job_id, "
            "fiftyone_sample_id, dataset_name, deployment_id, cvat_frame_index"
        )
        .eq("cvat_job_id", cvat_job_id)
        .eq("cvat_task_id", cvat_task_id)
        .execute()
    )
    targets = targets_resp.data or []

    if not targets:
        logger.warning("cvat_webhook_no_targets", task=cvat_task_id, job=cvat_job_id)
        return {"synced": 0, "failed": 0}

    annotation_job_id = targets[0]["annotation_job_id"]
    deployment_id = targets[0]["deployment_id"]

    # ── Phase 2: Staleness check ──────────────────────────────────────────────
    # Warn if the deployment changed while annotation was in progress.
    # We proceed anyway (don't block writeback) but surface the warning
    # on the job record so ecologists can see it in the UI.
    stale = await asyncio.to_thread(
        check_snapshot_staleness, annotation_job_id, deployment_id, svc
    )
    if stale:
        svc.table("annotation_jobs").update({
            "error_message": (
                "⚠ Deployment data changed after annotation job was created. "
                "Some annotation_target mappings may be incorrect. "
                "Review synced annotations before publishing."
            )
        }).eq("id", annotation_job_id).execute()

    # ── Phase 2: Skip already-synced targets (makes retries idempotent) ───────
    # On retry we only re-process targets that are still pending/failed.
    targets = [
        t for t in targets
        if t.get("status") in ("pending", "assigned", "annotating", "failed")
    ]
    if not targets:
        logger.info("cvat_sync_all_already_synced", task=cvat_task_id, job=cvat_job_id)
        return {"synced": 0, "failed": 0, "skipped": "all already synced"}

    # Group by dataset_name to avoid reloading
    dataset_name = targets[0]["dataset_name"]

    def _get_fo_annotations(sample_id: str) -> list[dict]:
        try:
            _ensure_fiftyone()
            dataset = _fo.load_dataset(dataset_name)
            sample = dataset[sample_id]
            detections = sample.get("detections")
            if detections is None:
                return []
            result = []
            for det in (detections.detections or []):
                bbox = det.bounding_box  # [x, y, w, h] normalised
                result.append({
                    "label": det.label,
                    "bbox": {"x": bbox[0], "y": bbox[1], "w": bbox[2], "h": bbox[3]} if bbox else None,
                    "confidence": getattr(det, "confidence", None),
                    "shape_id": str(getattr(det, "id", uuid.uuid4())),
                    "attributes": {
                        k: v for k, v in (det.attributes or {}).items()
                    },
                })
            return result
        except Exception as exc:
            logger.warning("fo_sample_load_failed", sample=sample_id, error=str(exc))
            return []

    synced = 0
    failed = 0

    for target in targets:
        try:
            fo_annotations = await asyncio.to_thread(
                _get_fo_annotations, target["fiftyone_sample_id"]
            )

            if not fo_annotations:
                # No annotations drawn — mark synced with no write
                svc.table("annotation_targets").update({
                    "status": "synced",
                    "synced_at": "now()",
                    "cvat_shape_ids": [],
                }).eq("id", target["id"]).execute()
                synced += 1
                continue

            annotation_ids = []
            for ann in fo_annotations:
                result = await asyncio.to_thread(
                    upsert_annotation_version,
                    observation_id=target["observation_id"],
                    source="cvat",
                    bbox=ann["bbox"],
                    scientific_name=ann["label"],
                    confidence=ann.get("confidence"),
                    created_by=user_id,
                    annotation_job_id=target["annotation_job_id"],
                    annotation_target_id=target["id"],
                    source_ref=ann["shape_id"],
                    attributes=ann.get("attributes"),
                    svc=svc,
                )
                annotation_ids.append(result["annotation_id"])

            # Mark target as synced
            svc.table("annotation_targets").update({
                "status": "synced",
                "synced_at": "now()",
                "cvat_shape_ids": [int(a) for a in annotation_ids if str(a).isdigit()],
            }).eq("id", target["id"]).execute()

            synced += 1

        except Exception as exc:
            logger.error(
                "cvat_target_sync_failed",
                target=target["id"],
                media=target["media_id"],
                error=str(exc),
            )
            svc.table("annotation_targets").update({
                "status": "failed",
                "error_message": str(exc),
            }).eq("id", target["id"]).execute()
            failed += 1

    # Update annotation_job counts
    svc.table("annotation_jobs").update({
        "observations_updated": synced,
        "status": "synced" if failed == 0 else "failed",
        "synced_at": "now()" if synced > 0 else None,
    }).eq("id", targets[0]["annotation_job_id"]).execute()

    logger.info("cvat_job_sync_complete", task=cvat_task_id, synced=synced, failed=failed)
    return {"synced": synced, "failed": failed}


# ─────────────────────────────────────────────────────────────────────────────
# 14-day CVAT task cleanup
# ─────────────────────────────────────────────────────────────────────────────

async def cleanup_stale_cvat_tasks(cvat_adapter: CvatAdapter) -> dict[str, Any]:
    """Delete CVAT tasks that were synced more than 14 days ago.

    annotation_targets and observation_annotations rows in Supabase
    are kept permanently — only the CVAT provider-side task is removed.
    """
    svc = create_service_client()

    stale_resp = (
        svc.table("annotation_jobs")
        .select("id, anno_key")
        .eq("status", "synced")
        .lt("synced_at", "NOW() - INTERVAL '14 days'")
        .execute()
    )
    stale_jobs = stale_resp.data or []

    deleted = 0
    for job in stale_jobs:
        try:
            await cvat_adapter.delete_job(job["id"])
            deleted += 1
        except Exception as exc:
            logger.warning("cvat_cleanup_failed", job=job["id"], error=str(exc))

    logger.info("cvat_cleanup_complete", deleted=deleted, checked=len(stale_jobs))
    return {"deleted": deleted, "checked": len(stale_jobs)}



# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: Retry failed annotation targets
# ─────────────────────────────────────────────────────────────────────────────

async def retry_failed_targets(annotation_job_id: str) -> dict[str, Any]:
    """Re-run writeback for all failed annotation_targets in a job.

    Fetches all targets with status='failed', groups by (cvat_task_id, cvat_job_id)
    and calls sync_cvat_job_to_supabase for each unique pair.
    Safe to call multiple times — already-synced targets are skipped.

    Returns: {"retried_jobs": int, "synced": int, "failed": int}
    """
    svc = create_service_client()

    failed_resp = (
        svc.table("annotation_targets")
        .select("cvat_task_id, cvat_job_id")
        .eq("annotation_job_id", annotation_job_id)
        .eq("status", "failed")
        .execute()
    )
    failed_targets = failed_resp.data or []

    if not failed_targets:
        logger.info("retry_no_failed_targets", job=annotation_job_id)
        return {"retried_jobs": 0, "synced": 0, "failed": 0}

    # Deduplicate by (task_id, job_id) pairs
    pairs: set[tuple[int, int]] = {
        (t["cvat_task_id"], t["cvat_job_id"])
        for t in failed_targets
        if t.get("cvat_task_id") and t.get("cvat_job_id")
    }

    total_synced = 0
    total_failed = 0

    for task_id, job_id in pairs:
        result = await sync_cvat_job_to_supabase(
            cvat_task_id=task_id,
            cvat_job_id=job_id,
        )
        total_synced += result.get("synced", 0)
        total_failed += result.get("failed", 0)

    logger.info(
        "retry_complete",
        job=annotation_job_id,
        pairs=len(pairs),
        synced=total_synced,
        failed=total_failed,
    )
    return {"retried_jobs": len(pairs), "synced": total_synced, "failed": total_failed}


# ─────────────────────────────────────────────────────────────────────────────
# HMAC webhook verification utility
# ─────────────────────────────────────────────────────────────────────────────

def verify_cvat_webhook_signature(body: bytes, signature_header: str, secret: str) -> bool:
    """Validate CVAT webhook HMAC-SHA256 signature.

    CVAT sends: X-Signature-256: sha256=<hex-digest>
    """
    expected = hmac.new(
        secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature_header)
