# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for BMP ingest — magic-byte sniff + in-pipeline JPEG re-compression."""

import struct
from io import BytesIO

import pytest

from app.routers.exif import _is_bmp
from app.services.image_processing import to_jpeg


def _make_bmp(width: int = 4, height: int = 4) -> bytes:
    """Minimal 24-bit BMP via Pillow (so to_jpeg has something real to decode)."""
    from PIL import Image

    img = Image.new("RGB", (width, height), (120, 180, 90))
    out = BytesIO()
    img.save(out, format="BMP")
    return out.getvalue()


def test_is_bmp_detects_magic():
    assert _is_bmp(b"BM\x00\x00rest") is True
    assert _is_bmp(b"\xff\xd8\xff\xe0") is False  # JPEG
    assert _is_bmp(b"") is False
    assert _is_bmp(b"B") is False


def test_to_jpeg_converts_bmp():
    bmp = _make_bmp()
    assert _is_bmp(bmp)
    jpeg = to_jpeg(bmp, quality=90)
    # Output is a real JPEG (SOI marker), not a BMP.
    assert jpeg[:2] == b"\xff\xd8"
    assert not _is_bmp(jpeg)


def test_to_jpeg_preserves_dimensions():
    from app.services.image_processing import get_dimensions

    bmp = _make_bmp(width=12, height=8)
    jpeg = to_jpeg(bmp)
    assert get_dimensions(jpeg) == (12, 8)


def test_to_jpeg_quality_affects_size():
    # A non-trivial image so quality actually changes the encoded size.
    from PIL import Image

    img = Image.new("RGB", (64, 64))
    for x in range(64):
        for y in range(64):
            img.putpixel((x, y), ((x * 7) % 256, (y * 11) % 256, (x * y) % 256))
    out = BytesIO()
    img.save(out, format="BMP")
    bmp = out.getvalue()

    small = to_jpeg(bmp, quality=20)
    large = to_jpeg(bmp, quality=95)
    assert len(small) < len(large)


def test_to_jpeg_rejects_garbage():
    with pytest.raises(Exception):
        to_jpeg(b"not an image", quality=90)


def test_real_device_bmp_round_trips():
    """A real WW500 raw frame (if present) re-compresses cleanly."""
    import os

    path = r"C:\Users\ww\MEDIA\242025DF\IMAGES.000\A2BCEE90.BMP"
    if not os.path.exists(path):
        pytest.skip("real device BMP not available in this environment")
    with open(path, "rb") as f:
        bmp = f.read()
    assert _is_bmp(bmp)
    jpeg = to_jpeg(bmp, quality=90)
    assert jpeg[:2] == b"\xff\xd8"
    # Re-compressed JPEG should be far smaller than the 300 KB raw BMP.
    assert len(jpeg) < len(bmp)


# Keep struct imported for parity with other EXIF tests / future raw-BMP crafting.
_ = struct
