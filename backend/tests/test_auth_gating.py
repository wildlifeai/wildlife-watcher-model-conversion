# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the email-confirmation write gate."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.dependencies import get_verified_user, is_email_confirmed


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
