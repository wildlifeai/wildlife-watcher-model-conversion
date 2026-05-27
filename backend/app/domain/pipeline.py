# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pluggable AI inference pipeline framework — pure domain logic.

Defines the PipelineStep abstract base class and concrete implementations
for MegaDetector V6 (detection), SpeciesNet (classification), and
empty-frame suppression. Steps are composable and run sequentially.

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


# ── MegaDetector V6 Step (Stub) ──────────────────────────────────────


class MegaDetectorStep(PipelineStep):
    """MegaDetector V6 object detection step.

    In production, this runs PyTorchWildlife (MegaDetector V6) to detect
    animals, persons, and vehicles in camera trap images. The current
    implementation is a stub that creates placeholder observations.

    When GPU infrastructure is available, this step will:
    1. Download images from Supabase Storage → local temp dir
    2. Run MegaDetector V6 via PyTorchWildlife batch inference
    3. Parse bounding box results into observation rows
    4. Insert observations with source_type='ai' and link to ai_model
    """

    step_type = PipelineStepType.MEGADETECTOR
    model_version = "MDv6-stub"

    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        start = time.monotonic()
        _confidence_threshold = config.get("confidence_threshold", 0.2)  # Used in production
        svc = create_service_client()
        observations_created = 0
        errors = 0

        # Stub: For each media item, create a placeholder 'unreviewed' observation.
        # In production, this would run the actual model inference.
        obs_batch: list[dict] = []
        for m in media:
            try:
                obs_row = {
                    "id": str(uuid.uuid4()),
                    "deployment_id": deployment_id,
                    "media_id": m["id"],
                    "observation_level": "media",
                    "observation_type": "unknown",
                    "source_type": "ai",
                    "source_model_version": self.model_version,
                    "review_status": "ai_reviewed",
                    "confidence": 0.0,  # Stub: no real confidence
                    "classification_method": "machine",
                }
                obs_batch.append(obs_row)
            except Exception as exc:
                logger.warning(
                    "megadetector_media_error",
                    media_id=m.get("id"),
                    error=str(exc),
                )
                errors += 1

        # Bulk insert observations
        if obs_batch:

            def _insert():
                chunk_size = 50
                inserted = 0
                for i in range(0, len(obs_batch), chunk_size):
                    batch = obs_batch[i : i + chunk_size]
                    svc.table("observations").insert(batch).execute()
                    inserted += len(batch)
                return inserted

            observations_created = await asyncio.to_thread(_insert)

        duration = time.monotonic() - start
        logger.info(
            "megadetector_step_complete",
            deployment_id=deployment_id,
            media_processed=len(media),
            observations_created=observations_created,
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


# ── SpeciesNet Classification Step (Stub) ────────────────────────────


class SpeciesNetStep(PipelineStep):
    """SpeciesNet species classification step.

    Classifies animal crops from MegaDetector detections using Google's
    SpeciesNet model. Currently a stub — production version will:
    1. Crop detected animals using bounding boxes
    2. Run SpeciesNet inference on each crop
    3. Update observations with taxon_id and classification_probability
    """

    step_type = PipelineStepType.SPECIES_CLASSIFIER
    model_version = "SpeciesNet-stub"

    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        start = time.monotonic()

        # Stub: No-op. In production, this would classify animal crops.
        logger.info(
            "speciesnet_step_stub",
            deployment_id=deployment_id,
            media_count=len(media),
        )

        return PipelineStepResult(
            step=self.step_type,
            media_processed=len(media),
            duration_seconds=round(time.monotonic() - start, 2),
            model_version=self.model_version,
        )


# ── Empty Frame Suppression Step ─────────────────────────────────────


class EmptyFrameStep(PipelineStep):
    """Empty frame detection and suppression step.

    Identifies media frames that contain no animals (blank triggers)
    and creates observations with observation_type='blank' and a
    confidence score for the emptiness assessment.

    Currently a stub — production version will use a lightweight
    classifier or MegaDetector's empty-frame confidence.
    """

    step_type = PipelineStepType.EMPTY_FRAME
    model_version = "EmptyFrame-stub"

    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        start = time.monotonic()

        logger.info(
            "empty_frame_step_stub",
            deployment_id=deployment_id,
            media_count=len(media),
        )

        return PipelineStepResult(
            step=self.step_type,
            media_processed=len(media),
            duration_seconds=round(time.monotonic() - start, 2),
            model_version=self.model_version,
        )


# ── Step Registry ────────────────────────────────────────────────────


_STEP_REGISTRY: dict[PipelineStepType, type[PipelineStep]] = {
    PipelineStepType.MEGADETECTOR: MegaDetectorStep,
    PipelineStepType.SPECIES_CLASSIFIER: SpeciesNetStep,
    PipelineStepType.EMPTY_FRAME: EmptyFrameStep,
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
