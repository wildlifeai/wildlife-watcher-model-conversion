# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the email-confirmation + demo write gates."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.dependencies import get_verified_user, is_demo_user, is_email_confirmed, require_not_demo


def test_is_email_confirmed():
    assert is_email_confirmed(SimpleNamespace(email_confirmed_at="2026-06-14T00:00:00Z")) is True
    assert is_email_confirmed(SimpleNamespace(confirmed_at="2026-06-14T00:00:00Z")) is True  # legacy field
    assert is_email_confirmed(SimpleNamespace(email_confirmed_at=None, confirmed_at=None)) is False
    assert is_email_confirmed(SimpleNamespace()) is False  # neither attribute present


async def test_get_verified_user_allows_confirmed():
    user = SimpleNamespace(id="u1", email_confirmed_at="2026-06-14T00:00:00Z")
    assert await get_verified_user(user=user) is user


async def test_get_verified_user_blocks_unconfirmed():
    user = SimpleNamespace(id="u1", email_confirmed_at=None, confirmed_at=None)
    with pytest.raises(HTTPException) as exc:
        await get_verified_user(user=user)
    assert exc.value.status_code == 403
    assert "confirm your email" in exc.value.detail.lower()


def test_is_demo_user():
    assert is_demo_user(SimpleNamespace(app_metadata={"is_demo": True})) is True
    assert is_demo_user(SimpleNamespace(app_metadata={"is_demo": False})) is False
    assert is_demo_user(SimpleNamespace(app_metadata={})) is False
    assert is_demo_user(SimpleNamespace(app_metadata=None)) is False
    assert is_demo_user(SimpleNamespace()) is False  # no app_metadata attribute


async def test_require_not_demo_allows_regular_user():
    user = SimpleNamespace(id="u1", app_metadata={"provider": "email"})
    assert await require_not_demo(user=user) is user


async def test_require_not_demo_blocks_demo_account():
    user = SimpleNamespace(id="demo", app_metadata={"is_demo": True})
    with pytest.raises(HTTPException) as exc:
        await require_not_demo(user=user)
    assert exc.value.status_code == 403
    assert "disabled in the demo" in exc.value.detail.lower()


async def test_get_verified_user_blocks_demo_even_if_confirmed():
    # The demo account IS email-confirmed, so the demo check must also fire.
    user = SimpleNamespace(id="demo", email_confirmed_at="2026-06-14T00:00:00Z", app_metadata={"is_demo": True})
    with pytest.raises(HTTPException) as exc:
        await get_verified_user(user=user)
    assert exc.value.status_code == 403
    assert "disabled in the demo" in exc.value.detail.lower()
