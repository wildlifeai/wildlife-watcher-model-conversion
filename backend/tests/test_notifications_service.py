# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Notification emitter is strictly opt-in — no rule means no notification."""

from unittest.mock import MagicMock, patch

import pytest

from app.services import notifications_service as ns


def _svc_with(observations, members, rules):
    """Build a mock service client whose table(...) chains return canned data.

    The emitter calls: deployments, observations, user_roles, notification_rules,
    users, then inserts into notifications. We route by table name and capture the
    rows inserted into `notifications`.
    """
    inserted: list = []

    def table(name):
        t = MagicMock()
        # All filter methods are chainable and return the same mock.
        for m in ("select", "eq", "gte", "in_", "is_", "not_", "limit"):
            getattr(t, m).return_value = t
        t.not_.is_.return_value = t

        if name == "deployments":
            t.execute.return_value = MagicMock(data=[{"project_id": "proj-1", "location_name": "New Plymouth"}])
        elif name == "observations":
            t.execute.return_value = MagicMock(data=observations)
        elif name == "user_roles":
            t.execute.return_value = MagicMock(data=[{"user_id": u} for u in members])
        elif name == "notification_rules":
            t.execute.return_value = MagicMock(data=rules)
        elif name == "users":
            t.execute.return_value = MagicMock(data=[{"id": u, "email": f"{u}@ww.org"} for u in members])
        elif name == "notifications":
            def _insert(rows):
                inserted.extend(rows)
                return MagicMock(execute=lambda: MagicMock(data=rows))
            t.insert.side_effect = _insert
        return t

    svc = MagicMock()
    svc.table.side_effect = table
    return svc, inserted


@pytest.mark.asyncio
async def test_member_without_rule_gets_no_notification():
    """A project member who has selected nothing must not be notified."""
    svc, inserted = _svc_with(
        observations=[{"scientific_name": "Rattus rattus", "vernacular_name": "ship rat"}],
        members=["tui"],            # member of the project
        rules=[],                   # but has NO active notification rule
    )
    with patch.object(ns, "create_service_client", return_value=svc):
        count = await ns.emit_detection_notifications("dep-1")
    assert count == 0
    assert inserted == []


@pytest.mark.asyncio
async def test_member_with_web_rule_is_notified():
    svc, inserted = _svc_with(
        observations=[{"scientific_name": "Rattus rattus", "vernacular_name": "ship rat"}],
        members=["tui"],
        rules=[{"user_id": "tui", "species_filter": None, "channels": ["web"], "digest": "immediate"}],
    )
    with patch.object(ns, "create_service_client", return_value=svc):
        count = await ns.emit_detection_notifications("dep-1")
    assert count == 1
    assert inserted[0]["user_id"] == "tui"
    assert inserted[0]["type"] == "species_detection"


@pytest.mark.asyncio
async def test_active_rule_with_empty_channels_is_not_notified():
    """An empty channel set means 'off' — never silently fall back to web."""
    svc, inserted = _svc_with(
        observations=[{"scientific_name": "Rattus rattus", "vernacular_name": "ship rat"}],
        members=["tui"],
        rules=[{"user_id": "tui", "species_filter": None, "channels": [], "digest": "immediate"}],
    )
    with patch.object(ns, "create_service_client", return_value=svc):
        count = await ns.emit_detection_notifications("dep-1")
    assert count == 0
    assert inserted == []


@pytest.mark.asyncio
async def test_species_filter_limits_matches():
    """A rule filtered to 'rat' is not notified about a possum detection."""
    svc, inserted = _svc_with(
        observations=[{"scientific_name": "Trichosurus vulpecula", "vernacular_name": "possum"}],
        members=["tui"],
        rules=[{"user_id": "tui", "species_filter": "rat", "channels": ["web"], "digest": "immediate"}],
    )
    with patch.object(ns, "create_service_client", return_value=svc):
        count = await ns.emit_detection_notifications("dep-1")
    assert count == 0
    assert inserted == []
