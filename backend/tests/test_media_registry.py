# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for Media Registry URL resolution (pure)."""

from app.domain.media_registry import resolve_url, with_resolved_urls


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
