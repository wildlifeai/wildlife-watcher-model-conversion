# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pydantic schemas for the conservation intelligence layer."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ShiftDetectionRequest(BaseModel):
    """Two time windows to compare for ecological distribution shift (ISO-8601 UTC)."""

    period_a_start: str = Field(..., description="Period A start (ISO-8601)")
    period_a_end: str = Field(..., description="Period A end (ISO-8601)")
    period_b_start: str = Field(..., description="Period B start (ISO-8601)")
    period_b_end: str = Field(..., description="Period B end (ISO-8601)")
