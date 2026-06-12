# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the BioCLIP parsing + observation-mapping (pure logic).

Exercises the pybioclip output parser, scientific-name extraction, and the
domain mapping to CamtrapDP observation rows — all without the heavy
``bioclip`` package, a GPU, or a database.
"""

from app.domain.pipeline import build_bioclip_observations
from app.services.bioclip_service import (
    CropPrediction,
    parse_bioclip_output,
)

# Tree-of-Life style rows: one per (image, candidate), each with file_name + score.
_TOL_ROWS = [
    {"file_name": "/tmp/a.jpg", "genus": "Vulpes", "species": "vulpes", "common_name": "Red Fox", "score": 0.81, "kingdom": "Animalia"},
    {"file_name": "/tmp/a.jpg", "genus": "Canis", "species": "lupus", "common_name": "Gray Wolf", "score": 0.12},
    {"file_name": "/tmp/b.jpg", "genus": "Ardea", "species": "Ardea cinerea", "common_name": "Grey Heron", "score": 0.74},
]

# Custom-label style rows: single classification string + score.
_CUSTOM_ROWS = [
    {"file_name": "/tmp/c.jpg", "classification": "Sus scrofa", "score": 0.66},
]


def test_parse_keeps_top_scoring_candidate_per_image():
    preds = {p.filepath: p for p in parse_bioclip_output(_TOL_ROWS, rank="species")}
    assert set(preds) == {"/tmp/a.jpg", "/tmp/b.jpg"}
    # Highest score wins for /tmp/a.jpg (fox 0.81 > wolf 0.12).
    assert preds["/tmp/a.jpg"].scientific_name == "Vulpes vulpes"
    assert preds["/tmp/a.jpg"].common_name == "Red Fox"
    assert preds["/tmp/a.jpg"].score == 0.81


def test_scientific_name_handles_binomial_species_field():
    # When 'species' already contains the binomial, it isn't doubled with genus.
    preds = {p.filepath: p for p in parse_bioclip_output(_TOL_ROWS)}
    assert preds["/tmp/b.jpg"].scientific_name == "Ardea cinerea"


def test_parse_custom_label_rows():
    preds = parse_bioclip_output(_CUSTOM_ROWS)
    assert len(preds) == 1
    assert preds[0].scientific_name == "Sus scrofa"
    assert preds[0].score == 0.66


def test_build_observation_row():
    pred = CropPrediction(
        filepath="/tmp/a.jpg",
        scientific_name="Vulpes vulpes",
        common_name="Red Fox",
        score=0.81,
        rank="species",
    )
    rows = build_bioclip_observations({"id": "m1"}, "dep1", pred, "bioclip-2", "2026-01-01T00:00:00Z", 0.2)
    assert len(rows) == 1
    r = rows[0]
    assert r["observation_type"] == "animal"
    assert r["source_type"] == "ai"
    assert r["source_model_version"] == "bioclip-2"
    assert r["review_status"] == "ai_reviewed"
    assert r["classification_method"] == "machine"
    assert r["scientific_name"] == "Vulpes vulpes"
    assert r["classification_probability"] == 0.81


def test_build_observation_drops_below_threshold():
    pred = CropPrediction("/tmp/a.jpg", "Vulpes vulpes", "Red Fox", 0.10, "species")
    assert build_bioclip_observations({"id": "m1"}, "dep1", pred, "bioclip-2", "t", 0.2) == []


def test_build_observation_drops_when_no_name():
    pred = CropPrediction("/tmp/a.jpg", None, None, 0.99, "species")
    assert build_bioclip_observations({"id": "m1"}, "dep1", pred, "bioclip-2", "t", 0.0) == []
