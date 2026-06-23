# Embedded AI Model Lifecycle (end-to-end)

> The full path a custom on-device model travels — from training to the device
> running it in the field to its predictions appearing on the website — and which
> repository owns each stage. This is the **map**; each stage links to the detailed
> doc that owns it.

Repos: **website** (`ww-website`), **backend** (`ww-backend`, canonical schema),
**mobile** (`wildlife-watcher-mobile-app`), **firmware** (`Seeed_Grove_Vision_AI_Module_V2`).

```
 (1) Train/export        (2) Upload & convert      (3) Label mapping      (4) Manifest
   Edge Impulse   ──►   website /api/models/  ──►  website label_map ──► website MANIFEST.zip
   int8 .tflite zip      convert → Vela → .TFL       (species ↔ taxon)     (.TFL + labels.txt)
                                                                                 │
 (8) Reflect (planned)  (7) Ingest EXIF        (6) On-device inference    (5) Deploy
   edge observations ◄─ website exif.py    ◄──  firmware: load+run    ◄──  mobile (BLE) or
   beside SpeciesNet     UserComment parse       write EXIF UserComment      SD-card manifest
```

## 1. Train & export (user · Edge Impulse)
A **fully int8-quantized** TFLite classifier. The Edge Impulse "TensorFlow Lite
(int8 quantized)" export contains `trained.tflite` + label metadata. Float or
partially-quantized models fail Vela compilation (see stage 2).

## 2. Upload & convert (website → backend)
`POST /api/models/convert` → `convert_model_job` → `convert_uploaded_model`
([`backend/app/domain/model.py`](../../backend/app/domain/model.py)) extracts the
`.tflite`, compiles it for the Ethos-U55 NPU via **Vela**
([`services/vela.py`](../../backend/app/services/vela.py)), and stores the `.TFL` +
`.TXT` in the Supabase Storage `ai-models` bucket. An `ai_models` row is created
(status lifecycle `uploading → uploaded → validated`/`failed`).
Detail: [AI Model & Manifest Pipeline](./ai-model-pipeline.md).

Robustness notes (all current): the converter accepts any `.tflite` in the ZIP
(not only `trained.tflite`), treats `model_variables.h` as optional, ignores macOS
`__MACOSX`/`._` shadow files, surfaces the real Vela error (e.g. "FullyConnected
could not run on NPU" = not int8-quantized), and uses unique `_pending/{job_id}`
placeholder paths to satisfy the `NOT NULL UNIQUE` path columns
(see backend [path-columns design issue](../../../ww-backend/documentation/development%20reports/ai-models-path-columns-design-issue.md)).

## 3. Label mapping (website)
After validation, [`ModelLabelMapper`](../../frontend/src/components/toolkit/ModelLabelMapper.tsx)
asks the uploader what each output class means — **target species** (mapped to a
taxon via `SpeciesPicker`) or **background/negative** (e.g. `not rat`) — and saves it
to `ai_models.label_map` (jsonb; RLS: organisation_manager). Class order comes from
the model's own `detection_capabilities`, so it stays aligned with the device's
`labels.txt` (stage 4). This is what lets stage 8 reflect `rat: 87%` as *Rattus
rattus* and skip negatives. Disambiguates labels like a bare `rat`.

## 4. Manifest / Prepare SD Card (website)
`generate_manifest` assembles `MANIFEST.zip` containing the model + `labels.txt` +
camera config + Himax firmware, named `{firmware_model_id}V{version_number}.TFL`
(8.3 format). `labels.txt` must be written in the model's class order so device
class index *i* ↔ `labels[i]` ↔ `label_map`. Detail:
[AI Model & Manifest Pipeline](./ai-model-pipeline.md#manifest-generation).

## 5. Deploy to device (mobile / SD card → backend)
Either the **mobile app** transfers the model over BLE (`loadmodel`, OP 14
`firmware_model_id` + OP 15 `version_number`) or the user copies `MANIFEST.zip` to
the SD card. Only `validated`/`deployed` models sync. Detail:
[mobile AI-Model-Integration](../../../wildlife-watcher-mobile-app/documentation/resources/AI-Model-Integration.md).

## 6. On-device inference (firmware)
The device loads the model + `labels.txt` from the SD-card manifest, runs inference,
and writes three things into each JPEG's EXIF:
- **Deployment ID** → tag `0xF200`
- **AE telemetry** → `MakerNote` (`0x927C`), `"integration, analogGain, digitalGain, aeMean, converged"`
- **NN class scores** → `UserComment` (`0x9286`), `"<label>: <pct>%; …"`

> ⚠️ **Known gap:** UserComment is currently **not written** because the firmware
> `USE_PERCENTAGE` flag is disabled while `ENABLE_EXIF_CONFIDENCE` is on — the
> confidence producer is compiled out. Fix + detail:
> [firmware NN_confidence_EXIF_not_written](../../../Seeed_Grove_Vision_AI_Module_V2/EPII_CM55M_APP_S/app/ww_projects/ww500_md/doc/NN_confidence_EXIF_not_written.md).
> Until that ships, stages 7–8 have no embedded prediction to ingest.

## 7. Ingest EXIF (website)
On SD-card upload, [`backend/app/domain/exif.py`](../../backend/app/domain/exif.py)
parses `UserComment` into `user_comment_fields` (`{"rat": 87}`) and extracts the
deployment ID. The **cloud SpeciesNet pipeline** runs independently on the same
images ([04-AI-PIPELINE](../onboarding/04-AI-PIPELINE.md)) — the device and cloud
models are complementary, not exclusive.

## 8. Reflect on-device prediction (website · planned — Phase 2)
Turn `user_comment_fields` into observations tagged as edge predictions, mapped to
taxa via `label_map`, shown in the annotation panel beside SpeciesNet (e.g. *📟
Device: rat 87%* next to *☁ SpeciesNet: Rattus rattus 64%*). Negative classes are
skipped. Depends on the firmware fix (stage 6). Not yet built.

## Open items
- **Firmware:** enable `USE_PERCENTAGE` so the device emits NN scores (stage 6).
- **Website:** build Phase 2 reflection (stage 8).
- **Backend:** make `ai_models.model_path`/`labels_path` nullable to retire the
  `_pending` placeholder (stage 2) — see the path-columns design issue.
