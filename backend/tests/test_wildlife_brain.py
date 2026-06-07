# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for Wildlife Brain pure helpers (numpy only — no torch/hdbscan/umap)."""

import pytest

from app.domain.wildlife_brain import (
    build_cluster_assignment_rows,
    build_media_embedding_rows,
    cluster_hdbscan,
    compute_cluster_purities,
    reduce_umap,
    summarize_clusters,
)
from app.services.dinov3 import chunk


def test_summarize_clusters_counts_and_outlier_ordering():
    labels = [0, 0, 1, -1]
    confs = [0.9, 0.7, 0.5, 0.1]
    summaries = summarize_clusters(labels, confs)
    by_id = {s.cluster_id: s for s in summaries}
    assert by_id[0].image_count == 2
    assert by_id[0].mean_confidence == pytest.approx(0.8)
    assert by_id[1].image_count == 1
    assert by_id[-1].is_outlier is True
    # Outliers sort last.
    assert summaries[-1].cluster_id == -1


def test_purity_tight_clusters_are_high():
    emb = [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0]]
    labels = [0, 0, 1, 1]
    purities = compute_cluster_purities(emb, labels)
    assert purities[0] == pytest.approx(1.0)
    assert purities[1] == pytest.approx(1.0)


def test_purity_scattered_cluster_is_low_and_outliers_excluded():
    emb = [[1.0, 0.0], [0.0, 1.0], [-1.0, 0.0], [0.0, -1.0], [9.0, 9.0]]
    labels = [0, 0, 0, 0, -1]  # opposing members cancel → centroid ~0 → purity 0
    purities = compute_cluster_purities(emb, labels)
    assert purities[0] == pytest.approx(0.0, abs=1e-6)
    assert -1 not in purities  # outliers excluded


def test_build_media_embedding_rows_shape():
    rows = build_media_embedding_rows(
        media_ids=["m1", "m2"],
        deployment_id="dep",
        embedding_run_id="run",
        cluster_labels=[0, -1],
        cluster_probs=[0.9, 0.0],
        purities={0: 0.92},
        umap_xy=[(1.0, 2.0), (3.0, 4.0)],
    )
    assert rows[0]["cluster_purity"] == "high"  # 0.92 → high bucket
    assert rows[0]["is_outlier"] is False
    assert rows[0]["qdrant_point_id"] == "m1"
    assert rows[1]["is_outlier"] is True
    assert rows[1]["cluster_purity"] is None  # outlier label has no purity
    assert (rows[0]["umap_x"], rows[0]["umap_y"]) == (1.0, 2.0)


def test_build_cluster_assignment_rows_review_depth():
    summaries = summarize_clusters([0, 0, 1, -1], [0.9, 0.9, 0.5, 0.1])
    rows = build_cluster_assignment_rows("dep", "run", summaries, {0: 0.9, 1: 0.5})
    by_cluster = {r["cluster_id"]: r for r in rows}
    assert by_cluster[0]["review_depth"] == "bulk"  # 0.9 ≥ 0.85
    assert by_cluster[1]["review_depth"] == "full"  # 0.5 < 0.65
    assert by_cluster[-1]["review_depth"] is None  # outlier cluster
    assert by_cluster[-1]["is_outlier_cluster"] is True


def test_cluster_hdbscan_fallback_for_small_input():
    # Below the 'small' preset min_cluster_size (15) → single cluster, no hdbscan import.
    emb = [[0.0, 1.0]] * 5
    labels, probs = cluster_hdbscan(emb)
    assert labels == [0] * 5
    assert probs == [1.0] * 5


def test_reduce_umap_tiny_input_returns_zeros():
    coords = reduce_umap([[1.0, 2.0]] * 3, n_components=2, params={"n_neighbors": 15})
    assert coords == [(0.0, 0.0)] * 3


def test_chunk_batches():
    assert chunk([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
    assert chunk([], 3) == []
    with pytest.raises(ValueError):
        chunk([1], 0)
