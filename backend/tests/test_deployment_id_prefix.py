# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit tests for ``deployment_id_prefix_bounds`` (folder-prefix → uuid range).

Guards the fix for the swallowed Postgres 42883 (`uuid ~~* unknown`) that silently
dropped BMP frames on upload and made ``/deployments/validate`` misreport existing
deployments as ``not_found``.
"""

from app.authz import deployment_id_prefix_bounds


def test_bounds_bracket_a_matching_uuid():
    """Any uuid whose text starts with the prefix must fall within [lo, hi]."""
    lo, hi = deployment_id_prefix_bounds("7785FABB")
    # Real seeded deployment id that starts with this folder prefix.
    dep = "7785fabb-e00e-4da2-aed6-a0fb906e6d79"
    assert lo <= dep <= hi
    # Bounds are lowercase, canonical, and span the full time_low band.
    assert lo == "7785fabb-0000-0000-0000-000000000000"
    assert hi == "7785fabb-ffff-ffff-ffff-ffffffffffff"


def test_bounds_exclude_a_non_matching_uuid():
    lo, hi = deployment_id_prefix_bounds("242025DF")
    other = "7785fabb-e00e-4da2-aed6-a0fb906e6d79"
    assert not (lo <= other <= hi)


def test_case_insensitive():
    assert deployment_id_prefix_bounds("ABCDEF01") == deployment_id_prefix_bounds("abcdef01")


def test_rejects_non_hex_or_wrong_length():
    assert deployment_id_prefix_bounds("IMAGES00") is None  # I,M,G,S not hex
    assert deployment_id_prefix_bounds("7785FAB") is None  # 7 chars
    assert deployment_id_prefix_bounds("7785FABBA") is None  # 9 chars
    assert deployment_id_prefix_bounds("") is None
