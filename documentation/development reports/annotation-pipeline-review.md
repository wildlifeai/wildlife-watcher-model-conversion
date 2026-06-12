# ML/AI Annotation Pipeline & Validation UX — Review and Roadmap

> **Author:** Engineering review · **Date:** 2026-06-08
> **Scope:** How AI annotations are produced, how humans see/validate/create them, and
> what to fix so reviewers can do this easily. Covers the FastAPI ML backend
> (`ww-website/backend`), the Supabase `observations` model (`ww-backend`), and every
> annotation UI surface in `ww-website/frontend`.
>
> **Progress:** ✅ A (AN-1–3, validation integrity) · ✅ B (AN-4–7, Confirm/Correct +
> shared species picker + editable bboxes) · ✅ C (AN-9 QA panel + AN-10 Run-AI; AN-8
> launcher later removed) · ✅ D (AN-11 pipeline-stub removal + AN-12 LabelingPage deletion) ·
> ✅ E (AN-13 full-screen labeling modal + AN-14 launcher removal).

---

## 1. Executive summary

The platform has a **strong AI pipeline and a strong data model**, but the **human
validation UX is fragmented**. There are effectively **two parallel annotation
systems** that write the same table different ways, and the most powerful editing
tools are **not discoverable from the main navigation**. The single biggest
data-quality bug: **editing an AI label in the main, discoverable surface
(`MediaBrowser → MediaDetail`) does not record that a human reviewed it** — it patches
fields without advancing `review_status` or setting `reviewer_id`. So human effort is
invisible to the science layer.

**Top 5 things to fix (detail in §6):**
1. Make human edits set `review_status='human_reviewed'` + `reviewer_id` everywhere.
2. Unify the two annotation surfaces (`MediaDetail` vs `LabelingPage`) on one data contract.
3. Add a one-click **"Confirm AI" / "Reject" / "Correct"** affordance on AI labels.
4. Surface the **active-learning Review Queue** (currently invisible) in the nav/flow.
5. Replace `MediaDetail`'s free-text species box with the **taxon-validated picker** that
   `LabelingPage` already has (local `taxa` + iNaturalist autocomplete).

---

## 2. The AI/ML pipeline (current state)

**Where it lives:** `ww-website/backend/app/domain/pipeline.py`, triggered via
`POST /api/pipeline/run` (`routers/pipeline.py`) and auto-run at the end of every Drive
upload job.

### 2.1 Pipeline steps (run sequentially on a deployment)

| Order | Step (`PipelineStepType`) | Status | What it does |
|---|---|---|---|
| 1 | `MEDIA_PREP` | ✅ real | Generates thumbnail + preview renditions into `media_assets` (Azure CDN) so the grid never hits Google Drive. Creates no observations. |
| 2 | `SPECIESNET` | ✅ real | **The core model.** Resolves each image to a temp file, runs the **SpeciesNet ensemble** (detector + species classifier in one pass), writes media-level `observations` with bbox, detection `confidence`, species `classification_probability`, `scientific_name`/`vernacular_name`. Images with no kept detection → one `blank` observation. |
| 3 | `ANIMAL_CROP` | ✅ real | Crops the best animal detection into `media_assets.animal_crop_url` for DINOv3. No observations. |
| — | `MEGADETECTOR` | ⚠ **stub** | Placeholder; superseded by `SpeciesNetStep`. Still in the registry. |
| — | `SPECIES_CLASSIFIER` | ⚠ **stub** | No-op; folded into `SpeciesNetStep`. |
| — | `EMPTY_FRAME` | ⚠ **stub** | No-op; blank suppression is currently handled inside SpeciesNet. |

Each run records an **`annotation_runs`** row (`run_type='ai_inference'`, the step list,
confidence threshold, observation count, `created_by`) — good provenance.

### 2.2 The "Wildlife Brain" (embeddings + active learning)

A second, more advanced track exists in `domain/wildlife_brain.py`,
`domain/active_learning.py`, `domain/clustering.py`:

- **DINOv3 embeddings** per animal crop → `media_embeddings` / `embedding_runs`.
- **HDBSCAN clustering** groups visually-similar crops; outliers flagged.
- **Active-learning score** = `combine_al_score(novelty, uncertainty, disagreement, is_outlier)`
  where novelty = `1 − cluster_confidence`. `get_review_queue()` returns top media by
  `active_learning_score DESC` — i.e. *"review these N images first for maximum signal."*
- **QA metrics** (`qa_report`, `compute_qa_metrics`) compare AI vs human labels for agreement.

This is the scientifically valuable part — it tells a reviewer *where to spend their
time* — and it is almost entirely **hidden from the UI** (see §4).

---

## 3. The data model (`observations` table)

`ww-backend/supabase/schemas/public/tables/35_observations.sql`. Key columns for
validation:

| Column | Values | Purpose |
|---|---|---|
| `source_type` | `ai` · `human` · `imported` · `consensus` | Who/what produced the label. |
| `classification_method` | `human` · `machine` | Redundant-ish with `source_type`; used by the UI badges. |
| `review_status` | `unreviewed` · `ai_reviewed` · `human_reviewed` · `expert_reviewed` · `consensus_approved` | **The validation lifecycle.** |
| `annotator_id` / `reviewer_id` | user FK | Who labelled / who verified. |
| `confidence`, `classification_probability` | 0–1 | Detection vs classification certainty. |
| `bbox_x/y/w/h` | 0–1 normalised | Box geometry (media-level only; enforced complete-quad). |
| `embedding_run_id`, `cluster_id` | FK / int | Deep provenance: which Brain run/cluster proposed this label. |
| `taxon_id` | FK → `taxa` | Canonical taxonomy link. |

**The model is excellent.** The problem is the UI doesn't use all of it consistently
(notably `review_status`, `reviewer_id`, `taxon_id`).

---

## 4. Annotation UI surfaces (current state — updated 2026-06-08)

> **Update:** `LabelingPage` (`/labeling`) has been **removed**. Selecting a photo in the
> Annotations tab now opens a **full-screen labeling modal** (`MediaDetail`) that absorbed
> the rich-editor capabilities — image left, annotation + EXIF panel right, bbox
> draw/redraw/delete, taxon-validated species picker, Confirm/Blank, ‹/› navigation.

| Surface | Route | In nav? | Capabilities | Writes |
|---|---|---|---|---|
| **MediaBrowser → MediaDetail (modal)** | `/annotations` | ✅ **Yes** (🏷️ Annotations) | Grid w/ filters, pagination, status badges. Click → **full-screen modal**: large image + bbox overlays & **draw/redraw/delete**; right panel = taxon-validated `SpeciesPicker`, type/count/life-stage/sex, **Confirm / Blank** (auto-advance), add observation, favorite/public, **EXIF**. ‹/› + arrow-key navigation. | Direct Supabase `observations` update/insert (full review provenance) |
| **ClusterReviewPage** | `/clusters/:id` | ❌ No (deployment action) | Bulk-confirm HDBSCAN clusters to one species; outlier handling; publish. | `useConfirmCluster` (backend, sets provenance) |
| **ReviewQueuePage** | `/review/:id` | ❌ Deployment action (▶ Review) | Active-learning prioritised queue. | backend |
| **EventReviewPage** | `/events/:id` | ❌ No (deployment action) | Group observations into ecological events. | backend |
| **Image/UMAP Explorer** | `/explore/:id`, `/umap/:id` | ❌ No | Embedding-space exploration. | — |

**Discoverability map:** `Results → Deployments → DeploymentActionRow` exposes
🏷️ Annotate (→ `/annotations`), 🧬 Clusters, 🏷️ Label, 📂 Events. The top nav only has
🏷️ Annotations. **ReviewQueuePage has no inbound link at all.**

---

## 5. Gaps & risks (the "why it's hard to validate" list)

### 5.1 🔴 Critical — human review is not recorded (data integrity) — ✅ RESOLVED (AN-1)
`MediaDetail.updateObservation()` sent only the changed field(s). When a human corrected
an AI label it did **not** set `review_status='human_reviewed'`, `reviewer_id`, or
`source_type='human'`. Result: the QA layer (`qa_report`) and any "needs review" filter
could not tell a human-verified label from a raw AI guess. `addObservation()` similarly
omitted `source_type` and `review_status`.
**Fixed:** both edits and adds route through `lib/observations.ts`
(`humanReviewFields` / `humanCreateFields`); legacy rows handled by the AN-3 backfill.

### 5.2 🔴 Critical — two annotation systems, two contracts — ✅ RESOLVED (AN-2)
- `MediaDetail` keyed UI off `classification_method` (`human`/`machine`).
- `LabelingPage` keyed off `source_type` (`human`/`ai`) and wrote `review_status`.
- `StatusBadge.deriveAnnotationStatus()` keyed off `classification_method` only.

A label created in one surface could render inconsistently in the other.
**Fixed:** `isHumanReviewed()` / `isAiLabel()` in `lib/observations.ts` are the single
contract (review_status authoritative, source_type/classification_method as fallback);
all surfaces now derive badge/colour/KPIs from them. *(Surfaces are data-consistent and
now share `SpeciesPicker`; the workspaces are bridged via the AN-6 launcher.)*

### 5.3 🟠 High — the powerful editor is hidden — ✅ RESOLVED (AN-6/AN-7)
`LabelingPage` (bbox drawing, taxon-validated search, bulk ops, keyboard shortcuts) was
**not in the nav** and the discoverable path (`MediaDetail`) was the *weakest* editor.
**Fixed:** MediaBrowser has a **🏷️ Label / Review** launcher into the workspace scoped to
the active filters, and `MediaDetail` itself gained the taxon-validated `SpeciesPicker`
(AN-5) and editable bounding boxes (AN-7) — the discoverable path is now a full editor.

### 5.4 🟠 High — no explicit "validate AI" action — ✅ RESOLVED (AN-4/AN-5)
Neither surface offered the natural reviewer verbs: **Confirm** (AI was right),
**Reject/Blank** (false trigger), **Correct** (change species). You had to retype a
scientific name. **Fixed:** `MediaDetail` now has one-click ✓ Confirm / ✕ Blank (with
auto-advance) and an inline taxon-validated `SpeciesPicker` for Correct, all stamping
proper review provenance.

### 5.5 🟠 High — active learning is invisible — ✅ RESOLVED (AN-8/AN-9)
`get_review_queue()` (review-these-first) and `qa_report()` (AI-vs-human agreement) were
implemented but unreachable. **Fixed:** the Annotations ControlBar has a **⭐ Review
priority** launcher into `ReviewQueuePage` (active-learning order), and `DatasetHealthPage`
surfaces the QA agreement metric via `useProjectQa`.

### 5.6 🟡 Medium — species entry is unvalidated in MediaDetail — ✅ RESOLVED (AN-5)
Free-text `scientific_name` with no `taxon_id` resolution broke CamtrapDP export quality
and taxonomy joins. **Fixed:** the shared `SpeciesPicker` writes a real `taxon_id` (local
`taxa` or freshly-registered iNat lineage) on every selection.

### 5.7 🟡 Medium — no in-UI way to (re)run the AI pipeline — ✅ RESOLVED (AN-10)
`POST /api/pipeline/run` existed but had no UI trigger. **Fixed:** `DeploymentActionRow`
has a **🤖 Run AI analysis** action (via `useRunPipeline`) to (re)run SpeciesNet on a
deployment, with inline status. *(Synchronous call today; async job execution is a
follow-up.)*

### 5.8 🟡 Medium — bbox editing is read-only outside LabelingPage — ✅ RESOLVED (AN-7)
`MediaDetail` overlaid boxes with `pointerEvents:'none'`. **Fixed:** per-observation
▭ Box / ▭ Redraw draw mode + ✕ delete write the bbox quad directly from the detail panel.
*(Drag-to-create and delete are in; corner-handle resize remains a future refinement —
adjust = redraw for now.)*

### 5.9 ⚪ Low — leftover stubs & mock fallbacks
`MegaDetectorStep` / `SpeciesNetClassifierStub` / `EmptyFrameStep` remain in the registry;
`LabelingPage` has extensive "running in mock mode" fallbacks and a hardcoded `NZ_SPECIES`
list. Fine for dev, noisy for production.

---

## 6. Roadmap (prioritised)

Effort: **S** ≤1 day · **M** 2–4 days · **L** 1–2 weeks.

### Milestone A — Fix validation integrity (do first) ✅ DONE (2026-06-08)

| ID | Task | Files | Effort |
|---|---|---|---|
| **AN-1** ✅ | **Record human review.** New `lib/observations.ts` exposes `humanCreateFields()` / `humanReviewFields()`. `MediaDetail` edits now stamp `review_status='human_reviewed'` + `reviewer_id`; adds stamp full human provenance (`source_type='human'`, `annotator_id`/`reviewer_id`). `LabelingPage.persistHumanObservation` routes through the same helper (gains `annotator_id`/`reviewer_id`). | `lib/observations.ts` (new), `MediaDetail.tsx`, `LabelingPage.tsx` | S |
| **AN-2** ✅ | **Single status contract.** `deriveAnnotationStatus()` now takes `hasReviewed`/`hasAi` derived from `isHumanReviewed()`/`isAiLabel()` (review_status authoritative, source_type fallback). MediaBrowser badge/filter/KPI/sort and MediaDetail bbox colour + AI count all use the shared predicates — `classification_method`-only logic removed. | `StatusBadge.tsx`, `MediaBrowser.tsx`, `MediaDetail.tsx`, `lib/observations.ts` | M |
| **AN-3** ✅ | **Backfill audit.** `audit-observation-review-provenance.sql` — read-only report (distribution, human-authored-but-not-reviewed, NULL source_type, reviewer recoverability) + a transactional backfill that rolls back by default (recovers `reviewer_id`/`annotator_id` from `classified_by`→`users.email`). | `ww-backend/scripts/audit-observation-review-provenance.sql` (new) | S |

### Milestone B — Make validation easy (highest UX payoff) — ✅ DONE (2026-06-08)

| ID | Task | Files | Effort |
|---|---|---|---|
| **AN-4** ✅ | **Confirm / Reject / Correct.** Each AI-unreviewed observation in `MediaDetail` shows a status badge + one-click **✓ Confirm** (stamps `human_reviewed`, keeps species) and **✕ Blank** (false trigger → `observation_type='blank'`, clears species). Both auto-advance to the next image via the new `onAdvance` prop wired from `MediaBrowser`. **Correct** = pick a new species in the inline picker (AN-5). | `MediaDetail.tsx`, `MediaBrowser.tsx` | M |
| **AN-5** ✅ | **Taxon-validated species picker.** New `SpeciesPicker.tsx`: debounced local `taxa` search + iNaturalist autocomplete, auto-registers an iNat pick into `taxa` (POST `/api/inat/taxa`) and returns a real `taxon_id`; falls back to local-only when iNat is feature-flagged off. Replaces `MediaDetail`'s free-text species box and writes `taxon_id`/`vernacular_name`. | `SpeciesPicker.tsx` (new), `MediaDetail.tsx`, `MediaBrowser.tsx` | M |
| **AN-6** ⤳ | **Promote the rich editor.** *(Superseded by AN-13: the `LabelingPage` workspace and its ControlBar launcher were removed; the rich editor is now the full-screen modal opened by selecting a photo. The `SpeciesPicker` migration done here lives on in the modal.)* | — | M |
| **AN-7** ✅ | **Editable bounding boxes in the detail panel.** Each observation card has a **▭ Box / ▭ Redraw** toggle; drag on the image draws a normalised box (live amber draft, Esc cancels) written as the bbox quad via `updateObservation` (stamps human review). Existing boxes show a ✕ delete that clears the quad. | `MediaDetail.tsx` | L |

### Milestone C — Surface the intelligence — ✅ DONE (2026-06-08)

| ID | Task | Files | Effort |
|---|---|---|---|
| **AN-8** ⤳ | **Expose the Review Queue.** *(The ControlBar **⭐ Review priority** button was later removed per product decision (AN-14). The active-learning queue stays reachable via `DeploymentActionRow`'s **▶ Review** button with its open-count badge.)* | `DeploymentActionRow.tsx` | S |
| **AN-9** ✅ | **QA agreement panel.** New `useProjectQa` hook fans `/api/qa/report/{id}` across the project's deployments and aggregates a precision proxy; `DatasetHealthPage` shows an **AI vs Human Agreement** card (overall agreement %, images compared, matches, per-deployment breakdown) with graceful disabled/empty states. | `useIntelligence.ts`, `DatasetHealthPage.tsx` | M |
| **AN-10** ✅ | **"Run AI analysis".** New `useRunPipeline` hook posts `/api/pipeline/run`; `DeploymentActionRow` has a **🤖 Run AI analysis** action (overflow) with confirm + inline running/result status. *(The endpoint runs synchronously, so the mutation's pending state stands in for the progress dock; an async job-based variant is a future improvement.)* | `usePipeline.ts` (new), `DeploymentActionRow.tsx` | M |

### Milestone D — Cleanup — ✅ DONE (2026-06-08)

| ID | Task | Files | Effort |
|---|---|---|---|
| **AN-11** ✅ | Deleted the deprecated `MegaDetectorStep`, `SpeciesNetClassifierStub`, `EmptyFrameStep` classes, their registry entries, and the `MEGADETECTOR`/`SPECIES_CLASSIFIER`/`EMPTY_FRAME` enum members; updated docstrings and the pipeline-step tests. Production registry is now just `MEDIA_PREP → SPECIESNET → ANIMAL_CROP`. | `backend/app/domain/pipeline.py`, `backend/app/schemas/pipeline.py`, `backend/tests/test_events_pipeline.py` | S |
| **AN-12** ✅ | **`LabelingPage` removed entirely** (route, imports, deployment-row/launcher links), which subsumes the `NZ_SPECIES` + mock-fallback cleanup. Its rich-editor role is replaced by the new full-screen labeling modal (AN-13). | `LabelingPage.tsx` (deleted), `App.tsx`, `MediaBrowser.tsx`, `DeploymentActionRow.tsx`, `MyDataPage.tsx` | S |

### Milestone E — Full-screen labeling modal (UX redesign, 2026-06-08) ✅

| ID | Task | Files | Effort |
|---|---|---|---|
| **AN-13** ✅ | **Selecting a photo opens a full-screen modal** instead of an inline side panel: large image on the left (with bbox overlays + draw/redraw/delete), annotation + EXIF panel on the right. ‹/› arrows + ←/→ keys step between images; Esc closes (or cancels a draw); Confirm/Blank auto-advance. EXIF rendered from `media.exif_metadata`. | `MediaDetail.tsx`, `MediaBrowser.tsx` | M |
| **AN-14** ✅ | **Removed "Review priority" + "Label / Review" launchers** from the Annotations ControlBar (per product decision); the active-learning queue remains reachable via `DeploymentActionRow`'s ▶ Review. | `MediaBrowser.tsx` | S |

---

## 7. Suggested sequencing

1. **AN-1 + AN-2 + AN-3** (Milestone A) — stop losing validation provenance. ~1 week.
2. **AN-4 + AN-5** — the Confirm/Correct flow with a real species picker is the single
   biggest reviewer-speed win. ~1 week.
3. **AN-8 + AN-9** — point reviewers at the right images and show model weak spots. ~3 days.
4. **AN-6 + AN-7 + AN-10**, then **AN-11/AN-12** cleanup.

> **Backend dependency note (G1):** none of Milestone A/B needs schema changes — every
> field already exists on `observations`. AN-9/AN-10 reuse existing endpoints
> (`qa_report`, `/api/pipeline/run`). This is almost entirely a **frontend + wiring**
> effort.
</content>
