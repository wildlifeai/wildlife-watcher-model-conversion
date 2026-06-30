# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the Qdrant service.

Covers the pure helpers and import-safety (module must load without
qdrant-client installed). Live upsert/search behaviour belongs in an
integration test against a local Qdrant container — see the note at the bottom.
"""

import pytest

from app.registries.embedding_registry import EMBEDDING_DIM
from app.services.qdrant_client import (
    QdrantService,
    SimilarPoint,
    build_match_conditions,
    build_payload,
    get_qdrant_service,
    validate_vector_dim,
    validate_vectors,
)


def test_validate_vector_dim_accepts_correct_length():
    validate_vector_dim([0.0] * EMBEDDING_DIM)  # no raise


def test_validate_vector_dim_rejects_wrong_length():
    with pytest.raises(ValueError, match="dim mismatch"):
        validate_vector_dim([0.0] * 768)  # the DINOv2 dim is explicitly invalid


def test_validate_vectors_reports_offending_index():
    good = [0.0] * EMBEDDING_DIM
    with pytest.raises(ValueError, match="index 1"):
        validate_vectors([good, [0.0] * 10])


def test_build_match_conditions_drops_none():
    conds = build_match_conditions(deployment_id="d1", taxon_id=None, review_status="ai_reviewed")
    assert conds == {"deployment_id": "d1", "review_status": "ai_reviewed"}


def test_build_payload_keeps_required_and_drops_optional_none():
    payload = build_payload(deployment_id="d1", embedding_run_id="r1", cluster_id=3)
    assert payload == {"deployment_id": "d1", "embedding_run_id": "r1", "cluster_id": 3}
    assert "taxon_id" not in payload  # null optionals omitted


def test_build_payload_includes_all_when_present():
    payload = build_payload(
        deployment_id="d1",
        embedding_run_id="r1",
        org_id="o1",
        taxon_id="t1",
        cluster_id=0,
        review_status="human_reviewed",
    )
    assert payload["org_id"] == "o1"
    assert payload["taxon_id"] == "t1"
    assert payload["cluster_id"] == 0  # 0 is a valid cluster label, must be kept
    assert payload["review_status"] == "human_reviewed"


def test_similar_point_shape():
    p = SimilarPoint(id="m1", score=0.97, payload={"deployment_id": "d1"})
    assert (p.id, p.score, p.payload["deployment_id"]) == ("m1", 0.97, "d1")


def test_service_constructs_without_server_or_qdrant_installed():
    # No client is created until a method is called, so this never touches qdrant.
    svc = QdrantService(url="http://example:6333", collection="test_collection")
    assert svc.collection == "test_collection"
    assert svc._client is None


def test_service_uses_settings_defaults():
    svc = QdrantService()
    assert svc.collection  # from settings.QDRANT_COLLECTION


def test_get_qdrant_service_is_singleton():
    assert get_qdrant_service() is get_qdrant_service()


# Integration (run manually with a local Qdrant):
#   docker run -p 6333:6333 qdrant/qdrant
#   QDRANT_URL=http://localhost:6333 pytest -m integration
# would exercise ensure_collection / upsert / search / count against a real server.
