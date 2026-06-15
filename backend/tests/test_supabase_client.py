# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the Supabase client factories (service-client caching)."""

import app.services.supabase_client as sc


def test_service_client_is_cached(monkeypatch):
    # Build a sentinel instead of a real client so the test is env-independent.
    sc._service_client = None
    built = []
    monkeypatch.setattr(sc, "create_client", lambda url, key: built.append((url, key)) or object())

    c1 = sc.create_service_client()
    c2 = sc.create_service_client()

    assert c1 is c2  # same instance reused
    assert len(built) == 1  # create_client called exactly once

    sc._service_client = None  # don't leak the sentinel into other tests


def test_anon_client_is_not_cached(monkeypatch):
    # The anon client must be fresh per call — it's mutated with the caller's JWT.
    built = []
    monkeypatch.setattr(sc, "create_client", lambda url, key: built.append(1) or object())

    a1 = sc.create_anon_client()
    a2 = sc.create_anon_client()

    assert a1 is not a2
    assert len(built) == 2
