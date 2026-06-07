# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""SpeciesNet adapter — detector + classifier ensemble (infrastructure layer).

SpeciesNet (Google) bundles a MegaDetector-family detector with a ~2k-species
classifier. This service loads the model once and returns a normalised,
SpeciesNet-shape-independent result (``ImagePrediction``) that the domain layer
maps to CamtrapDP ``observations`` rows.

Design (per backend agent skill — services do infra only, no FastAPI):

- ``speciesnet`` (torch/tf, large) is imported **lazily** inside the model
  getter so this module loads in the lean API image and in tests without the
  package installed.
- The output parser and taxonomy helpers are pure (no third-party imports), so
  the mapping logic is unit-testable against captured SpeciesNet JSON without a
  GPU or model download.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Optional, Sequence

import structlog

logger = structlog.get_logger()

# Pinned model + provenance string written to observations.source_model_version.
SPECIESNET_MODEL = "kaggle:google/speciesnet/pyTorch/v4.0.1a"
SPECIESNET_VERSION = "speciesnet-v4.0.1a"

# SpeciesNet/MegaDetector detection categories → CamtrapDP observation_type.
_CATEGORY_TO_TYPE = {
    "1": "animal",
    "2": "human",
    "3": "vehicle",
    "animal": "animal",
    "human": "human",
    "vehicle": "vehicle",
}


# ── Normalised result types (no third-party imports) ─────────────────


@dataclass(frozen=True)
class Detection:
    """One detection from the SpeciesNet detector."""

    category: str  # raw SpeciesNet category ("1"/"2"/"3" or label)
    observation_type: str  # mapped: animal | human | vehicle | unknown
    confidence: float
    bbox: Optional[tuple[float, float, float, float]]  # (x, y, w, h) normalised 0-1


@dataclass(frozen=True)
class ImagePrediction:
    """Per-image SpeciesNet result: detections + best species classification."""

    filepath: str
    detections: list[Detection]
    scientific_name: Optional[str]
    common_name: Optional[str]
    classification_score: Optional[float]

    @property
    def is_blank(self) -> bool:
        return len(self.detections) == 0


# ── Pure helpers ─────────────────────────────────────────────────────


def category_to_observation_type(category: Any) -> str:
    """Map a SpeciesNet detection category to a CamtrapDP observation_type."""
    return _CATEGORY_TO_TYPE.get(str(category).lower(), "unknown")


def parse_prediction_string(prediction: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Parse a SpeciesNet taxonomy string into (scientific_name, common_name).

    SpeciesNet encodes the classification as a semicolon-delimited taxonomy, e.g.
    ``"<uuid>;mammalia;...;apteryx;mantelli;north island brown kiwi"``. The common
    name is the last field; the scientific name is "<genus> <species>" when both
    are present, otherwise the most specific non-empty rank.
    """
    if not prediction:
        return None, None
    parts = [p.strip() for p in prediction.split(";")]
    # Drop a leading UUID field if present (SpeciesNet prefixes one).
    if parts and ("-" in parts[0] and " " not in parts[0]):
        parts = parts[1:]
    parts = [p for p in parts if p]
    if not parts:
        return None, None
    common_name = parts[-1] or None
    ranks = parts[:-1] if len(parts) > 1 else parts
    genus = ranks[-2] if len(ranks) >= 2 else None
    species = ranks[-1] if ranks else None
    if genus and species:
        scientific_name = f"{genus} {species}".strip().capitalize()
    else:
        scientific_name = species or genus or None
        if scientific_name:
            scientific_name = scientific_name.capitalize()
    return scientific_name, common_name


def _parse_bbox(raw: Any) -> Optional[tuple[float, float, float, float]]:
    """Coerce a SpeciesNet bbox ([x, y, w, h] normalised) into a 4-tuple."""
    if not raw or len(raw) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in raw)
    except (TypeError, ValueError):
        return None
    return (x, y, w, h)


def parse_speciesnet_output(raw: dict[str, Any]) -> list[ImagePrediction]:
    """Convert raw SpeciesNet ``predict`` output into ``ImagePrediction`` list.

    Tolerant of missing fields so a partial/older SpeciesNet response still maps
    cleanly. Detection confidence key is ``conf``; classification is the
    ``prediction``/``prediction_score`` pair.
    """
    out: list[ImagePrediction] = []
    for pred in raw.get("predictions", []) or []:
        detections: list[Detection] = []
        for det in pred.get("detections", []) or []:
            category = det.get("category", det.get("label", "unknown"))
            detections.append(
                Detection(
                    category=str(category),
                    observation_type=category_to_observation_type(category),
                    confidence=float(det.get("conf", det.get("confidence", 0.0)) or 0.0),
                    bbox=_parse_bbox(det.get("bbox")),
                )
            )
        scientific_name, common_name = parse_prediction_string(pred.get("prediction"))
        score = pred.get("prediction_score")
        out.append(
            ImagePrediction(
                filepath=pred.get("filepath", ""),
                detections=detections,
                scientific_name=scientific_name,
                common_name=common_name,
                classification_score=float(score) if score is not None else None,
            )
        )
    return out


# ── Service ──────────────────────────────────────────────────────────


class SpeciesNetService:
    """Lazy-loaded SpeciesNet ensemble. Construct once; reuse across requests."""

    def __init__(self, model_name: str = SPECIESNET_MODEL) -> None:
        self.model_name = model_name
        self.version = SPECIESNET_VERSION
        self._model = None  # lazily constructed speciesnet.SpeciesNet

    def _get_model(self):
        if self._model is None:
            from speciesnet import SpeciesNet  # heavy (torch/tf) — imported on first use

            logger.info("speciesnet_loading", model=self.model_name)
            self._model = SpeciesNet(self.model_name)
        return self._model

    async def predict(self, image_paths: Sequence[str]) -> list[ImagePrediction]:
        """Run the ensemble on local image paths (off the event loop)."""
        if not image_paths:
            return []

        def _run() -> dict[str, Any]:
            model = self._get_model()
            return model.predict(filepaths=list(image_paths))

        raw = await asyncio.to_thread(_run)
        return parse_speciesnet_output(raw)


_service: Optional[SpeciesNetService] = None


def get_speciesnet_service() -> SpeciesNetService:
    """Return a process-wide SpeciesNetService instance."""
    global _service
    if _service is None:
        _service = SpeciesNetService()
    return _service
