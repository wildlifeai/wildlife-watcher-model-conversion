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
import os
import shutil
import tempfile
import urllib.parse
from datetime import datetime, timezone
from typing import Any
import time

import structlog

from app.services.supabase_client import create_service_client
from app.services.cvat_service import sanitise_for_annotation

logger = structlog.get_logger()

# FiftyOne is an optional heavyweight dependency.
# Import is deferred so the app starts without it installed.
_fo = None
_foz = None

# Track the active FiftyOne session so we can kill it before launching a new one
_active_session = None


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


def _close_active_session() -> None:
    """Kill any running FiftyOne App session before launching a new one.

    Only one session can bind to port 5151 at a time. This prevents
    'address already in use' errors when switching between deployments.
    """
    global _active_session
    if _active_session is not None:
        try:
            _active_session.close()
            logger.info("fiftyone_session_closed")
        except Exception as e:
            logger.warning("fiftyone_session_close_failed", error=str(e))
        _active_session = None
    # Belt-and-suspenders: also call fo.close_app() if available
    if _fo is not None:
        try:
            _fo.close_app()
        except Exception:
            pass


# ── Supabase → FiftyOne sync ────────────────────────────────────────


def _generate_media_url(media_row: dict, api_base_url: str, client) -> str:
    """Generate a streaming URL for FiftyOne to load the image.
    
    - Public HTTP paths are returned as-is.
    - Google Drive paths use the backend proxy endpoint.
    - Supabase Storage paths generate a 2-hour Presigned URL.
    """
    file_path = media_row.get("file_path", "")
    media_id = media_row["id"]
    
    if file_path.startswith(("http://", "https://")):
        return file_path
        
    if file_path.startswith("gdrive://") or file_path.startswith("s3://"):
        return f"{api_base_url}/api/media/{media_id}/image?size=full"
        
    # Assume it's a Supabase Storage object
    try:
        from app.config import settings
        bucket = settings.AZURE_STORAGE_CONTAINER_NAME or "wildlife-watcher-uploads"
        # 7200 seconds = 2 hours
        response = client.storage.from_(bucket).create_signed_url(file_path, 7200)
        return response.get("signedURL", "") if isinstance(response, dict) else response
    except Exception as e:
        logger.warning("fiftyone_signed_url_failed", media_id=media_id, error=str(e))
        # Fallback to the proxy
        return f"{api_base_url}/api/media/{media_id}/image?size=full"


async def sync_deployment_to_fiftyone(
    deployment_id: str,
    api_base_url: str,
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

    # Fetch media + observations + deployment location in thread
    def _fetch():
        # Get deployment location name (best-effort, don't abort if it fails)
        try:
            dep_resp = (
                svc.table("deployments")
                .select("location_name")
                .eq("id", deployment_id)
                .limit(1)
                .execute()
            )
            dep_rows = dep_resp.data or []
            raw_name = dep_rows[0].get("location_name") if dep_rows else ""
            loc_name = (raw_name or "").replace(" ", "-")[:20]
        except Exception:
            loc_name = ""

        media_resp = (
            svc.table("media")
            .select("id, deployment_id, file_path, file_name, file_mediatype, timestamp, file_public")
            .eq("deployment_id", deployment_id)
            .order("timestamp")
            .execute()
        )
        obs_resp = (
            svc.table("observations")
            .select("*")
            .eq("deployment_id", deployment_id)
            .is_("deleted_at", "null")
            .execute()
        )
        return media_resp.data or [], obs_resp.data or [], loc_name

    media_rows, obs_rows, location_name = await asyncio.to_thread(_fetch)

    if not media_rows:
        logger.warning("fiftyone_sync_no_media", deployment_id=deployment_id)
        return {"dataset_name": None, "num_samples": 0, "num_detections": 0}

    # Index observations by media_id for O(1) lookup
    obs_by_media: dict[str, list[dict]] = {}
    for obs in obs_rows:
        mid = obs.get("media_id")
        if mid:
            obs_by_media.setdefault(mid, []).append(obs)

    # Remove caching step
    local_paths = {}

    # Build FiftyOne dataset — use location name for human-readable dataset name
    slug = location_name or ""
    name = dataset_name or (f"{slug}-{deployment_id[:8]}" if slug else f"ww-{deployment_id[:8]}")

    def _build_dataset():
        if overwrite and _fo.dataset_exists(name):
            _fo.delete_dataset(name)

        dataset = _fo.Dataset(name=name, overwrite=overwrite)
        dataset.persistent = False  # Ephemeral — not saved to MongoDB

        # Explicitly define schema so the FiftyOne UI Annotate tab works
        dataset.add_sample_field("detections", _fo.core.fields.EmbeddedDocumentField, embedded_doc_type=_fo.Detections)
        dataset.add_sample_field("species", _fo.core.fields.EmbeddedDocumentField, embedded_doc_type=_fo.Classifications)

        import json
        schema_path = os.path.join(os.path.dirname(__file__), "fiftyone_annotation_schema.json")
        try:
            with open(schema_path, "r") as f:
                schema_data = json.load(f)
            if "@voxel51/annotation" not in dataset.app_config.plugins:
                dataset.app_config.plugins["@voxel51/annotation"] = {}
            dataset.app_config.plugins["@voxel51/annotation"]["schema"] = schema_data
        except Exception as e:
            logger.warning("fiftyone_annotation_schema_load_failed", error=str(e))

        samples = []
        total_detections = 0

        for m in media_rows:
            # Resolve filepath to a streaming URL
            filepath = _generate_media_url(m, api_base_url, svc)

            # Skip samples where no valid filepath is available
            # (zip-embedded images not yet uploaded to Drive)
            if not filepath:
                logger.warning("fiftyone_skipping_sample_no_filepath", media_id=m["id"])
                continue

            # Strip hash fragments added for extension detection
            if filepath.startswith(("http://", "https://")):
                last_segment = filepath.split("/")[-1].split("?")[0]
                if "." not in last_segment:
                    filepath = f"{filepath}#image.jpg"

            sample = _fo.Sample(filepath=filepath)

            # Tag with WW metadata
            sample["media_id"] = m["id"]
            sample["deployment_id"] = deployment_id
            sample["timestamp"] = m.get("timestamp")

            # Attach detections (bounding boxes) and classifications (image-level labels)
            media_obs = obs_by_media.get(m["id"], [])
            
            evt_id = None
            for obs in media_obs:
                if obs.get("observation_event_id"):
                    evt_id = obs.get("observation_event_id")
                    break
            sample["observation_event_id"] = evt_id or m["id"]

            detections = []
            classifications = []

            # Pre-populate sample tags from observation_type for sidebar filtering
            obs_types = list({
                (obs.get("observation_type") or "unreviewed")
                for obs in media_obs
            })
            if obs_types:
                sample.tags.extend(obs_types)
            else:
                sample.tags.append("unreviewed")

            for obs in media_obs:
                label = obs.get("scientific_name") or obs.get("classifier_category") or obs.get("observation_type") or "unknown"
                bbox_x = obs.get("bbox_x")
                bbox_y = obs.get("bbox_y")
                bbox_w = obs.get("bbox_w")
                bbox_h = obs.get("bbox_h")

                if all(v is not None for v in (bbox_x, bbox_y, bbox_w, bbox_h)):
                    fo_det = _fo.Detection(
                        label=label,
                        bounding_box=[bbox_x, bbox_y, bbox_w, bbox_h],
                        confidence=obs.get("confidence"),
                    )
                    fo_det["observation_id"] = obs.get("id")
                    fo_det["review_status"] = obs.get("review_status")
                    fo_det["source_type"] = obs.get("source_type")
                    detections.append(fo_det)
                    total_detections += 1
                else:
                    fo_cl = _fo.Classification(
                        label=label,
                        confidence=obs.get("confidence"),
                    )
                    fo_cl["observation_id"] = obs.get("id")
                    fo_cl["review_status"] = obs.get("review_status")
                    fo_cl["source_type"] = obs.get("source_type")
                    classifications.append(fo_cl)

            if detections:
                sample["detections"] = _fo.Detections(detections=detections)
            if classifications:
                # Use human-readable field name "species" instead of "classifications"
                sample["species"] = _fo.Classifications(classifications=classifications)

            samples.append(sample)

        dataset.add_samples(samples)

        # ── Ecologist-friendly sidebar configuration ──
        # Hide METADATA, internal PRIMITIVES, label tags — show only species + timestamp
        try:
            dataset.app_config.sidebar_groups = [
                _fo.SidebarGroupDocument(
                    name="🏷 Species Labels",
                    paths=["species", "detections"],
                    expanded=True,
                ),
                _fo.SidebarGroupDocument(
                    name="📍 Context",
                    paths=["timestamp"],
                    expanded=True,
                ),
                # Intentionally omit: id, filepath, created_at, last_modified_at,
                # media_id, deployment_id, metadata.*, label tags
            ]
            dataset.save()
        except Exception as e:
            logger.warning("fiftyone_app_config_failed", error=str(e))

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

    Scans the FiftyOne dataset for detections that have been relabeled,
    resized/moved, newly added, or removed, and updates database observations.

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

        # Fetch current human observations in Supabase to track deletions
        existing_obs_resp = (
            svc.table("observations")
            .select("id, media_id, scientific_name")
            .eq("deployment_id", deployment_id)
            .eq("source_type", "human")
            .is_("deleted_at", "null")
            .execute()
        )
        existing_obs = existing_obs_resp.data or []
        existing_obs_ids = {obs["id"] for obs in existing_obs}
        processed_obs_ids = set()

        for sample in dataset:
            media_id = sample.get("media_id")
            if not media_id:
                continue

            # 1. Write back detections (bounding boxes)
            dets = sample.get("detections")
            if dets:
                for det in dets.detections:
                    obs_id = getattr(det, "observation_id", None)
                    bbox = det.bounding_box # [x, y, w, h] from FiftyOne
                    
                    if obs_id:
                        # Existing observation: update scientific_name, bbox coordinates, and metadata
                        update: dict[str, Any] = {
                            "scientific_name": det.label,
                            "review_status": "human_reviewed",
                            "source_type": "human",
                            "bbox_x": bbox[0] if bbox else None,
                            "bbox_y": bbox[1] if bbox else None,
                            "bbox_w": bbox[2] if bbox else None,
                            "bbox_h": bbox[3] if bbox else None,
                        }
                        if user_id:
                            update["reviewer_id"] = user_id

                        if det.confidence is not None:
                            update["confidence"] = det.confidence

                        svc.table("observations").update(update).eq("id", obs_id).execute()
                        processed_obs_ids.add(obs_id)
                        updated += 1
                    else:
                        # New detection drawn in FiftyOne! Insert it!
                        new_obs = {
                            "deployment_id": deployment_id,
                            "media_id": media_id,
                            "scientific_name": det.label,
                            "review_status": "human_reviewed",
                            "source_type": "human",
                            "bbox_x": bbox[0] if bbox else None,
                            "bbox_y": bbox[1] if bbox else None,
                            "bbox_w": bbox[2] if bbox else None,
                            "bbox_h": bbox[3] if bbox else None,
                            "confidence": det.confidence if det.confidence is not None else 1.0,
                        }
                        if user_id:
                            new_obs["reviewer_id"] = user_id

                        insert_resp = svc.table("observations").insert(new_obs).execute()
                        if insert_resp.data:
                            new_obs_id = insert_resp.data[0]["id"]
                            det["observation_id"] = new_obs_id
                        updated += 1

            # 2. Write back species classifications (image-level labels)
            # Read from 'species' (new name) or 'classifications' (legacy fallback)
            cl_field = sample.get("species") or sample.get("classifications")
            if cl_field:
                for cl in cl_field.classifications:
                    obs_id = getattr(cl, "observation_id", None)
                    if obs_id:
                        # Existing classification: update label
                        update: dict[str, Any] = {
                            "scientific_name": cl.label,
                            "review_status": "human_reviewed",
                            "source_type": "human",
                            "bbox_x": None,
                            "bbox_y": None,
                            "bbox_w": None,
                            "bbox_h": None,
                        }
                        if user_id:
                            update["reviewer_id"] = user_id

                        if cl.confidence is not None:
                            update["confidence"] = cl.confidence

                        svc.table("observations").update(update).eq("id", obs_id).execute()
                        processed_obs_ids.add(obs_id)
                        updated += 1
                    else:
                        # New classification added in FiftyOne — insert it
                        new_obs = {
                            "deployment_id": deployment_id,
                            "media_id": media_id,
                            "scientific_name": cl.label,
                            "review_status": "human_reviewed",
                            "source_type": "human",
                            "observation_level": "media",
                            "confidence": cl.confidence if cl.confidence is not None else 1.0,
                        }
                        if user_id:
                            new_obs["reviewer_id"] = user_id

                        insert_resp = svc.table("observations").insert(new_obs).execute()
                        if insert_resp.data:
                            new_obs_id = insert_resp.data[0]["id"]
                            cl["observation_id"] = new_obs_id
                        updated += 1

        # Mark deleted annotations as deleted in Supabase
        deleted_obs_ids = existing_obs_ids - processed_obs_ids
        if deleted_obs_ids:
            svc.table("observations").update({
                "deleted_at": datetime.now(timezone.utc).isoformat()
            }).in_("id", list(deleted_obs_ids)).execute()
            logger.info("fiftyone_writeback_deletions", count=len(deleted_obs_ids))

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



async def launch_fiftyone_session(
    deployment_id: str,
    api_base_url: str,
    port: int = 5151,
    remote: bool = True,
) -> dict[str, Any]:
    """Launch a FiftyOne App session for a single deployment.

    Kills any existing session on the port before launching.
    """
    global _active_session

    sync_result = await sync_deployment_to_fiftyone(deployment_id, api_base_url)
    dataset_name = sync_result.get("dataset_name")

    if not dataset_name:
        return {"error": "No media found for deployment", "session_url": None}

    _ensure_fiftyone()

    def _launch():
        global _active_session
        _close_active_session()
        dataset = _fo.load_dataset(dataset_name)
        session = _fo.launch_app(dataset, port=port, remote=remote)
        _active_session = session
        return session.url.replace("0.0.0.0", "localhost")

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


async def sync_deployments_to_fiftyone(
    deployment_ids: list[str],
    api_base_url: str,
    dataset_name: str | None = None,
    overwrite: bool = True,
) -> dict[str, Any]:
    """Merge multiple deployments into one FiftyOne dataset.

    Uses the project name as the dataset name. Each sample is tagged with
    its deployment's location_name for sidebar filtering.

    Args:
        deployment_ids: List of deployment UUIDs to merge.
        dataset_name:   Override dataset name (auto-derived from project if None).
        overwrite:      Delete and recreate the dataset if it already exists.

    Returns:
        Summary dict with dataset_name, num_samples, num_detections.
    """
    _ensure_fiftyone()
    svc = create_service_client()
    
    t0_total = time.perf_counter()

    def _fetch():
        # Fetch deployment rows to get location names + project_id
        dep_resp = (
            svc.table("deployments")
            .select("id, location_name, project_id")
            .in_("id", deployment_ids)
            .execute()
        )
        dep_rows = dep_resp.data or []
        dep_names: dict[str, str] = {
            d["id"]: (d.get("location_name") or "unknown")
            for d in dep_rows
        }

        # Fetch project name for dataset naming
        project_name = ""
        if dep_rows:
            project_id = dep_rows[0].get("project_id")
            if project_id:
                try:
                    proj_resp = (
                        svc.table("projects")
                        .select("name")
                        .eq("id", project_id)
                        .limit(1)
                        .execute()
                    )
                    proj_rows = proj_resp.data or []
                    project_name = proj_rows[0].get("name") if proj_rows else ""
                except Exception:
                    pass

        media_resp = (
            svc.table("media")
            .select("id, deployment_id, file_path, file_name, file_mediatype, timestamp, file_public")
            .in_("deployment_id", deployment_ids)
            .order("timestamp")
            .execute()
        )
        obs_resp = (
            svc.table("observations")
            .select("*")
            .in_("deployment_id", deployment_ids)
            .is_("deleted_at", "null")
            .execute()
        )
        return media_resp.data or [], obs_resp.data or [], dep_names, project_name

    t0_fetch = time.perf_counter()
    media_rows, obs_rows, dep_names, project_name = await asyncio.to_thread(_fetch)
    t_fetch = time.perf_counter() - t0_fetch
    logger.info("fiftyone_perf_db_fetch", duration=t_fetch, rows_media=len(media_rows), rows_obs=len(obs_rows))

    if not media_rows:
        logger.warning("fiftyone_multi_sync_no_media", deployment_ids=deployment_ids)
        return {"dataset_name": None, "num_samples": 0, "num_detections": 0}

    # Removed caching step
    t_cache = 0.0
    logger.info("fiftyone_perf_media_cache", duration=t_cache, cached_files=0)

    # Index observations by media_id
    obs_by_media: dict[str, list[dict]] = {}
    for obs in obs_rows:
        mid = obs.get("media_id")
        if mid:
            obs_by_media.setdefault(mid, []).append(obs)

    # Dataset name: project name slug
    slug = (project_name or "").replace(" ", "-")[:24]
    name = dataset_name or (f"{slug}-multi" if slug else f"ww-multi-{cache_key[:8]}")

    def _build_dataset():
        if overwrite and _fo.dataset_exists(name):
            _fo.delete_dataset(name)

        dataset = _fo.Dataset(name=name, overwrite=overwrite)
        dataset.persistent = False

        # Explicitly define schema so the FiftyOne UI Annotate tab works
        dataset.add_sample_field("detections", _fo.core.fields.EmbeddedDocumentField, embedded_doc_type=_fo.Detections)
        dataset.add_sample_field("species", _fo.core.fields.EmbeddedDocumentField, embedded_doc_type=_fo.Classifications)

        import json
        schema_path = os.path.join(os.path.dirname(__file__), "fiftyone_annotation_schema.json")
        try:
            with open(schema_path, "r") as f:
                schema_data = json.load(f)
            if "@voxel51/annotation" not in dataset.app_config.plugins:
                dataset.app_config.plugins["@voxel51/annotation"] = {}
            dataset.app_config.plugins["@voxel51/annotation"]["schema"] = schema_data
        except Exception as e:
            logger.warning("fiftyone_annotation_schema_load_failed", error=str(e))

        samples = []
        total_detections = 0

        for m in media_rows:
            filepath = _generate_media_url(m, api_base_url, svc)
            if not filepath:
                logger.warning("fiftyone_skipping_sample_no_filepath", media_id=m["id"])
                continue

            sample = _fo.Sample(filepath=filepath)
            dep_id = m["deployment_id"]
            location = dep_names.get(dep_id, "unknown")

            sample["media_id"] = m["id"]
            sample["deployment_id"] = dep_id
            sample["location"] = location
            sample["timestamp"] = m.get("timestamp")

            # Tag with location for sidebar filtering by site
            safe_loc = location.replace(" ", "_")
            sample.tags.append(safe_loc)

            media_obs = obs_by_media.get(m["id"], [])
            obs_types = list({obs.get("observation_type") or "unreviewed" for obs in media_obs})
            sample.tags.extend(obs_types if obs_types else ["unreviewed"])

            detections, classifications = [], []
            for obs in media_obs:
                label = (
                    obs.get("scientific_name")
                    or obs.get("classifier_category")
                    or obs.get("observation_type")
                    or "unknown"
                )
                bbox_x, bbox_y = obs.get("bbox_x"), obs.get("bbox_y")
                bbox_w, bbox_h = obs.get("bbox_w"), obs.get("bbox_h")

                if all(v is not None for v in (bbox_x, bbox_y, bbox_w, bbox_h)):
                    fo_det = _fo.Detection(
                        label=label,
                        bounding_box=[bbox_x, bbox_y, bbox_w, bbox_h],
                        confidence=obs.get("confidence"),
                    )
                    fo_det["observation_id"] = obs.get("id")
                    fo_det["review_status"] = obs.get("review_status")
                    fo_det["source_type"] = obs.get("source_type")
                    detections.append(fo_det)
                    total_detections += 1
                else:
                    fo_cl = _fo.Classification(
                        label=label,
                        confidence=obs.get("confidence"),
                    )
                    fo_cl["observation_id"] = obs.get("id")
                    fo_cl["review_status"] = obs.get("review_status")
                    fo_cl["source_type"] = obs.get("source_type")
                    classifications.append(fo_cl)

            if detections:
                sample["detections"] = _fo.Detections(detections=detections)
            if classifications:
                sample["species"] = _fo.Classifications(classifications=classifications)

            samples.append(sample)

        dataset.add_samples(samples)

        try:
            dataset.app_config.sidebar_groups = [
                _fo.SidebarGroupDocument(
                    name="🏷 Species Labels",
                    paths=["species", "detections"],
                    expanded=True,
                ),
                _fo.SidebarGroupDocument(
                    name="📍 Deployment",
                    paths=["location", "timestamp"],
                    expanded=True,
                ),
            ]
            dataset.save()
        except Exception as e:
            logger.warning("fiftyone_app_config_failed", error=str(e))

        return len(samples), total_detections

    t0_build = time.perf_counter()
    num_samples, num_detections = await asyncio.to_thread(_build_dataset)
    t_build = time.perf_counter() - t0_build
    logger.info("fiftyone_perf_dataset_build", duration=t_build, dataset_name=name)

    logger.info(
        "fiftyone_multi_sync_complete",
        dataset_name=name,
        deployment_count=len(deployment_ids),
        num_samples=num_samples,
        num_detections=num_detections,
    )
    
    t_total = time.perf_counter() - t0_total
    logger.info("fiftyone_perf_total_sync", duration=t_total, dataset_name=name)

    return {
        "dataset_name": name,
        "num_samples": num_samples,
        "num_detections": num_detections,
    }


async def launch_fiftyone_multi_session(
    deployment_ids: list[str],
    api_base_url: str,
    port: int = 5151,
    remote: bool = True,
) -> dict[str, Any]:
    """Launch a FiftyOne App session for multiple merged deployments.

    Kills any existing session on the port before launching.
    """
    global _active_session

    sync_result = await sync_deployments_to_fiftyone(deployment_ids, api_base_url)
    dataset_name = sync_result.get("dataset_name")

    if not dataset_name:
        return {"error": "No media found for any of the selected deployments", "session_url": None}

    _ensure_fiftyone()

    def _launch():
        global _active_session
        _close_active_session()
        dataset = _fo.load_dataset(dataset_name)
        session = _fo.launch_app(dataset, port=port, remote=remote)
        _active_session = session
        return session.url.replace("0.0.0.0", "localhost")

    session_url = await asyncio.to_thread(_launch)

    logger.info(
        "fiftyone_multi_session_launched",
        dataset_name=dataset_name,
        deployment_count=len(deployment_ids),
        session_url=session_url,
    )

    return {
        "session_url": session_url,
        "dataset_name": dataset_name,
        **sync_result,
    }


async def writeback_multi_annotations(
    dataset_name: str,
    deployment_ids: list[str],
    user_id: str | None = None,
) -> dict[str, Any]:
    """Write human annotation changes from a multi-deployment FiftyOne dataset back to Supabase.

    Reads deployment_id from each sample's stored field to correctly attribute
    changes across multiple deployments.
    """
    _ensure_fiftyone()
    svc = create_service_client()

    def _writeback():
        if not _fo.dataset_exists(dataset_name):
            raise ValueError(f"Dataset '{dataset_name}' does not exist in FiftyOne")

        dataset = _fo.load_dataset(dataset_name)
        updated = 0

        # Fetch all existing human observations for all deployments
        existing_obs_resp = (
            svc.table("observations")
            .select("id, media_id, scientific_name")
            .in_("deployment_id", deployment_ids)
            .eq("source_type", "human")
            .is_("deleted_at", "null")
            .execute()
        )
        existing_obs_ids = {obs["id"] for obs in (existing_obs_resp.data or [])}
        processed_obs_ids: set[str] = set()

        for sample in dataset:
            media_id = sample.get("media_id")
            dep_id = sample.get("deployment_id")
            if not media_id or not dep_id:
                continue

            # Detections (bounding boxes)
            dets = sample.get("detections")
            if dets:
                for det in dets.detections:
                    obs_id = getattr(det, "observation_id", None)
                    bbox = det.bounding_box
                    base = {
                        "scientific_name": det.label,
                        "review_status": "human_reviewed",
                        "source_type": "human",
                        "bbox_x": bbox[0] if bbox else None,
                        "bbox_y": bbox[1] if bbox else None,
                        "bbox_w": bbox[2] if bbox else None,
                        "bbox_h": bbox[3] if bbox else None,
                    }
                    if det.confidence is not None:
                        base["confidence"] = det.confidence
                    if user_id:
                        base["reviewer_id"] = user_id

                    if obs_id:
                        svc.table("observations").update(base).eq("id", obs_id).execute()
                        processed_obs_ids.add(obs_id)
                    else:
                        base["deployment_id"] = dep_id
                        base["media_id"] = media_id
                        base["observation_level"] = "media"
                        base["confidence"] = det.confidence if det.confidence is not None else 1.0
                        svc.table("observations").insert(base).execute()
                    updated += 1

            # Classifications (image-level labels)
            cl_field = sample.get("species") or sample.get("classifications")
            if cl_field:
                for cl in cl_field.classifications:
                    obs_id = getattr(cl, "observation_id", None)
                    base = {
                        "scientific_name": cl.label,
                        "review_status": "human_reviewed",
                        "source_type": "human",
                        "bbox_x": None, "bbox_y": None, "bbox_w": None, "bbox_h": None,
                    }
                    if cl.confidence is not None:
                        base["confidence"] = cl.confidence
                    if user_id:
                        base["reviewer_id"] = user_id

                    if obs_id:
                        svc.table("observations").update(base).eq("id", obs_id).execute()
                        processed_obs_ids.add(obs_id)
                    else:
                        base["deployment_id"] = dep_id
                        base["media_id"] = media_id
                        base["observation_level"] = "media"
                        base["confidence"] = cl.confidence if cl.confidence is not None else 1.0
                        svc.table("observations").insert(base).execute()
                    updated += 1

        # Soft-delete removed human annotations
        deleted_ids = existing_obs_ids - processed_obs_ids
        if deleted_ids:
            svc.table("observations").update(
                {"deleted_at": datetime.now(timezone.utc).isoformat()}
            ).in_("id", list(deleted_ids)).execute()
            logger.info("fiftyone_multi_writeback_deletions", count=len(deleted_ids))

        return updated

    observations_updated = await asyncio.to_thread(_writeback)

    logger.info(
        "fiftyone_multi_writeback_complete",
        dataset_name=dataset_name,
        observations_updated=observations_updated,
    )
    return {"observations_updated": observations_updated}
