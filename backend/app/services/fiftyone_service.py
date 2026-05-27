# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""FiftyOne integration service — ephemeral dataset sync with Supabase.

Provides bidirectional synchronisation between the Supabase database and
FiftyOne datasets, enabling visual review and annotation via the FiftyOne
App. Datasets are ephemeral by default (overwrite=True).

This is an infrastructure adapter (services layer), NOT domain logic.
It wraps the FiftyOne SDK and translates between DB and FO data models.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import structlog

from app.services.supabase_client import create_service_client

logger = structlog.get_logger()

# FiftyOne is an optional heavyweight dependency.
# Import is deferred so the app starts without it installed.
_fo = None
_foz = None


def _ensure_fiftyone():
    """Lazy-import fiftyone and raise a clear error if missing."""
    global _fo, _foz
    if _fo is not None:
        return
    try:
        import fiftyone as fo
        import fiftyone.zoo as foz

        _fo = fo
        _foz = foz
    except ImportError as exc:
        raise RuntimeError("fiftyone is not installed. Install it with: pip install fiftyone") from exc


# ── Supabase → FiftyOne sync ────────────────────────────────────────


def _observation_to_detection(obs: dict) -> dict | None:
    """Convert a WW observation row to a FiftyOne Detection dict.

    Only processes observation_level='media' rows that have bounding boxes.
    """
    if obs.get("observation_level") != "media":
        return None
    bbox_x = obs.get("bbox_x")
    bbox_y = obs.get("bbox_y")
    bbox_w = obs.get("bbox_w")
    bbox_h = obs.get("bbox_h")
    if any(v is None for v in (bbox_x, bbox_y, bbox_w, bbox_h)):
        return None

    label = obs.get("scientific_name") or obs.get("classifier_category") or obs.get("observation_type") or "unknown"

    return {
        "label": label,
        "bounding_box": [bbox_x, bbox_y, bbox_w, bbox_h],
        "confidence": obs.get("confidence"),
        "observation_id": obs.get("id"),
        "review_status": obs.get("review_status"),
        "source_type": obs.get("source_type"),
    }


async def sync_deployment_to_fiftyone(
    deployment_id: str,
    dataset_name: str | None = None,
    overwrite: bool = True,
) -> dict[str, Any]:
    """Load a deployment's media and observations into a FiftyOne dataset.

    Args:
        deployment_id: UUID of the deployment to sync.
        dataset_name: Optional dataset name. Defaults to ``ww-{deployment_id[:8]}``.
        overwrite: If True, delete and recreate the dataset. If False,
                   load existing or create new.

    Returns:
        Summary dict with dataset_name, num_samples, and num_detections.
    """
    _ensure_fiftyone()
    svc = create_service_client()

    # Fetch media + observations in thread to avoid blocking
    def _fetch():
        media_resp = (
            svc.table("media")
            .select("id, deployment_id, file_path, file_name, file_mediatype, timestamp")
            .eq("deployment_id", deployment_id)
            .order("timestamp")
            .execute()
        )
        obs_resp = svc.table("observations").select("*").eq("deployment_id", deployment_id).is_("deleted_at", "null").execute()
        return media_resp.data or [], obs_resp.data or []

    media_rows, obs_rows = await asyncio.to_thread(_fetch)

    if not media_rows:
        logger.warning("fiftyone_sync_no_media", deployment_id=deployment_id)
        return {"dataset_name": None, "num_samples": 0, "num_detections": 0}

    # Index observations by media_id for O(1) lookup
    obs_by_media: dict[str, list[dict]] = {}
    for obs in obs_rows:
        mid = obs.get("media_id")
        if mid:
            obs_by_media.setdefault(mid, []).append(obs)

    # Build FiftyOne dataset
    name = dataset_name or f"ww-{deployment_id[:8]}"

    def _build_dataset():
        if overwrite and _fo.dataset_exists(name):
            _fo.delete_dataset(name)

        dataset = _fo.Dataset(name=name, overwrite=overwrite)
        dataset.persistent = False  # Ephemeral — not saved to MongoDB

        samples = []
        total_detections = 0

        for m in media_rows:
            filepath = m.get("file_path") or m.get("file_name") or ""
            sample = _fo.Sample(filepath=filepath)

            # Tag with WW metadata
            sample["media_id"] = m["id"]
            sample["deployment_id"] = deployment_id
            sample["timestamp"] = m.get("timestamp")

            # Attach detections
            media_obs = obs_by_media.get(m["id"], [])
            detections = []
            for obs in media_obs:
                det = _observation_to_detection(obs)
                if det:
                    fo_det = _fo.Detection(
                        label=det["label"],
                        bounding_box=det["bounding_box"],
                        confidence=det.get("confidence"),
                    )
                    # Store WW IDs as custom attributes for writeback
                    fo_det["observation_id"] = det["observation_id"]
                    fo_det["review_status"] = det.get("review_status")
                    fo_det["source_type"] = det.get("source_type")
                    detections.append(fo_det)
                    total_detections += 1

            if detections:
                sample["detections"] = _fo.Detections(detections=detections)

            samples.append(sample)

        dataset.add_samples(samples)
        return len(samples), total_detections

    num_samples, num_detections = await asyncio.to_thread(_build_dataset)

    logger.info(
        "fiftyone_sync_complete",
        deployment_id=deployment_id,
        dataset_name=name,
        num_samples=num_samples,
        num_detections=num_detections,
    )

    return {
        "dataset_name": name,
        "num_samples": num_samples,
        "num_detections": num_detections,
    }


# ── FiftyOne → Supabase writeback ───────────────────────────────────


async def writeback_annotations(
    dataset_name: str,
    deployment_id: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Write human annotation changes from FiftyOne back to Supabase.

    Scans the FiftyOne dataset for detections that have been relabeled
    or reviewed and updates the corresponding observations in the DB.

    Args:
        dataset_name: Name of the FiftyOne dataset to read from.
        deployment_id: UUID of the deployment for provenance recording.
        user_id: UUID of the human annotator.

    Returns:
        Summary dict with observations_updated count.
    """
    _ensure_fiftyone()
    svc = create_service_client()

    def _writeback():
        if not _fo.dataset_exists(dataset_name):
            raise ValueError(f"Dataset '{dataset_name}' does not exist in FiftyOne")

        dataset = _fo.load_dataset(dataset_name)
        updated = 0

        for sample in dataset:
            dets = sample.get("detections")
            if not dets:
                continue

            for det in dets.detections:
                obs_id = getattr(det, "observation_id", None)
                if not obs_id:
                    continue

                # Build update payload from FiftyOne detection
                update: dict[str, Any] = {
                    "scientific_name": det.label,
                    "review_status": "human_reviewed",
                    "source_type": "human",
                }
                if user_id:
                    update["reviewer_id"] = user_id

                if det.confidence is not None:
                    update["confidence"] = det.confidence

                svc.table("observations").update(update).eq("id", obs_id).execute()
                updated += 1

        # Record annotation run for provenance
        svc.table("annotation_runs").insert(
            {
                "deployment_id": deployment_id,
                "run_type": "human_review",
                "config": {"dataset_name": dataset_name},
                "observation_count": updated,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "created_by": user_id,
            }
        ).execute()

        return updated

    observations_updated = await asyncio.to_thread(_writeback)

    logger.info(
        "fiftyone_writeback_complete",
        dataset_name=dataset_name,
        observations_updated=observations_updated,
    )

    return {"observations_updated": observations_updated}


# ── FiftyOne App Session Management ─────────────────────────────────


async def launch_fiftyone_session(
    deployment_id: str,
    port: int = 5151,
    remote: bool = True,
) -> dict[str, Any]:
    """Launch a FiftyOne App session for a deployment.

    This syncs the deployment to an ephemeral dataset and starts
    the FiftyOne App server on the specified port.

    Args:
        deployment_id: UUID of the deployment to visualise.
        port: Port for the FiftyOne App (default 5151).
        remote: Whether to allow remote connections.

    Returns:
        Summary dict with session URL and dataset info.
    """
    # First sync the deployment data
    sync_result = await sync_deployment_to_fiftyone(deployment_id)
    dataset_name = sync_result.get("dataset_name")

    if not dataset_name:
        return {"error": "No media found for deployment", "session_url": None}

    _ensure_fiftyone()

    def _launch():
        dataset = _fo.load_dataset(dataset_name)
        session = _fo.launch_app(dataset, port=port, remote=remote)
        return session.url

    session_url = await asyncio.to_thread(_launch)

    logger.info(
        "fiftyone_session_launched",
        deployment_id=deployment_id,
        dataset_name=dataset_name,
        session_url=session_url,
    )

    return {
        "session_url": session_url,
        "dataset_name": dataset_name,
        **sync_result,
    }
