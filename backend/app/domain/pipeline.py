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
from typing import Any, Awaitable, Callable, Optional

import structlog

from app.schemas.pipeline import (
    PipelineRunResult,
    PipelineStepResult,
    PipelineStepType,
)
from app.services.bioclip_service import BIOCLIP_VERSION
from app.services.speciesnet_service import SPECIESNET_VERSION
from app.services.supabase_client import create_service_client

logger = structlog.get_logger()


# ── Cloud-model registry IDs ─────────────────────────────────────────
# annotation_runs.chk_annotation_run_provenance requires every ai_inference run to
# cite a model_id (FK → ai_models). The cloud models below have no uploaded artifact,
# so they are seeded as stable system rows (see ww-backend cloud-model seed). These
# UUIDs MUST match those rows. The run's model_id is the primary model among the steps
# that ran, in this priority order.
CLOUD_MODEL_IDS: dict[PipelineStepType, str] = {
    PipelineStepType.SPECIESNET: "a0000000-0000-4000-8000-000000000001",
    PipelineStepType.BIOCLIP: "a0000000-0000-4000-8000-000000000002",
}


def _resolve_run_model_id(steps: list[PipelineStepType]) -> Optional[str]:
    """Pick the primary model for the annotation_runs provenance row (SpeciesNet > BioCLIP)."""
    for step_type in (PipelineStepType.SPECIESNET, PipelineStepType.BIOCLIP):
        if step_type in steps and step_type in CLOUD_MODEL_IDS:
            return CLOUD_MODEL_IDS[step_type]
    return None


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


# ── BioCLIP Step (secondary zero-shot classifier) ────────────────────


def build_bioclip_observations(
    media: dict,
    deployment_id: str,
    prediction,  # services.bioclip_service.CropPrediction (duck-typed)
    model_version: str,
    timestamp: str,
    confidence_threshold: float = 0.0,
) -> list[dict]:
    """Map a BioCLIP CropPrediction to a CamtrapDP observation row (pure).

    BioCLIP has no detector, so it never produces blanks — it only adds an
    ``animal`` observation carrying its species guess. The row is tagged with
    BioCLIP's own ``source_model_version`` so it sits alongside (not on top of)
    the SpeciesNet observation, enabling ensemble/disagreement views. Below the
    threshold, or with no name, nothing is emitted.
    """
    if not prediction.scientific_name:
        return []
    if prediction.score is not None and prediction.score < confidence_threshold:
        return []
    return [
        {
            "id": str(uuid.uuid4()),
            "deployment_id": deployment_id,
            "media_id": media["id"],
            "observation_level": "media",
            "observation_type": "animal",
            "source_type": "ai",
            "source_model_version": model_version,
            "review_status": "ai_reviewed",
            "classification_method": "machine",
            "classified_by": model_version,
            "classification_timestamp": timestamp,
            "scientific_name": prediction.scientific_name,
            "vernacular_name": prediction.common_name,
            "classification_probability": prediction.score,
            "confidence": prediction.score,
        }
    ]


class BioCLIPStep(PipelineStep):
    """BioCLIP secondary classifier — runs on animal crops, not raw frames.

    Prefers each media's ``media_assets.animal_crop_url`` (produced by
    AnimalCropStep) and falls back to the full image. Writes one extra ``animal``
    observation per crop tagged with BioCLIP's model version — a second opinion
    that complements SpeciesNet rather than replacing it.

    Config overrides:
      - ``bioclip_labels``: list[str] → constrain to a custom label set.
      - ``bioclip_rank``:   str       → Tree-of-Life rank (default 'species').
      - ``confidence_threshold``: float (shared with the run).
    """

    step_type = PipelineStepType.BIOCLIP
    model_version = BIOCLIP_VERSION

    async def run(
        self,
        media: list[dict],
        deployment_id: str,
        config: dict[str, Any],
    ) -> PipelineStepResult:
        import os
        import shutil
        import tempfile

        from app.config import settings
        from app.domain.media_resolver import resolve_media
        from app.services.bioclip_service import get_bioclip_service

        start = time.monotonic()
        if not settings.FF_BIOCLIP_ENABLED:
            logger.info("bioclip_step_skipped_disabled", deployment_id=deployment_id)
            return PipelineStepResult(
                step=self.step_type, media_processed=0, model_version=self.model_version
            )

        threshold = config.get("confidence_threshold", 0.0)
        labels = config.get("bioclip_labels")
        rank = config.get("bioclip_rank", settings.BIOCLIP_RANK)
        svc = create_service_client()
        errors = 0
        observations_created = 0

        # Prefer the animal crop (better signal) over the full frame.
        media_ids = [m["id"] for m in media]

        def _fetch_crops() -> dict[str, str]:
            resp = (
                svc.table("media_assets")
                .select("media_id, animal_crop_url")
                .in_("media_id", media_ids)
                .execute()
            )
            return {
                r["media_id"]: r["animal_crop_url"]
                for r in (resp.data or [])
                if r.get("animal_crop_url")
            }

        crop_map = await asyncio.to_thread(_fetch_crops)

        tmpdir = tempfile.mkdtemp(prefix="bioclip_")
        path_to_media: dict[str, dict] = {}
        try:
            for m in media:
                source = crop_map.get(m["id"]) or m.get("file_path")
                if not source:
                    continue
                try:
                    resolved = await resolve_media(source, size="full")
                    if not resolved:
                        errors += 1
                        continue
                    data, _content_type = resolved
                    path = os.path.join(tmpdir, f"{m['id']}.jpg")
                    with open(path, "wb") as fh:
                        fh.write(data)
                    path_to_media[path] = m
                except Exception as exc:
                    logger.warning("bioclip_resolve_error", media_id=m.get("id"), error=str(exc))
                    errors += 1

            predictions = await get_bioclip_service().predict(
                list(path_to_media.keys()), labels=labels, rank=rank
            )

            timestamp = datetime.now(timezone.utc).isoformat()
            obs_batch: list[dict] = []
            for pred in predictions:
                m = path_to_media.get(pred.filepath)
                if not m:
                    continue
                obs_batch.extend(
                    build_bioclip_observations(
                        m, deployment_id, pred, self.model_version, timestamp, threshold
                    )
                )

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
            "bioclip_step_complete",
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
    PipelineStepType.BIOCLIP: BioCLIPStep,
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
    only_unannotated: bool = True,
    on_step: Optional[Callable[[str, int, int], Awaitable[None]]] = None,
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
    # Wall-clock start for the annotation_runs row. Must be set explicitly: if we let
    # started_at fall back to the DB default now(), it is evaluated at INSERT time —
    # after the Python-computed completed_at below — violating the table's
    # CHECK (completed_at >= started_at) constraint.
    run_started_at = datetime.now(timezone.utc)
    config = config or {}
    config["confidence_threshold"] = confidence_threshold
    svc = create_service_client()

    # 1. Fetch media for the deployment.
    # Guard 2: by default skip media that already have an AI observation, so the
    # pipeline is idempotent + incremental — re-running only processes NEW images
    # (and a manual run can pass only_unannotated=False to force a full re-run).
    def _fetch_media():
        resp = (
            svc.table("media")
            .select("id, deployment_id, file_path, file_name, file_mediatype, timestamp")
            .eq("deployment_id", deployment_id)
            .order("timestamp")
            .execute()
        )
        rows = resp.data or []
        if only_unannotated and rows:
            ai = (
                svc.table("observations")
                .select("media_id")
                .eq("deployment_id", deployment_id)
                .eq("source_type", "ai")
                .not_.is_("media_id", "null")
                .execute()
                .data
                or []
            )
            annotated = {o["media_id"] for o in ai}
            rows = [m for m in rows if m["id"] not in annotated]
        return rows

    media = await asyncio.to_thread(_fetch_media)

    if not media:
        logger.warning("pipeline_no_media", deployment_id=deployment_id)
        return PipelineRunResult(deployment_id=deployment_id)

    # 2. Run each step
    step_results: list[PipelineStepResult] = []
    total_observations = 0

    for _idx, step_type in enumerate(steps):
        step = get_step(step_type)
        logger.info("pipeline_step_start", step=step_type.value, deployment_id=deployment_id)
        if on_step is not None:
            # Report step start so callers (e.g. the upload job) can surface granular
            # AI-pipeline progress + logs instead of a frozen bar.
            await on_step(step_type.value, _idx, len(steps))
        result = await step.run(media, deployment_id, config)
        step_results.append(result)
        total_observations += result.observations_created

    overall_duration = time.monotonic() - overall_start

    # 3. Record annotation run (best-effort provenance).
    # The observations are already committed by the steps above; a failure to write
    # this bookkeeping row must NOT mark the whole inference run as failed. model_id
    # (required by annotation_runs.chk_annotation_run_provenance for ai_inference) is
    # resolved from the steps via CLOUD_MODEL_IDS, whose rows are seeded in ww-backend
    # supabase/seeds/dev/data.sql. The try/except is a safety net for envs missing
    # those rows (or any other transient write failure).
    annotation_run_id = str(uuid.uuid4())
    run_model_id = _resolve_run_model_id(steps)

    def _record_run():
        svc.table("annotation_runs").insert(
            {
                "id": annotation_run_id,
                "deployment_id": deployment_id,
                "run_type": "ai_inference",
                "model_id": run_model_id,
                "config": {
                    "steps": [s.value for s in steps],
                    "confidence_threshold": confidence_threshold,
                    **config,
                },
                "observation_count": total_observations,
                "started_at": run_started_at.isoformat(),
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "created_by": user_id,
            }
        ).execute()

    try:
        await asyncio.to_thread(_record_run)
    except Exception as exc:  # noqa: BLE001 — provenance is non-critical
        logger.warning(
            "annotation_run_record_failed",
            deployment_id=deployment_id,
            observations=total_observations,
            error=str(exc),
        )

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
