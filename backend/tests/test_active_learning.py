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


# ── recompute_scores persistence ─────────────────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


async def test_recompute_scores_bulk_upserts_in_chunks(monkeypatch):
    """Scores are persisted via chunked bulk upserts, not one update per row."""
    from unittest.mock import MagicMock

    from app.domain.active_learning import recompute_scores

    embeddings = [
        {"media_id": f"m{i}", "cluster_confidence": 0.5, "is_outlier": False}
        for i in range(1200)
    ]
    upsert_payloads = []

    me_table = MagicMock()
    me_table.select.return_value = me_table
    me_table.eq.return_value = me_table
    me_table.is_.return_value = me_table
    me_table.execute.return_value = _Result(embeddings)

    def _upsert(payload):
        upsert_payloads.append(payload)
        chained = MagicMock()
        chained.execute.return_value = _Result([])
        return chained

    me_table.upsert.side_effect = _upsert

    obs_table = MagicMock()
    obs_table.select.return_value = obs_table
    obs_table.eq.return_value = obs_table
    obs_table.is_.return_value = obs_table
    obs_table.execute.return_value = _Result([])

    client = MagicMock()
    client.table.side_effect = lambda name: me_table if name == "media_embeddings" else obs_table
    monkeypatch.setattr("app.services.supabase_client.create_service_client", lambda: client)

    updated = await recompute_scores("dep-1")

    assert updated == 1200
    assert [len(p) for p in upsert_payloads] == [500, 500, 200]
    # Only the score columns are supplied — never enough to insert a new row.
    assert set(upsert_payloads[0][0]) == {"media_id", "active_learning_score", "al_score_updated_at"}
