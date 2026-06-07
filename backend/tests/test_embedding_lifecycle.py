# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for embedding-lifecycle pure helpers (cost estimate + run comparison)."""

from app.domain.embedding_lifecycle import estimate_embedding_cost, summarize_run_comparison


def test_estimate_embedding_cost_zero():
    est = estimate_embedding_cost(0)
    assert est == {"image_count": 0, "ms_per_image": 75.0, "gpu_hours": 0.0, "est_usd": 0.0}


def test_estimate_embedding_cost_scales():
    # 100k images @ 75ms = 7,500,000 ms = 2083.33 s = ~2.08 GPU-hours; @ $3/h ≈ $6.25
    est = estimate_embedding_cost(100_000)
    assert est["gpu_hours"] == 2.08
    assert est["est_usd"] == 6.25


def test_estimate_embedding_cost_custom_rates():
    est = estimate_embedding_cost(3600 * 1000, ms_per_image=1.0, gpu_usd_per_hour=2.0)
    # 3.6M images @ 1ms = 3.6M ms = 3600 s = 1.0 GPU-hour → $2.00
    assert est["gpu_hours"] == 1.0
    assert est["est_usd"] == 2.0


def test_summarize_run_comparison_counts_and_taxa_diff():
    rows_a = [
        {"cluster_id": 0, "taxon_id": "kiwi", "image_count": 10, "is_outlier_cluster": False},
        {"cluster_id": 1, "taxon_id": "weka", "image_count": 5, "is_outlier_cluster": False},
        {"cluster_id": -1, "taxon_id": None, "image_count": 2, "is_outlier_cluster": True},
    ]
    rows_b = [
        {"cluster_id": 0, "taxon_id": "kiwi", "image_count": 12, "is_outlier_cluster": False},
        {"cluster_id": 1, "taxon_id": "stoat", "image_count": 4, "is_outlier_cluster": False},
        {"cluster_id": 2, "taxon_id": "possum", "image_count": 3, "is_outlier_cluster": False},
    ]
    out = summarize_run_comparison(rows_a, rows_b)
    assert out["run_a"]["clusters"] == 2  # outlier excluded
    assert out["run_b"]["clusters"] == 3
    assert out["cluster_delta"] == 1
    assert out["run_a"]["confirmed_taxa"] == 2
    assert out["run_a"]["images"] == 17  # includes outlier image_count in totals
    assert out["taxa_added"] == ["possum", "stoat"]
    assert out["taxa_removed"] == ["weka"]


def test_summarize_run_comparison_empty():
    out = summarize_run_comparison([], [])
    assert out["run_a"]["clusters"] == 0
    assert out["taxa_added"] == []
    assert out["taxa_removed"] == []
