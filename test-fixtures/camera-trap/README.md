# Camera-trap test fixtures (WIP — deferred)

> **Status:** scaffolding only. The trial images were removed (they were test frames
> with **no animals**, so they couldn't exercise SpeciesNet). New animal photos will be
> collected later, and the EXIF "template" finished then. Keep this folder as the starting point.

## Goal

A fixed, reproducible set of ~20–100 camera-trap images that bind to **known seed deployments**
so that, on every fresh dev DB, the same images can be uploaded to test the **AI + annotation
pipeline** end-to-end.

## How binding works (verified)

`ww-backend/supabase/seeds/dev/data.sql` creates NZ-monitoring deployments with **deterministic
UUIDs** (org `c0000000-0000-0000-0000-000000000005`). The website's uploader
(`ww-website/backend/app/domain/exif.py → match_deployment`) binds an image to a deployment by:

1. **Exact deployment UUID** found in EXIF `UserComment` / `Deployment_ID` / `Custom_Data`.  ✅ verified working
2. **GPS proximity** (~50 m) to the deployment's coords.  ⚠️ see caveat below

`deployments.json` holds the target deployments (edit/extend as needed):

| Label | Deployment | UUID | GPS |
|-------|-----------|------|-----|
| `zealandia-kiwi` | Zealandia Kiwi Watch | `e0000000-…-000000000010` | -41.2903, 174.7530 |
| `abel-tasman-weka` | Abel Tasman Weka Survey | `e0000000-…-000000000011` | -41.0050, 173.0200 |
| `milford-kea` | Milford Kea Lookout | `e0000000-…-000000000012` | -44.8948, 167.6261 |

## Usage (once photos exist)

```bash
pip install pillow piexif
# 1. Drop curated JPEGs into source/<label>/ (one folder per deployment in deployments.json)
# 2. Stamp EXIF + build the uploadable tree:
python prepare.py            # writes MEDIA/<label>/IMAGES.000/*.JPG
# 3. Drag MEDIA/ into the website upload (logged in as a user with access to org c0000000-…-000005)
```

`prepare.py` writes, per image: `UserComment = WW-DEPLOYMENT:<uuid>` (exact match),
GPS = deployment coords (fallback), and an incrementing `DateTimeOriginal`.

## Open items for "the template issue"

- **GPS fallback not yet landing.** `prepare.py` writes GPS via `piexif`, which emits a
  **big-endian (`MM`)** TIFF, but the backend parser hard-codes **little-endian** when decoding
  RATIONALs (`exif.py _format_value`, the `"<II"` unpack). Result: GPS reads back as `None`.
  The **UUID path still binds correctly**, so this is non-blocking, but to make the GPS fallback
  work, either (a) emit little-endian EXIF, or (b) fix the parser to honour the detected endianness.
- Curate a mix of **animal frames** (SpeciesNet detections), **blank frames** (blank handling),
  and some **night/IR** frames (Zealandia is nocturnal).
- Decide whether to commit the generated `MEDIA/` or keep it git-ignored and regenerated.
