# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the pluggable classifier contract + registry (pure logic).

Exercises classifier routing/resolution and the duck-compatibility of
``ClassifierResult`` with the observation builder — without torch/pybioclip.
"""

import pytest

from app.domain.classifiers import (
    DEFAULT_CLASSIFIER,
    BioClipClassifier,
    Classifier,
    ClassifierResult,
    available_classifiers,
    register_classifier,
    resolve_classifier,
    resolve_classifier_name,
)
from app.domain.pipeline import build_bioclip_observations


def test_default_classifier_registered():
    assert DEFAULT_CLASSIFIER in available_classifiers()
    assert isinstance(resolve_classifier(DEFAULT_CLASSIFIER), BioClipClassifier)


def test_resolve_unknown_classifier_raises():
    with pytest.raises(ValueError, match="Unknown classifier"):
        resolve_classifier("does-not-exist")


def test_routing_precedence_config_over_project_over_default():
    # Run-config override wins.
    assert resolve_classifier_name({"classifier": "gecko-net"}, "project-net") == "gecko-net"
    # Then the project setting.
    assert resolve_classifier_name({}, "project-net") == "project-net"
    assert resolve_classifier_name(None, "project-net") == "project-net"
    # Then the default.
    assert resolve_classifier_name({}, None) == DEFAULT_CLASSIFIER
    assert resolve_classifier_name(None, None) == DEFAULT_CLASSIFIER


def test_register_and_resolve_custom_classifier():
    class FakeClassifier(Classifier):
        name = "fake-net"

        @property
        def version(self) -> str:
            return "fake-1"

        async def classify(self, crop_paths, config):
            return [ClassifierResult(p, "Hoplodactylus", "gecko", 0.9, "species") for p in crop_paths]

    register_classifier(FakeClassifier.name, FakeClassifier)
    assert "fake-net" in available_classifiers()
    resolved = resolve_classifier("fake-net")
    assert resolved.version == "fake-1"


def test_classifier_result_is_duck_compatible_with_observation_builder():
    # A ClassifierResult must work in place of a bioclip CropPrediction, so any
    # registered classifier flows through the existing builder unchanged.
    result = ClassifierResult("/tmp/crop.jpg", "Naultinus elegans", "jewelled gecko", 0.82, "species")
    rows = build_bioclip_observations({"id": "m1"}, "dep1", result, "fake-1", "2026-06-06T00:00:00Z", 0.2)
    assert len(rows) == 1
    r = rows[0]
    assert r["observation_type"] == "animal"
    assert r["scientific_name"] == "Naultinus elegans"
    assert r["vernacular_name"] == "jewelled gecko"
    assert r["source_model_version"] == "fake-1"
    assert r["classification_probability"] == 0.82
    assert r["ai_origin"] == "cloud"


def test_classifier_result_below_threshold_emits_nothing():
    result = ClassifierResult("/tmp/crop.jpg", "Naultinus elegans", "jewelled gecko", 0.10, "species")
    assert build_bioclip_observations({"id": "m1"}, "dep1", result, "fake-1", "t", 0.2) == []
