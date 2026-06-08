# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pluggable AI inference pipeline framework — pure domain logic.

Defines the PipelineStep abstract base class and the concrete steps that run in
production: media preparation (thumbnails/previews), the SpeciesNet ensemble
(detection + species classification, including blank-frame handling), and animal
cropping for DINOv3. Steps are composable and run sequentially.

No HTTP or FastAPI imports — this module runs in the domain layer.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

import structlog

from app.schemas.pipeline import (
    PipelineRunResult,
    PipelineStepResult,
    PipelineStepType,
)
from app.services.speciesnet_service import SPECIESNET_VERSION
from app.services.supabase_client import create_service_client

logger = structlog.get_logger()


# ── Abstract Pipeline Step ───────────────────────────────────────────


class PipelineStep(ABC):
    """Base class for all pipeline inference steps.

    Each step receives a list of media dicts (id, deployment_id, file_path, etc.)
    and produces observation rows which are inserted into the database.
    """

    step_type: PipelineStepType
    model_version: Optional[str] = None

    @abstractmethod
    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        """Execute the pipeline step on a batch of media.

        Args:
            media: List of media dicts from Supabase (id, file_path, etc.).
            deployment_id: UUID of the deployment being processed.
            config: Step-specific configuration overrides.

        Returns:
            PipelineStepResult summarising what was created/updated.
        """
        ...


# ── Media Preparation Step (thumbnails + previews) ───────────────────


class MediaPreparationStep(PipelineStep):
    """Generate thumbnail + preview renditions into media_assets (Azure CDN).

    Runs before SpeciesNet so the UI grid and (later) crops have CDN URLs and
    never hit Google Drive on the hot path. Creates no observations.
    """

    step_type = PipelineStepType.MEDIA_PREP
    model_version = "media-prep-v1"

    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        from app.domain.media_registry import prepare_media_assets

        start = time.monotonic()
        errors = 0
        for m in media:
            try:
                await prepare_media_assets(m)
            except Exception as exc:
                logger.warning("media_prep_error", media_id=m.get("id"), error=str(exc))
                errors += 1

        return PipelineStepResult(
            step=self.step_type,
            media_processed=len(media),
            errors=errors,
            duration_seconds=round(time.monotonic() - start, 2),
            model_version=self.model_version,
        )


# ── Animal Crop Step (DINOv3 input) ──────────────────────────────────


class AnimalCropStep(PipelineStep):
    """Crop each media's best AI animal detection into media_assets.animal_crop_url.

    Runs after SpeciesNet (needs the detection bboxes it wrote). Creates no
    observations; produces the crop DINOv3 consumes in Phase 5.
    """

    step_type = PipelineStepType.ANIMAL_CROP
    model_version = "animal-crop-v1"

    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        from app.domain.media_registry import generate_animal_crop

        start = time.monotonic()
        errors = 0
        for m in media:
            try:
                await generate_animal_crop(m["id"])
            except Exception as exc:
                logger.warning("animal_crop_error", media_id=m.get("id"), error=str(exc))
                errors += 1

        return PipelineStepResult(
            step=self.step_type,
            media_processed=len(media),
            errors=errors,
            duration_seconds=round(time.monotonic() - start, 2),
            model_version=self.model_version,
        )


# ── SpeciesNet Step (detector + classifier) ──────────────────────────


def build_speciesnet_observations(
    media: dict,
    deployment_id: str,
    prediction,  # services.speciesnet_service.ImagePrediction (duck-typed)
    model_version: str,
    timestamp: str,
    confidence_threshold: float = 0.0,
) -> list[dict]:
    """Map a SpeciesNet ImagePrediction to CamtrapDP observation rows (pure).

    Detections below ``confidence_threshold`` are dropped; an image with no kept
    detections yields a single ``blank`` observation. Animal detections carry the
    classifier's species name + probability. bbox fields are set as a complete
    quad or omitted entirely (honours the observations chk_bbox_complete check).
    """
    base = {
        "deployment_id": deployment_id,
        "media_id": media["id"],
        "observation_level": "media",
        "source_type": "ai",
        "source_model_version": model_version,
        "review_status": "ai_reviewed",
        "classification_method": "machine",
        "classified_by": model_version,
        "classification_timestamp": timestamp,
    }

    kept = [d for d in prediction.detections if d.confidence >= confidence_threshold]
    if not kept:
        return [{**base, "id": str(uuid.uuid4()), "observation_type": "blank"}]

    rows: list[dict] = []
    for det in kept:
        row = {
            **base,
            "id": str(uuid.uuid4()),
            "observation_type": det.observation_type,
            "classifier_category": det.category,
            "confidence": det.confidence,
        }
        if det.observation_type == "animal":
            row["scientific_name"] = prediction.scientific_name
            row["vernacular_name"] = prediction.common_name
            row["classification_probability"] = prediction.classification_score
        if det.bbox is not None:
            x, y, w, h = det.bbox
            row.update(bbox_x=x, bbox_y=y, bbox_w=w, bbox_h=h)
        rows.append(row)
    return rows


class SpeciesNetStep(PipelineStep):
    """SpeciesNet ensemble — detection + species classification in one pass.

    Downloads each media item to a temp file (via the media resolver), runs the
    SpeciesNet ensemble, and writes media-level observations with bounding boxes,
    detection confidence, and a species guess. Images with no kept detection yield
    a single ``blank`` observation.
    """

    step_type = PipelineStepType.SPECIESNET
    model_version = SPECIESNET_VERSION

    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        import os
        import shutil
        import tempfile

        from app.domain.media_resolver import resolve_media
        from app.services.speciesnet_service import get_speciesnet_service

        start = time.monotonic()
        threshold = config.get("confidence_threshold", 0.2)
        svc = create_service_client()
        errors = 0
        observations_created = 0

        tmpdir = tempfile.mkdtemp(prefix="speciesnet_")
        path_to_media: dict[str, dict] = {}
        try:
            # Resolve each media item to a local temp file for the model.
            for m in media:
                try:
                    resolved = await resolve_media(m["file_path"], size="full")
                    if not resolved:
                        errors += 1
                        continue
                    data, _content_type = resolved
                    path = os.path.join(tmpdir, f"{m['id']}.jpg")
                    with open(path, "wb") as fh:
                        fh.write(data)
                    path_to_media[path] = m
                except Exception as exc:
                    logger.warning("speciesnet_resolve_error", media_id=m.get("id"), error=str(exc))
                    errors += 1

            predictions = await get_speciesnet_service().predict(list(path_to_media.keys()))

            timestamp = datetime.now(timezone.utc).isoformat()
            obs_batch: list[dict] = []
            for pred in predictions:
                m = path_to_media.get(pred.filepath)
                if not m:
                    continue
                obs_batch.extend(build_speciesnet_observations(m, deployment_id, pred, self.model_version, timestamp, threshold))

            if obs_batch:

                def _insert():
                    inserted = 0
                    for i in range(0, len(obs_batch), 50):
                        batch = obs_batch[i : i + 50]
                        svc.table("observations").insert(batch).execute()
                        inserted += len(batch)
                    return inserted

                observations_created = await asyncio.to_thread(_insert)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

        duration = time.monotonic() - start
        logger.info(
            "speciesnet_step_complete",
            deployment_id=deployment_id,
            media_processed=len(media),
            observations_created=observations_created,
            errors=errors,
            duration_seconds=round(duration, 2),
        )
        return PipelineStepResult(
            step=self.step_type,
            observations_created=observations_created,
            media_processed=len(media),
            errors=errors,
            duration_seconds=round(duration, 2),
            model_version=self.model_version,
        )


# ── Step Registry ────────────────────────────────────────────────────


_STEP_REGISTRY: dict[PipelineStepType, type[PipelineStep]] = {
    PipelineStepType.MEDIA_PREP: MediaPreparationStep,
    PipelineStepType.SPECIESNET: SpeciesNetStep,
    PipelineStepType.ANIMAL_CROP: AnimalCropStep,
}


def get_step(step_type: PipelineStepType) -> PipelineStep:
    """Instantiate a pipeline step by its type."""
    cls = _STEP_REGISTRY.get(step_type)
    if cls is None:
        raise ValueError(f"Unknown pipeline step type: {step_type}")
    return cls()


# ── Pipeline Orchestrator ────────────────────────────────────────────


async def run_pipeline(
    deployment_id: str,
    steps: list[PipelineStepType],
    confidence_threshold: float = 0.2,
    config: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> PipelineRunResult:
    """Execute a sequence of pipeline steps on a deployment.

    1. Fetches all media for the deployment.
    2. Runs each step sequentially, passing the full media set.
    3. Records an annotation_run for provenance.
    4. Returns aggregate results.

    Args:
        deployment_id: UUID of the target deployment.
        steps: Ordered list of pipeline step types to execute.
        confidence_threshold: Minimum confidence to keep detections.
        config: Step-specific overrides.
        user_id: Authenticated user triggering the pipeline.

    Returns:
        PipelineRunResult with per-step and aggregate metrics.
    """
    overall_start = time.monotonic()
    config = config or {}
    config["confidence_threshold"] = confidence_threshold
    svc = create_service_client()

    # 1. Fetch media for the deployment
    def _fetch_media():
        resp = (
            svc.table("media")
            .select("id, deployment_id, file_path, file_name, file_mediatype, timestamp")
            .eq("deployment_id", deployment_id)
            .order("timestamp")
            .execute()
        )
        return resp.data or []

    media = await asyncio.to_thread(_fetch_media)

    if not media:
        logger.warning("pipeline_no_media", deployment_id=deployment_id)
        return PipelineRunResult(deployment_id=deployment_id)

    # 2. Run each step
    step_results: list[PipelineStepResult] = []
    total_observations = 0

    for step_type in steps:
        step = get_step(step_type)
        logger.info("pipeline_step_start", step=step_type.value, deployment_id=deployment_id)
        result = await step.run(media, deployment_id, config)
        step_results.append(result)
        total_observations += result.observations_created

    overall_duration = time.monotonic() - overall_start

    # 3. Record annotation run
    annotation_run_id = str(uuid.uuid4())

    def _record_run():
        svc.table("annotation_runs").insert(
            {
                "id": annotation_run_id,
                "deployment_id": deployment_id,
                "run_type": "ai_inference",
                "config": {
                    "steps": [s.value for s in steps],
                    "confidence_threshold": confidence_threshold,
                    **config,
                },
                "observation_count": total_observations,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "created_by": user_id,
            }
        ).execute()

    await asyncio.to_thread(_record_run)

    logger.info(
        "pipeline_complete",
        deployment_id=deployment_id,
        steps=[s.value for s in steps],
        total_media=len(media),
        total_observations=total_observations,
        duration_seconds=round(overall_duration, 2),
    )

    return PipelineRunResult(
        deployment_id=deployment_id,
        annotation_run_id=annotation_run_id,
        steps=step_results,
        total_media=len(media),
        total_observations=total_observations,
        duration_seconds=round(overall_duration, 2),
    )
