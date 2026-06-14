# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the SpeciesNet parsing + observation-mapping (pure logic).

Exercises the SpeciesNet output parser, taxonomy-string parsing, and the
domain mapping to CamtrapDP observation rows — all without the heavy
``speciesnet`` package, a GPU, or a database.
"""

from app.domain.pipeline import build_speciesnet_observations, rollup_taxon, run_pipeline
from app.jobs.definitions import _is_uuid
from app.services.speciesnet_service import (
    category_to_observation_type,
    parse_prediction_string,
    parse_speciesnet_output,
    parse_taxonomy,
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


# ── Taxonomy parsing + confidence-based roll-up (Tier 2 #5) ──────────────────


def test_parse_taxonomy_full_lineage():
    tax = parse_taxonomy("uuid-1234-abcd;mammalia;apterygiformes;apterygidae;apteryx;mantelli;north island brown kiwi")
    assert tax["class"] == "mammalia"
    assert tax["family"] == "apterygidae"
    assert tax["genus"] == "apteryx"
    assert tax["species"] == "mantelli"
    assert tax["common"] == "north island brown kiwi"


def test_parse_taxonomy_empty():
    assert parse_taxonomy("") == {}
    assert parse_taxonomy(None) == {}


_KIWI_TAX = {
    "class": "mammalia",
    "order": "apterygiformes",
    "family": "apterygidae",
    "genus": "apteryx",
    "species": "mantelli",
    "common": "north island brown kiwi",
}


def test_rollup_keeps_species_when_confident():
    sci, vern = rollup_taxon(_KIWI_TAX, 0.87)
    assert sci == "Apteryx mantelli"
    assert vern == "north island brown kiwi"


def test_rollup_backs_off_to_genus_on_mid_score():
    sci, vern = rollup_taxon(_KIWI_TAX, 0.40)
    assert sci == "Apteryx"
    assert vern is None  # no species-level common name claimed


def test_rollup_backs_off_to_family_on_low_score():
    sci, vern = rollup_taxon(_KIWI_TAX, 0.10)
    assert sci == "Apterygidae"
    assert vern is None


def test_rollup_empty_taxonomy_uses_fallback():
    sci, vern = rollup_taxon({}, 0.9, fallback_scientific="Felis catus", fallback_vernacular="cat")
    assert (sci, vern) == ("Felis catus", "cat")


# ── Detection dedup → one observation per type with count (Tier 2 #6) ────────


# ── Non-UUID deployment-id guard (unconfigured-camera "00000000" bug) ─────────


def test_is_uuid_accepts_real_uuid_rejects_folder_prefix():
    assert _is_uuid("7785fabb-e00e-4da2-aed6-a0fb906e6d79") is True
    assert _is_uuid("00000000") is False  # SD-card folder prefix, not a deployment
    assert _is_uuid("") is False
    assert _is_uuid(None) is False


async def test_run_pipeline_skips_non_uuid_deployment_without_db():
    # "00000000" (unconfigured camera) must NOT reach Postgres (would raise
    # 'invalid input syntax for type uuid'); the guard returns an empty result
    # before any DB access, so this runs with no Supabase client.
    result = await run_pipeline(deployment_id="00000000", steps=[])
    assert result.deployment_id == "00000000"
    assert result.total_observations == 0
    assert result.total_media == 0


def test_build_observations_dedups_animal_boxes_into_one_with_count():
    preds = parse_speciesnet_output(_RAW)
    # Threshold 0.0 keeps BOTH animal boxes (0.93 and 0.10).
    rows = build_speciesnet_observations({"id": "media-1"}, "dep-1", preds[0], "speciesnet-vX", "2026-06-06T00:00:00Z", confidence_threshold=0.0)
    # One animal observation, not two duplicates.
    assert len(rows) == 1
    r = rows[0]
    assert r["observation_type"] == "animal"
    assert r["count"] == 2
    # Representative bbox + confidence come from the highest-confidence box.
    assert r["confidence"] == 0.93
    assert (r["bbox_x"], r["bbox_y"], r["bbox_w"], r["bbox_h"]) == (0.1, 0.2, 0.3, 0.4)
