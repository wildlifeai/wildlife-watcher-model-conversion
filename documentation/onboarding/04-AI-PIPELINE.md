# 04 — AI Pipeline & Wildlife Brain

How AI annotations are produced. Two tracks: the **SpeciesNet inference pipeline** (detect +
classify) and the **Wildlife Brain** (DINOv3 embeddings → clustering → active learning).

## SpeciesNet inference pipeline

Lives in [`backend/app/domain/pipeline.py`](../../backend/app/domain/pipeline.py), triggered by
`POST /api/pipeline/run` and auto-run at the end of every Drive upload job. Steps run in order:

| Step (`PipelineStepType`) | What it does |
|---|---|
| `MEDIA_PREP` | Generate thumbnail + preview renditions into `media_assets` (Azure CDN) so the grid never hits Google Drive. No observations. |
| `SPECIESNET` | **The core model.** Resolves each image to a temp file, runs the **SpeciesNet ensemble** (detector + species classifier in one pass), and writes media-level `observations` with bbox, detection `confidence`, species `classification_probability`, and `scientific_name`/`vernacular_name`. |
| `ANIMAL_CROP` | Crops the best animal detection into `media_assets.animal_crop_url` for DINOv3. No observations. |

Each run records an `annotation_runs` row (steps, threshold, observation count, `created_by`) for
provenance.

> **History:** the earlier `MegaDetectorStep`, `SpeciesNetClassifierStub`, and `EmptyFrameStep`
> placeholders were **removed** — the SpeciesNet ensemble subsumes detection, classification, and
> blank handling. The registry is now exactly `MEDIA_PREP → SPECIESNET → ANIMAL_CROP`.

### How blank / empty images are handled

A blank frame is a **positive result, not missing data**. When SpeciesNet keeps no detections above
the confidence threshold, it writes **one observation with `observation_type='blank'`** (no bbox,
`source_type='ai'`, `review_status='ai_reviewed'`). The distinction:

- **Blank** = processed, no animal → has a `blank` AI observation → shows the teal **AI** badge.
- **Unprocessed** = no observations at all → shows the **✕ Issue** badge (action needed).

Blanks are excluded from species charts but counted in the observation-type breakdown and the
deployment **false-trigger rate**.

## Wildlife Brain (embeddings → clustering → active learning)

A second, deeper track (`domain/wildlife_brain.py`, `embedding_lifecycle.py`, `clustering.py`,
`active_learning.py`), surfaced through the `/api/brain/*`, `/api/intelligence/*`, and `/api/qa/*`
routers. Gated by `FF_WILDLIFE_BRAIN_ENABLED` / `FF_ACTIVE_LEARNING_ENABLED`.

```
animal crop ──DINOv3──▶ media_embeddings ──HDBSCAN──▶ clusters (+ outliers)
                                   │
                                   ▼
   active_learning_score = f(novelty, uncertainty, disagreement, is_outlier)
                                   │
                                   ▼
        review queue (highest-value images first) + QA agreement report
```

- **Embeddings**: DINOv3 vectors per animal crop → `media_embeddings` / `embedding_runs`.
- **Clustering**: HDBSCAN groups visually similar crops; outliers flagged. Confirmed in
  `ClusterReviewPage` (`/clusters/:id`), which bulk-writes labels with cluster provenance.
- **Active learning**: `get_review_queue()` ranks media by `active_learning_score` (novelty =
  `1 − cluster_confidence`) → surfaced in `ReviewQueuePage` (`/review/:id`).
- **QA**: `qa_report()` computes AI-vs-human agreement (a precision proxy over images carrying both
  an AI and a human label) → shown on `DatasetHealthPage` (`/intelligence/:id`) via `useProjectQa`.

## Observation data model (shared by both tracks)

| Field | Values | Purpose |
|-------|--------|---------|
| `source_type` | `ai · human · imported · consensus` | who originated the row |
| `review_status` | `unreviewed · ai_reviewed · human_reviewed · expert_reviewed · consensus_approved` | validation lifecycle |
| `classification_method` | `human · machine` | who authored the label |
| `confidence`, `classification_probability` | 0–1 | detection vs classification certainty |
| `bbox_x/y/w/h` | 0–1 | normalised box (media-level only) |
| `embedding_run_id`, `cluster_id` | FK / int | deep provenance back to the Brain run |
| `taxon_id` | FK → `taxa` | canonical taxonomy link |

Human review is recorded via `frontend/src/lib/observations.ts` — see
[05-ANNOTATION-WORKFLOW](./05-ANNOTATION-WORKFLOW.md).

## Model conversion (separate)

Edge Impulse model ZIPs are converted for the camera's Ethos-U NPU via the **Vela** CLI
(`services/vela.py`, `domain/model.py`, `POST /api/models/convert`) and registered in `ai_models`.
See [AI Model Pipeline](../resources/ai-model-pipeline.md).
