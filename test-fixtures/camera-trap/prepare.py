#!/usr/bin/env python3
"""Stamp the curated camera-trap fixtures with seed-deployment EXIF.

Reads deployments.json and, for every JPEG under ``source/<label>/``, writes an
EXIF-stamped copy into ``MEDIA/<label>/IMAGES.000/`` so it binds to the matching
seed deployment when uploaded to the Wildlife Watcher website.

Binding (see ww-website/backend/app/domain/exif.py → match_deployment):
  1. EXIF ``UserComment`` carries ``WW-DEPLOYMENT:<uuid>`` → exact deployment match.
  2. EXIF GPS coords = the deployment's lat/lon → ~50 m proximity fallback.
Both are written, so the images bind even if one signal is lost.

Usage:
    pip install pillow piexif
    python prepare.py            # regenerates ./MEDIA from ./source + deployments.json
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timedelta

import piexif
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "source")
OUT = os.path.join(HERE, "MEDIA")


def _deg_to_dms_rationals(value: float):
    """Decimal degrees → ((d,1),(m,1),(s,100)) rationals for EXIF GPS."""
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = round((value - d - m / 60) * 3600, 2)
    return ((d, 1), (m, 1), (int(s * 100), 100))


def _exif_bytes(deployment_id: str, lat: float, lon: float, when: datetime) -> bytes:
    dt = when.strftime("%Y:%m:%d %H:%M:%S")
    zeroth = {piexif.ImageIFD.DateTime: dt}
    exif = {
        piexif.ExifIFD.DateTimeOriginal: dt,
        piexif.ExifIFD.DateTimeDigitized: dt,
        # UserComment: 8-byte charcode prefix + payload. The backend regex finds
        # the UUID anywhere in the decoded string, so the "ASCII" prefix is fine.
        piexif.ExifIFD.UserComment: b"ASCII\x00\x00\x00" + f"WW-DEPLOYMENT:{deployment_id}".encode("ascii"),
    }
    gps = {
        piexif.GPSIFD.GPSLatitudeRef: "S" if lat < 0 else "N",
        piexif.GPSIFD.GPSLatitude: _deg_to_dms_rationals(lat),
        piexif.GPSIFD.GPSLongitudeRef: "W" if lon < 0 else "E",
        piexif.GPSIFD.GPSLongitude: _deg_to_dms_rationals(lon),
    }
    return piexif.dump({"0th": zeroth, "Exif": exif, "GPS": gps})


def main() -> None:
    cfg = json.load(open(os.path.join(HERE, "deployments.json"), encoding="utf-8"))
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)

    total = 0
    for fx in cfg["fixtures"]:
        label = fx["label"]
        src_dir = os.path.join(SOURCE, label)
        if not os.path.isdir(src_dir):
            print(f"!! missing source/{label} — skipping")
            continue
        dst_dir = os.path.join(OUT, label, "IMAGES.000")
        os.makedirs(dst_dir, exist_ok=True)

        base = datetime.fromisoformat(fx["base_timestamp"])
        step = timedelta(minutes=fx.get("interval_minutes", 5))
        imgs = sorted(f for f in os.listdir(src_dir) if f.lower().endswith((".jpg", ".jpeg")))

        for i, name in enumerate(imgs):
            when = base + i * step
            exif = _exif_bytes(fx["deployment_id"], fx["latitude"], fx["longitude"], when)
            # Re-save through Pillow so the EXIF is embedded cleanly.
            im = Image.open(os.path.join(src_dir, name)).convert("RGB")
            out_name = f"{label}-{i:02d}.JPG"
            im.save(os.path.join(dst_dir, out_name), "JPEG", quality=80, exif=exif)
            total += 1
        print(f"{label}: stamped {len(imgs)} -> MEDIA/{label}/IMAGES.000/  ({fx['name']})")

    print(f"\nDone - {total} images in {OUT}")
    print("Drag the MEDIA/ folder into the website upload to test the AI + annotation pipeline.")


if __name__ == "__main__":
    main()
