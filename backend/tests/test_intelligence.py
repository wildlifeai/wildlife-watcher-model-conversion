# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for conservation-intelligence pure analytics helpers."""

import pytest

from app.domain.intelligence import (
    accumulation_curve,
    alert_level,
    compare_cluster_distributions,
    jaccard,
    js_divergence,
)


def test_js_divergence_identical_is_zero():
    h = {0: 10, 1: 5, 2: 3}
    assert js_divergence(h, h) == 0.0


def test_js_divergence_disjoint_is_one():
    # Non-overlapping supports → maximal JS divergence (base-2) = 1.0
    assert js_divergence({0: 10}, {1: 10}) == 1.0


def test_js_divergence_partial_between_zero_and_one():
    d = js_divergence({0: 8, 1: 2}, {0: 2, 1: 8})
    assert 0.0 < d < 1.0


def test_js_divergence_empty_is_zero():
    assert js_divergence({}, {0: 5}) == 0.0


def test_alert_level_thresholds():
    assert alert_level(0.4) == "high"
    assert alert_level(0.3) == "medium"  # > 0.15, not > 0.3
    assert alert_level(0.2) == "medium"
    assert alert_level(0.15) == "low"
    assert alert_level(0.0) == "low"


def test_compare_cluster_distributions_change_types():
    changes = compare_cluster_distributions({0: 10, 1: 5, 2: 4}, {0: 10, 1: 8, 3: 6})
    by_cluster = {c["cluster_id"]: c for c in changes}
    assert 0 not in by_cluster  # unchanged → omitted
    assert by_cluster[1]["change_type"] == "grew" and by_cluster[1]["delta"] == 3
    assert by_cluster[2]["change_type"] == "disappeared" and by_cluster[2]["delta"] == -4
    assert by_cluster[3]["change_type"] == "appeared" and by_cluster[3]["delta"] == 6
    # Sorted by absolute delta, largest first.
    assert abs(changes[0]["delta"]) >= abs(changes[-1]["delta"])


def test_jaccard():
    assert jaccard({"a", "b"}, {"a", "b"}) == 1.0
    assert jaccard({"a", "b"}, {"b", "c"}) == pytest.approx(0.3333, abs=1e-4)
    assert jaccard(set(), set()) == 0.0
    assert jaccard({"a"}, set()) == 0.0


def test_accumulation_curve():
    assert accumulation_curve(["kiwi", "kiwi", "weka", None, "kea"]) == [1, 1, 2, 2, 3]
    assert accumulation_curve([]) == []
