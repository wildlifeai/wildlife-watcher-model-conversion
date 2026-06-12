# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the SpeciesNet parsing + observation-mapping (pure logic).

Exercises the SpeciesNet output parser, taxonomy-string parsing, and the
domain mapping to CamtrapDP observation rows — all without the heavy
``speciesnet`` package, a GPU, or a database.
"""

from app.domain.pipeline import build_speciesnet_observations
from app.services.speciesnet_service import (
    category_to_observation_type,
    parse_prediction_string,
    parse_speciesnet_output,
)

_RAW = {
    "predictions": [
        {
            "filepath": "/tmp/a.jpg",
            "detections": [
                {"category": "1", "label": "animal", "conf": 0.93, "bbox": [0.1, 0.2, 0.3, 0.4]},
                {"category": "1", "label": "animal", "conf": 0.10, "bbox": [0.5, 0.5, 0.1, 0.1]},
            ],
            "prediction": "uuid-1234-abcd;mammalia;apterygiformes;apterygidae;apteryx;mantelli;north island brown kiwi",
            "prediction_score": 0.87,
        },
        {
            "filepath": "/tmp/blank.jpg",
            "detections": [],
            "prediction": "",
            "prediction_score": None,
        },
    ]
}


def test_category_to_observation_type():
    assert category_to_observation_type("1") == "animal"
    assert category_to_observation_type("2") == "human"
    assert category_to_observation_type("3") == "vehicle"
    assert category_to_observation_type("banana") == "unknown"


def test_parse_prediction_string_extracts_scientific_and_common():
    sci, common = parse_prediction_string("uuid-1234-abcd;mammalia;apterygiformes;apterygidae;apteryx;mantelli;north island brown kiwi")
    assert sci == "Apteryx mantelli"
    assert common == "north island brown kiwi"


def test_parse_prediction_string_empty():
    assert parse_prediction_string("") == (None, None)
    assert parse_prediction_string(None) == (None, None)


def test_parse_speciesnet_output_shapes():
    preds = parse_speciesnet_output(_RAW)
    assert len(preds) == 2
    a, blank = preds
    assert a.filepath == "/tmp/a.jpg"
    assert len(a.detections) == 2
    assert a.detections[0].observation_type == "animal"
    assert a.detections[0].bbox == (0.1, 0.2, 0.3, 0.4)
    assert a.scientific_name == "Apteryx mantelli"
    assert a.classification_score == 0.87
    assert not a.is_blank
    assert blank.is_blank


def test_build_observations_filters_by_threshold_and_sets_bbox():
    preds = parse_speciesnet_output(_RAW)
    rows = build_speciesnet_observations({"id": "media-1"}, "dep-1", preds[0], "speciesnet-vX", "2026-06-06T00:00:00Z", confidence_threshold=0.2)
    # Only the 0.93 detection survives the 0.2 threshold.
    assert len(rows) == 1
    r = rows[0]
    assert r["deployment_id"] == "dep-1"
    assert r["media_id"] == "media-1"
    assert r["observation_level"] == "media"
    assert r["observation_type"] == "animal"
    assert r["source_type"] == "ai"
    assert r["review_status"] == "ai_reviewed"
    assert r["confidence"] == 0.93
    assert r["scientific_name"] == "Apteryx mantelli"
    assert r["vernacular_name"] == "north island brown kiwi"
    assert (r["bbox_x"], r["bbox_y"], r["bbox_w"], r["bbox_h"]) == (0.1, 0.2, 0.3, 0.4)
    assert "id" in r


def test_build_observations_blank_when_all_below_threshold():
    preds = parse_speciesnet_output(_RAW)
    rows = build_speciesnet_observations({"id": "media-1"}, "dep-1", preds[0], "speciesnet-vX", "2026-06-06T00:00:00Z", confidence_threshold=0.99)
    assert len(rows) == 1
    assert rows[0]["observation_type"] == "blank"
    assert "bbox_x" not in rows[0]  # blank rows carry no bbox (chk_bbox_complete)


def test_build_observations_blank_image():
    preds = parse_speciesnet_output(_RAW)
    rows = build_speciesnet_observations({"id": "media-2"}, "dep-1", preds[1], "speciesnet-vX", "2026-06-06T00:00:00Z")
    assert len(rows) == 1
    assert rows[0]["observation_type"] == "blank"
