# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for Media Registry URL resolution (pure)."""

from io import BytesIO

import numpy as np
from PIL import Image

from app.domain import media_registry
from app.domain.media_registry import generate_motion_roi_crops, group_bursts, resolve_url, with_resolved_urls


def test_thumbnail_prefers_thumbnail_url():
    row = {"id": "m1", "file_path": "gdrive://abc", "media_assets": {"thumbnail_url": "cdn/t.jpg", "preview_url": "cdn/p.jpg"}}
    assert resolve_url(row, "thumbnail") == "cdn/t.jpg"


def test_thumbnail_falls_back_to_preview_then_original():
    row = {"id": "m1", "file_path": "gdrive://abc", "media_assets": {"preview_url": "cdn/p.jpg"}}
    assert resolve_url(row, "thumbnail") == "cdn/p.jpg"

    row_none = {"id": "m1", "file_path": "gdrive://abc", "media_assets": {}}
    # No renditions, private storage → proxy endpoint (thumb).
    assert resolve_url(row_none, "thumbnail") == "/api/media/m1/image?size=thumb"


def test_preview_falls_back_to_original_not_thumbnail():
    row = {"id": "m1", "file_path": "gdrive://abc", "media_assets": {"thumbnail_url": "cdn/t.jpg"}}
    # preview missing → original (full proxy), never the tiny thumbnail.
    assert resolve_url(row, "preview") == "/api/media/m1/image?size=full"


def test_original_public_url_passthrough():
    row = {"id": "m1", "file_path": "https://example.com/img.jpg", "media_assets": {}}
    assert resolve_url(row, "original") == "https://example.com/img.jpg"


def test_original_private_uses_proxy():
    row = {"id": "m1", "file_path": "gdrive://abc"}
    assert resolve_url(row, "original") == "/api/media/m1/image?size=full"


def test_media_assets_as_list_is_normalised():
    # PostgREST nests a 1:1 relation as a single-element list.
    row = {"id": "m1", "file_path": "gdrive://abc", "media_assets": [{"thumbnail_url": "cdn/t.jpg"}]}
    assert resolve_url(row, "thumbnail") == "cdn/t.jpg"


def test_with_resolved_urls_adds_all_sizes():
    row = {"id": "m1", "file_path": "https://x/y.jpg", "media_assets": [{"thumbnail_url": "cdn/t.jpg"}]}
    out = with_resolved_urls(row)
    assert out["thumbnail_url"] == "cdn/t.jpg"
    assert out["preview_url"] == "https://x/y.jpg"  # no preview rendition → original public url
    assert out["original_url"] == "https://x/y.jpg"
    assert out["id"] == "m1"  # original fields preserved


# ── Burst grouping (pure) ─────────────────────────────────────────────


def _row(mid: str, ts):
    return {"id": mid, "file_path": f"gdrive://{mid}", "timestamp": ts}


def test_group_bursts_splits_on_time_gap():
    rows = [
        _row("a", "2026-06-15T10:00:00Z"),
        _row("b", "2026-06-15T10:00:03Z"),  # +3s → same burst
        _row("c", "2026-06-15T10:05:00Z"),  # +297s → new burst
        _row("d", "2026-06-15T10:05:02Z"),  # +2s → same burst
    ]
    bursts = group_bursts(rows, gap_seconds=10.0)
    assert [[m["id"] for m in b] for b in bursts] == [["a", "b"], ["c", "d"]]


def test_group_bursts_unparseable_timestamp_starts_new_group():
    rows = [_row("a", "2026-06-15T10:00:00Z"), _row("b", None), _row("c", "not-a-date")]
    bursts = group_bursts(rows, gap_seconds=10.0)
    # Each frame stands alone: a has no following neighbour within gap, b/c are unparseable.
    assert [[m["id"] for m in b] for b in bursts] == [["a"], ["b"], ["c"]]


# ── Motion-ROI fallback crop (I/O monkeypatched) ──────────────────────


def _frame_bytes(square=None):
    arr = np.zeros((240, 320, 3), dtype=np.uint8)
    if square is not None:
        x0, y0, x1, y1 = square
        arr[y0:y1, x0:x1, :] = 255
    buf = BytesIO()
    Image.fromarray(arr).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


async def test_generate_motion_roi_crops_writes_for_moving_frames(monkeypatch):
    # A two-frame burst with a moving white square → motion ROI found → crop written.
    rows = [
        _row("a", "2026-06-15T10:00:00Z"),
        _row("b", "2026-06-15T10:00:02Z"),
    ]
    payloads = {
        "gdrive://a": _frame_bytes(square=(120, 90, 160, 130)),
        "gdrive://b": _frame_bytes(square=(150, 95, 190, 135)),
    }

    async def fake_resolve(file_path, size="full"):
        return payloads[file_path], "image/jpeg"

    async def fake_upload(path, data):
        return f"cdn/{path}"

    upserts: list[dict] = []

    async def fake_upsert(patch):
        upserts.append(patch)

    monkeypatch.setattr("app.domain.media_resolver.resolve_media", fake_resolve)
    monkeypatch.setattr("app.services.storage.upload_rendition", fake_upload)
    monkeypatch.setattr(media_registry, "_upsert_media_assets", fake_upsert)

    created = await generate_motion_roi_crops("dep1", rows, burst_gap_seconds=10.0)

    assert created == len(upserts) >= 1
    assert all(u["animal_crop_url"].startswith("cdn/crops/dep1/") for u in upserts)


async def test_generate_motion_roi_crops_skips_existing_crops(monkeypatch):
    rows = [_row("a", "2026-06-15T10:00:00Z"), _row("b", "2026-06-15T10:00:02Z")]
    payloads = {
        "gdrive://a": _frame_bytes(square=(120, 90, 160, 130)),
        "gdrive://b": _frame_bytes(square=(150, 95, 190, 135)),
    }

    async def fake_resolve(file_path, size="full"):
        return payloads[file_path], "image/jpeg"

    async def fake_upload(path, data):
        return f"cdn/{path}"

    upserts: list[dict] = []

    async def fake_upsert(patch):
        upserts.append(patch)

    monkeypatch.setattr("app.domain.media_resolver.resolve_media", fake_resolve)
    monkeypatch.setattr("app.services.storage.upload_rendition", fake_upload)
    monkeypatch.setattr(media_registry, "_upsert_media_assets", fake_upsert)

    # Both frames already have a detection crop → nothing written.
    created = await generate_motion_roi_crops("dep1", rows, skip_media_ids={"a", "b"})
    assert created == 0
    assert upserts == []


def test_generate_motion_roi_crops_singleton_burst_noops():
    # A lone frame can't be differenced; group_bursts yields a singleton the crop loop skips.
    rows = [_row("a", "2026-06-15T10:00:00Z")]
    assert group_bursts(rows, gap_seconds=10.0) == [rows]
    # Exercised indirectly: with <2 frames the function returns 0 without any I/O.
    import asyncio

    assert asyncio.run(generate_motion_roi_crops("dep1", rows)) == 0
