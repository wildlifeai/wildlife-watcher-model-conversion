# Analysis — Ingesting BMP (raw) Frames Alongside Device JPEG

> **Status:** 🔧 Active spec — current engineering hand-off; kept current until shipped.

**Context:** the WW500's on-device JPEG compression is degrading image quality noticeably, so we want
to ingest the raw BMP frames and let the **website** do the JPEG compression in the upload pipeline.

## How the device actually captures (researched — corrects earlier assumptions)

Confirmed in the firmware
([`image_task.c`](../../../Seeed_Grove_Vision_AI_Module_V2/EPII_CM55M_APP_S/app/ww_projects/ww500_md/image_task.c) ~line 994):

- BMP capture is a **diagnostic mode** (`#ifdef INVESTIGATE_BMP` + the `TEST_BIT_SAVE_BMP` test bit =
  bit 1 of `OP_PARAMETER.TEST_MODE_BITS`, Op 18). It is **not** a normal production setting.
- In that mode the device **alternates one format per frame**: `if (g_cur_jpegenc_frame % 2 == 0)`
  → BMP, else → JPG. **It never saves both formats of the same frame.** A BMP and the adjacent JPG are
  *different* captures.
- With **Pictures-per-trigger = 2** (the mobile app's recommended default when BMP is on), each motion
  trigger fires two consecutive frames → frame 0 (even) = **BMP**, frame 1 (odd) = **JPG**, ~`PICTURE_INTERVAL`
  (default 500 ms) apart. So per trigger you get a *near-pair* — same event, slightly different frames.
- The BMP is **GRAY8 (8-bit grayscale, raw sensor)** — `bmp_create_gray8_header`, 1078-byte header.
  The sensor is monochrome, so there's no colour to recover; the quality loss is purely JPEG
  quantization.

**Consequence for de-duplication:** because each file is a *distinct frame* (not two encodings of one
frame), there is **nothing to dedupe or pair**. The website should ingest each BMP and each JPG as its
own media row — which is exactly what the implemented pipeline does. The earlier "pair the BMP with its
JPEG and drop the duplicate" plan does **not** apply to this alternating mode.

## TL;DR recommendation

**Ingest each BMP as its own frame, re-compressed to JPEG in the upload pipeline at a controlled
quality** (`FF_BMP_INGEST_ENABLED`, `BMP_JPEG_QUALITY`, both shipped). This fixes quality
(website-controlled compression beats the device's), keeps Drive storage sane (store the re-compressed
JPEG, not the 308 KB BMP), and needs no pairing. Measured on a real 640×480 frame:
device JPEG ≈ 17 KB (lossy) vs website re-compress **q90 ≈ 52 KB**, q95 ≈ 85 KB — same resolution,
much better fidelity. BMP frames carry no EXIF, so they bind via folder path + hex-filename timestamp
(both already handled).

## What already works in our favour

The pipeline does **not** depend solely on JPEG EXIF for two of the three things it needs:

| Need | JPEG today | BMP path |
|------|-----------|----------|
| **Deployment binding** | EXIF `Deployment_ID` (0xF200) | Folder prefix `MEDIA/<8-hex>/` — **already extracted** by `routers/exif.py` (`_FOLDER_DEP_RE`) and the frontend |
| **Capture timestamp** | EXIF `DateTimeOriginal` | Hex **filename** → timestamp — **already decoded** by `_hex_filename_to_timestamp()` in `routers/exif.py` |
| **On-device AI / telemetry** | EXIF `UserComment` (now parsed) | ❌ none — BMP has no metadata container |

So a BMP can bind to its deployment and get a timestamp **with code we already have**. The only thing
it cannot carry is the EXIF payload (NN scores, telemetry, Make/Model).

## The blockers

1. **BMP has no EXIF.** The format has no standard metadata container. A BMP frame has no
   `Deployment_ID`, no `UserComment` (NN scores + telemetry), no Make/Model — it binds via the folder
   path + hex-filename timestamp instead (both already handled). On-device AI scores / telemetry are
   only available on the JPG frames of the same trigger.
2. **The parser rejects non-JPEG.** `parse_exif_from_bytes()` returns `{"error": "Not a valid JPEG"}`
   for anything not starting `FF D8`. A BMP starts `42 4D` ("BM"). The route branches on magic bytes.
3. **The frontend filters to JPEG.** `AnalyseImages.tsx` kept files matching `image/*` **or**
   `.jpg/.jpeg`; `.bmp` admission was inconsistent on folder drops (empty `f.type`). Now matched
   explicitly.
4. **Storage cost.** 308 KB/BMP is ~18× a device JPEG. We do **not** store raw BMP in Drive —
   re-compress to JPEG first (q90 ≈ 52 KB).
5. **AI pipeline & renditions.** Format-agnostic in practice — `media_registry` renditions and
   `resolve_media` go through PIL (reads BMP) — but we convert to JPEG at the route anyway, so
   `build_photo_filename` (always `.jpg`) and the hard-coded `file_mediatype = image/jpeg` are correct.

> **No pairing/dedup** — see "How the device actually captures": alternating mode emits one format per
> frame, so a BMP and a JPG are distinct captures, not two encodings of one. Each is its own media row.

## Implemented (shipped)

- **Frontend** `AnalyseImages.tsx`: admit `.bmp`.
- **Backend** `routers/exif.py`: `_is_bmp()` magic-byte sniff → when `FF_BMP_INGEST_ENABLED`,
  `to_jpeg()` (`services/image_processing.py`) re-compresses at `BMP_JPEG_QUALITY`, swaps the name to
  `.jpg`, binds via folder prefix + hex-filename timestamp; when disabled, BMPs are ignored (not
  stored). No DB schema change (`file_mediatype` is hard-coded `image/jpeg` for the upload path and the
  Drive filename is timestamp-derived).
- **Config:** `FF_BMP_INGEST_ENABLED` (default off in code; **on** in `docker-compose.yml` for the dev
  trial — set it on the Azure Container App for dev-cloud), `BMP_JPEG_QUALITY` (90).
- **Tests:** `test_bmp_ingest.py` (sniff, convert, dimensions, quality/size, real-device round-trip).
- **Fixtures:** `sdcard/dev-sdcard/MEDIA/{7785FABB,242025DF}/` now include the raw `.BMP` frames
  alongside the JPGs.

## Possible follow-ups (not needed for the current trial)

- **Quality tuning:** per-project `BMP_JPEG_QUALITY`, or keep the raw BMP in a cold Storage bucket for
  science users who want lossless.
- **Carry metadata to BMP frames:** since BMPs lack EXIF, the on-device NN scores/telemetry are only on
  the JPG frames. If that matters, a per-folder sidecar (`meta.json`) written by firmware could give
  BMP frames a deployment id / timestamp / telemetry without EXIF.

## Same frame, or two frames? (#1 vs #2 — researched)

**Today it is #2: two different frames.** The alternating logic keys off the frame counter
(`g_cur_jpegenc_frame % 2`), so the BMP and the JPG are *separate captures* (~`PICTURE_INTERVAL`
apart). They are **not** two encodings of one frame.

**But #1 is achievable with a small firmware change, because both buffers already exist for every
frame.** In the single `APP_MSG_IMAGETASK_FRAME_READY` handler the device has, simultaneously:

- the **hardware-encoded JPEG** — `cisdp_get_jpginfo(&jpegLength, &jpegBuffer)` (the WE2/Himax ISP
  JPEG encoder output), used by `prepareJpegFile()`, and
- the **raw sensor buffer** — `app_get_raw_addr()` (GRAY8), used by `prepareBmpFile()`.

Both are read from the *same captured frame* in the same `else` block — the ISP produces the raw frame
**and** hardware-encodes it to JPEG. The alternating `% 2` is a deliberate diagnostic *choice*, not a
hardware limit.

### Firmware change to get #1 (request for the device engineer)

Instead of choosing one format per frame, write **both** for the same frame:

```c
// in the file-save block, when "save BMP" is enabled and we want #1:
prepareJpegFile(outCategories, classCount, &extraBlock);  // hardware JPEG of THIS frame
prepareBmpFile(&extraBlock);                               // raw buffer of the SAME frame
```

Considerations:
- **Two writes per frame.** The file path writes one `fileOp` per cycle (async via `senderQueue`), so
  the second file must be chained after the first completes (or queued). This is the main work.
- **Filenames.** Give the pair the *same* hex-timestamp stem, differing only by extension
  (`<stem>.JPG` + `<stem>.BMP`). Then the website can pair them deterministically (same stem) → use the
  JPG's EXIF (deployment, timestamp, NN scores, telemetry) with the BMP's lossless pixels. This also
  removes the only downside of BMP ingest (no metadata).
- **SD-card / throughput.** Writing both is ~JPEG + 300 KB raw per frame. Fine for the dev trial; for
  production, pair #1 with the JPEG quality you actually want and drop the raw after upload.
- **Pictures-per-trigger** no longer needs to be even (that was only to make the *alternating* mode
  yield one of each).

> With #1 in place, the website's "pair by identical filename stem" becomes trivial and exact — far
> better than guessing from near-adjacent timestamps. Until then, #2 (alternating) is what ships, and
> the website correctly treats each file as its own frame.

## Mobile-app improvement (researched)

Today "Save BMP (alternating JPG/BMP)" lives **only** in the dev-only `DevDeploymentTestScreen`
("Capture Diagnostics" card), as `TEST_BIT_SAVE_BMP` (bit 1 of `OP_PARAMETER.TEST_MODE_BITS`, Op 18,
in `hooks/useDeviceSettings.ts`). It already auto-bumps Pictures-per-trigger to an even number so each
trigger yields a BMP + JPG. Improvements, in order of value:

1. **Promote it to a normal deployment setting** for the quality trial — e.g. an *Image quality:
   Standard (JPEG) / High (raw BMP)* toggle in the deployment-config screen, instead of requiring the
   hidden dev/test screen. This is a UI + settings-plumbing change in `wwmobile` only (the test bit
   already exists); no firmware change.
2. **Ask firmware for a "BMP-only" mode** (not alternating) for production high quality — a new
   `TEST_MODE_BITS` bit (or op-parameter) so *every* frame is a raw BMP and the website owns
   compression. Alternating is for A/B comparison; BMP-only is what you'd actually deploy for quality.
   Needs both a firmware bit and the mobile toggle.
3. **Surface the trade-off in the UI** — raw BMP frames are ~18× the SD-card footprint and fill the
   card far faster; the deployment screen should warn and/or auto-shorten the session length estimate.

> See also the firmware/EXIF report: BMP frames carrying no EXIF is the main reason a "BMP-only"
> production mode would benefit from a metadata sidecar.
