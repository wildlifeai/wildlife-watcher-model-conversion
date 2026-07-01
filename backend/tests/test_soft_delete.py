# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Soft-delete feature: role gates + cascade helpers."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


class _Result:
    def __init__(self, data):
        self.data = data


def _chain(rows):
    t = MagicMock()
    for m in ("select", "eq", "in_", "is_", "limit"):
        getattr(t, m).return_value = t
    t.execute.return_value = _Result(rows)
    return t


def _roles_client(monkeypatch, *, org_id, roles):
    """Mock create_service_client so _resolve_org_project + _fetch_active_roles work."""
    client = MagicMock()

    def table(name):
        if name == "projects":
            return _chain([{"organisation_id": org_id}])
        if name == "user_roles":
            return _chain(roles)
        return _chain([])

    client.table.side_effect = table
    monkeypatch.setattr("app.authz.create_service_client", lambda: client)


# ── Role gates ───────────────────────────────────────────────────────────────


async def test_assert_project_writer_allows_member(monkeypatch):
    from app.authz import assert_project_writer

    _roles_client(monkeypatch, org_id="org-1", roles=[
        {"role": "project_member", "scope_type": "project", "scope_id": "proj-1", "expires_at": None},
    ])
    await assert_project_writer("u1", "proj-1")  # must not raise


async def test_assert_project_writer_denies_viewer(monkeypatch):
    from app.authz import assert_project_writer

    _roles_client(monkeypatch, org_id="org-1", roles=[
        {"role": "project_viewer", "scope_type": "project", "scope_id": "proj-1", "expires_at": None},
    ])
    with pytest.raises(HTTPException) as exc:
        await assert_project_writer("u1", "proj-1")
    assert exc.value.status_code == 404


async def test_assert_project_admin_denies_member(monkeypatch):
    from app.authz import assert_project_admin

    _roles_client(monkeypatch, org_id="org-1", roles=[
        {"role": "project_member", "scope_type": "project", "scope_id": "proj-1", "expires_at": None},
    ])
    with pytest.raises(HTTPException):
        await assert_project_admin("u1", "proj-1")


async def test_assert_project_admin_allows_org_manager(monkeypatch):
    from app.authz import assert_project_admin

    _roles_client(monkeypatch, org_id="org-1", roles=[
        {"role": "organisation_manager", "scope_type": "organisation", "scope_id": "org-1", "expires_at": None},
    ])
    await assert_project_admin("u1", "proj-1")  # org-manager of the project's org → allowed


# ── Cascade helpers ──────────────────────────────────────────────────────────


def _recording_client(dep_rows=None):
    """A svc client recording every .update(payload) call as (table_name, payload)."""
    calls: list[tuple[str, dict]] = []

    def table(name):
        t = MagicMock()
        for m in ("select", "eq", "in_", "is_"):
            getattr(t, m).return_value = t
        t.execute.return_value = _Result(dep_rows or [])

        def _update(payload):
            calls.append((name, payload))
            u = MagicMock()
            for m in ("in_", "eq", "is_"):
                getattr(u, m).return_value = u
            u.execute.return_value = _Result([])
            return u

        t.update.side_effect = _update
        return t

    client = MagicMock()
    client.table.side_effect = table
    return client, calls


def test_soft_delete_deployments_sets_deleted_at_on_children():
    from app.domain.soft_delete import soft_delete_deployments

    client, calls = _recording_client()
    soft_delete_deployments(client, ["d1", "d2"], "2026-07-01T00:00:00Z")
    tables = {name for name, _ in calls}
    assert tables == {"observations", "media", "deployments"}
    assert all(payload == {"deleted_at": "2026-07-01T00:00:00Z"} for _, payload in calls)


def test_soft_delete_deployments_noop_on_empty():
    from app.domain.soft_delete import soft_delete_deployments

    client, calls = _recording_client()
    soft_delete_deployments(client, [], "ts")
    assert calls == []


def test_soft_delete_project_cascades_to_deployments():
    from app.domain.soft_delete import soft_delete_project

    # The deployments select returns two child deployments to cascade into.
    client, calls = _recording_client(dep_rows=[{"id": "d1"}, {"id": "d2"}])
    soft_delete_project(client, "proj-1", "ts")
    tables = [name for name, _ in calls]
    assert "observations" in tables and "media" in tables
    assert "deployments" in tables and "projects" in tables


def test_restore_project_clears_deleted_at():
    from app.domain.soft_delete import restore_project

    client, calls = _recording_client(dep_rows=[{"id": "d1"}])
    restore_project(client, "proj-1", "ts")
    assert ("projects", {"deleted_at": None}) in calls
