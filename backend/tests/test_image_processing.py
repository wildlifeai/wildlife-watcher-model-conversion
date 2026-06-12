# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the Pillow image-processing helpers (pure, in-memory)."""

from io import BytesIO

from PIL import Image

from app.services.image_processing import crop_bbox, get_dimensions, resize_to_max


def _jpeg(width: int, height: int, color=(120, 180, 90)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="JPEG")
    return buf.getvalue()


def test_get_dimensions():
    assert get_dimensions(_jpeg(640, 480)) == (640, 480)


def test_resize_downscales_longest_edge():
    out = resize_to_max(_jpeg(1000, 500), 300)
    assert get_dimensions(out) == (300, 150)


def test_resize_does_not_upscale():
    out = resize_to_max(_jpeg(100, 50), 300)
    assert get_dimensions(out) == (100, 50)


def test_resize_portrait_uses_height_as_longest_edge():
    out = resize_to_max(_jpeg(400, 800), 400)
    assert get_dimensions(out) == (200, 400)


def test_crop_bbox_returns_valid_subregion():
    src = _jpeg(400, 400)
    crop = crop_bbox(src, (0.25, 0.25, 0.5, 0.5), padding=0.0)
    w, h = get_dimensions(crop)
    # 0.5 of 400 = 200px, no padding.
    assert (w, h) == (200, 200)


def test_crop_bbox_padding_expands_and_clamps():
    src = _jpeg(400, 400)
    # bbox at the edge with padding must clamp inside the image (no error, non-empty).
    crop = crop_bbox(src, (0.0, 0.0, 0.5, 0.5), padding=0.5)
    w, h = get_dimensions(crop)
    assert 0 < w <= 400 and 0 < h <= 400


def test_crop_bbox_tiny_box_is_non_empty():
    src = _jpeg(100, 100)
    crop = crop_bbox(src, (0.5, 0.5, 0.0, 0.0), padding=0.0)
    w, h = get_dimensions(crop)
    assert w >= 1 and h >= 1
