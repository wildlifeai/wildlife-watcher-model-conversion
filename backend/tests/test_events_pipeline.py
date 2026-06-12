# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the domain/events.py temporal clustering logic.

Tests the pure algorithmic functions without needing a Supabase connection.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.domain.events import (
    _build_event_row,
    _cluster_temporal,
    _group_observations_by_species,
)

# ── Test Data Helpers ────────────────────────────────────────────────


def _obs(
    media_timestamp: str,
    taxon_id: str | None = None,
    confidence: float = 0.5,
    media_id: str | None = None,
) -> dict:
    """Create a minimal observation dict for testing."""
    return {
        "id": str(uuid.uuid4()),
        "deployment_id": "dep-001",
        "media_id": media_id or str(uuid.uuid4()),
        "taxon_id": taxon_id,
        "scientific_name": None,
        "confidence": confidence,
        "created_at": media_timestamp,
        "media_timestamp": media_timestamp,
    }


# ── _group_observations_by_species ───────────────────────────────────


class TestGroupObservationsBySpecies:
    def test_groups_by_taxon_id(self):
        obs = [
            _obs("2025-01-01T10:00:00Z", taxon_id="kiwi"),
            _obs("2025-01-01T10:05:00Z", taxon_id="possum"),
            _obs("2025-01-01T10:10:00Z", taxon_id="kiwi"),
        ]
        groups = _group_observations_by_species(obs)
        assert len(groups) == 2
        assert len(groups["kiwi"]) == 2
        assert len(groups["possum"]) == 1

    def test_unclassified_grouped_under_none(self):
        obs = [
            _obs("2025-01-01T10:00:00Z", taxon_id=None),
            _obs("2025-01-01T10:05:00Z", taxon_id=None),
        ]
        groups = _group_observations_by_species(obs)
        assert len(groups) == 1
        assert None in groups
        assert len(groups[None]) == 2

    def test_empty_list(self):
        groups = _group_observations_by_species([])
        assert groups == {}


# ── _cluster_temporal ────────────────────────────────────────────────


class TestClusterTemporal:
    def test_single_cluster_within_gap(self):
        """All observations within 30-minute gap → 1 cluster."""
        base = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
        obs = [_obs((base + timedelta(minutes=i * 5)).isoformat()) for i in range(5)]
        clusters = _cluster_temporal(obs, gap_minutes=30)
        assert len(clusters) == 1
        assert len(clusters[0]) == 5

    def test_two_clusters_with_gap(self):
        """Observations split by a 60-minute gap → 2 clusters."""
        base = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
        obs = [
            _obs((base + timedelta(minutes=0)).isoformat()),
            _obs((base + timedelta(minutes=5)).isoformat()),
            _obs((base + timedelta(minutes=65)).isoformat()),  # gap > 30 min
            _obs((base + timedelta(minutes=70)).isoformat()),
        ]
        clusters = _cluster_temporal(obs, gap_minutes=30)
        assert len(clusters) == 2
        assert len(clusters[0]) == 2
        assert len(clusters[1]) == 2

    def test_each_observation_is_own_cluster(self):
        """Observations 2 hours apart with 30-min gap → each is own cluster."""
        base = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
        obs = [_obs((base + timedelta(hours=i * 2)).isoformat()) for i in range(3)]
        clusters = _cluster_temporal(obs, gap_minutes=30)
        assert len(clusters) == 3

    def test_empty_observations(self):
        clusters = _cluster_temporal([], gap_minutes=30)
        assert clusters == []

    def test_single_observation(self):
        obs = [_obs("2025-01-01T10:00:00Z")]
        clusters = _cluster_temporal(obs, gap_minutes=30)
        assert len(clusters) == 1
        assert len(clusters[0]) == 1

    def test_exact_boundary_gap(self):
        """Observations exactly at the gap boundary → same cluster (<=)."""
        base = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
        obs = [
            _obs(base.isoformat()),
            _obs((base + timedelta(minutes=30)).isoformat()),
        ]
        clusters = _cluster_temporal(obs, gap_minutes=30)
        # 30 minutes = 1800 seconds, gap_seconds = 30 * 60 = 1800
        # delta (1800) > gap_seconds (1800) is False → same cluster
        assert len(clusters) == 1

    def test_one_second_over_boundary(self):
        """Observations 30m01s apart with 30-min gap → 2 clusters."""
        base = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
        obs = [
            _obs(base.isoformat()),
            _obs((base + timedelta(minutes=30, seconds=1)).isoformat()),
        ]
        clusters = _cluster_temporal(obs, gap_minutes=30)
        assert len(clusters) == 2

    def test_unsorted_input_is_handled(self):
        """Observations provided out of order should still cluster correctly."""
        base = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
        obs = [
            _obs((base + timedelta(minutes=65)).isoformat()),
            _obs(base.isoformat()),
            _obs((base + timedelta(minutes=5)).isoformat()),
        ]
        clusters = _cluster_temporal(obs, gap_minutes=30)
        assert len(clusters) == 2
        # First cluster: 10:00, 10:05. Second cluster: 11:05.
        assert len(clusters[0]) == 2
        assert len(clusters[1]) == 1


# ── _build_event_row ─────────────────────────────────────────────────


class TestBuildEventRow:
    def test_basic_event(self):
        base = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
        cluster = [
            _obs(base.isoformat(), confidence=0.3),
            _obs((base + timedelta(minutes=5)).isoformat(), confidence=0.9),
            _obs((base + timedelta(minutes=10)).isoformat(), confidence=0.6),
        ]
        row = _build_event_row(cluster, "dep-001", "kiwi-id", "user-001")
        assert row["deployment_id"] == "dep-001"
        assert row["taxon_id"] == "kiwi-id"
        assert row["event_duration_seconds"] == 600  # 10 minutes
        assert row["media_count"] == 3
        assert row["review_status"] == "ai_reviewed"
        assert row["created_by"] == "user-001"
        # Primary media should be from the highest confidence observation
        best_media = max(cluster, key=lambda o: o["confidence"])
        assert row["primary_media_id"] == best_media["media_id"]

    def test_single_observation_event(self):
        obs = _obs("2025-01-01T10:00:00Z", confidence=0.8)
        row = _build_event_row([obs], "dep-001", None)
        assert row["event_duration_seconds"] == 0
        assert row["media_count"] == 1
        assert row["taxon_id"] is None

    def test_confidence_average(self):
        cluster = [
            _obs("2025-01-01T10:00:00Z", confidence=0.4),
            _obs("2025-01-01T10:01:00Z", confidence=0.6),
        ]
        row = _build_event_row(cluster, "dep-001", "sp1")
        assert row["confidence"] == pytest.approx(0.5, abs=0.01)

    def test_uuid_is_generated(self):
        cluster = [_obs("2025-01-01T10:00:00Z")]
        row = _build_event_row(cluster, "dep-001", None)
        # Should be a valid UUID string
        uuid.UUID(row["id"])


# ── Schema validation tests ──────────────────────────────────────────


class TestPipelineSchemas:
    def test_pipeline_run_request_defaults(self):
        from app.schemas.pipeline import PipelineRunRequest, PipelineStepType

        req = PipelineRunRequest(deployment_id="abc-123")
        assert req.steps == [PipelineStepType.SPECIESNET]
        assert req.confidence_threshold == 0.2
        assert req.config == {}

    def test_cluster_events_request_defaults(self):
        from app.schemas.pipeline import ClusterEventsRequest

        req = ClusterEventsRequest(deployment_id="abc-123")
        assert req.gap_minutes == 30
        assert req.min_images == 1

    def test_cluster_events_request_validation(self):
        from app.schemas.pipeline import ClusterEventsRequest

        with pytest.raises(Exception):
            ClusterEventsRequest(deployment_id="x", gap_minutes=0)  # min 1
        with pytest.raises(Exception):
            ClusterEventsRequest(deployment_id="x", gap_minutes=1441)  # max 1440

    def test_pipeline_step_type_enum(self):
        from app.schemas.pipeline import PipelineStepType

        assert PipelineStepType.MEDIA_PREP.value == "media_prep"
        assert PipelineStepType.SPECIESNET.value == "speciesnet"
        assert PipelineStepType.ANIMAL_CROP.value == "animal_crop"


# ── Pipeline step registry tests ─────────────────────────────────────


class TestPipelineStepRegistry:
    def test_get_known_steps(self):
        from app.domain.pipeline import get_step
        from app.schemas.pipeline import PipelineStepType

        step = get_step(PipelineStepType.MEDIA_PREP)
        assert step.step_type == PipelineStepType.MEDIA_PREP

        step = get_step(PipelineStepType.SPECIESNET)
        assert step.step_type == PipelineStepType.SPECIESNET

        step = get_step(PipelineStepType.ANIMAL_CROP)
        assert step.step_type == PipelineStepType.ANIMAL_CROP

    def test_unknown_step_raises(self):
        from app.domain.pipeline import get_step
        from app.schemas.pipeline import PipelineStepType

        with pytest.raises(ValueError, match="Unknown pipeline step"):
            get_step(PipelineStepType.CUSTOM)
