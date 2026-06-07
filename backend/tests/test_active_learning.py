# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for active-learning + QA pure helpers."""

import pytest

from app.domain.active_learning import combine_al_score, compute_qa_metrics


def test_combine_al_score_all_zero():
    assert combine_al_score(0.0, 0.0, 0.0, False) == 0.0


def test_combine_al_score_weights():
    # 0.35*1 + 0.35*1 + 0.20*1 + 0.10*1 = 1.0
    assert combine_al_score(1.0, 1.0, 1.0, True) == 1.0
    # novelty only → 0.35
    assert combine_al_score(1.0, 0.0, 0.0, False) == 0.35
    # uncertainty only → 0.35
    assert combine_al_score(0.0, 1.0, 0.0, False) == 0.35
    # disagreement only → 0.20
    assert combine_al_score(0.0, 0.0, 1.0, False) == 0.20
    # outlier only → 0.10
    assert combine_al_score(0.0, 0.0, 0.0, True) == 0.10


def test_combine_al_score_clamps_inputs():
    # out-of-range inputs are clamped to [0,1]
    assert combine_al_score(5.0, -2.0, 0.0, False) == 0.35  # novelty clamps to 1, uncertainty to 0


def test_qa_metrics_only_counts_pairs_with_both_labels():
    pairs = [
        ("Apteryx mantelli", "Apteryx mantelli"),  # match
        ("Gallirallus", "gallirallus"),  # match (case-insensitive)
        ("Mustela", "Trichosurus"),  # mismatch
        ("Felis catus", None),  # ignored (no human)
        (None, "Sus scrofa"),  # ignored (no ai)
    ]
    m = compute_qa_metrics(pairs)
    assert m["n_compared"] == 3
    assert m["matches"] == 2
    assert m["precision"] == pytest.approx(0.6667, abs=1e-4)


def test_qa_metrics_empty():
    assert compute_qa_metrics([]) == {"n_compared": 0, "matches": 0, "precision": None}
    assert compute_qa_metrics([(None, None), ("x", None)])["precision"] is None
