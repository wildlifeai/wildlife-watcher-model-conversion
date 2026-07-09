# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit tests for the pgvector store's pure helpers + service wiring."""

import pytest

from app.services.vector_store import (
    PgVectorService,
    build_payload,
    format_vector,
    get_vector_service,
    parse_vector,
    validate_vectors,
)


def test_format_vector_is_pgvector_literal():
    assert format_vector([1.0, 2.5, -3.0]) == "[1.0,2.5,-3.0]"
    assert format_vector([]) == "[]"


def test_parse_vector_handles_string_list_and_none():
    assert parse_vector("[1.0,2.5,-3.0]") == [1.0, 2.5, -3.0]
    assert parse_vector([1, 2, 3]) == [1.0, 2.0, 3.0]
    assert parse_vector(None) is None


def test_format_parse_roundtrip():
    v = [0.123456, -0.98765, 0.0]
    assert parse_vector(format_vector(v)) == pytest.approx(v)


def test_build_payload_drops_none():
    p = build_payload(deployment_id="d1", embedding_run_id="r1", cluster_id=3, taxon_id=None)
    assert p == {"deployment_id": "d1", "embedding_run_id": "r1", "cluster_id": 3}


def test_validate_vectors_enforces_dim():
    validate_vectors([[0.0] * 384, [1.0] * 384], expected=384)  # ok
    with pytest.raises(ValueError):
        validate_vectors([[0.0] * 384, [1.0] * 383], expected=384)


def test_get_vector_service_binds_model_dim_and_caches():
    s_vits = get_vector_service("dinov3-vits")
    assert isinstance(s_vits, PgVectorService)
    assert s_vits.model_name == "dinov3-vits"
    assert s_vits.dim == 384
    # default (no model) → server ViT-H, 1280-d
    s_default = get_vector_service()
    assert s_default.model_name == "dinov3-vith"
    assert s_default.dim == 1280
    # same instance returned for the same key (cache)
    assert get_vector_service("dinov3-vits") is s_vits
