# Wildlife Watcher v4 — Implementation Plan (step-by-step)

> **Status:** 🕰️ Historical snapshot — point-in-time design/roadmap; **not** kept current with the code.

> **Status:** Planning. This document refines `wildlife_watcher_v4_roadmap.html` into a buildable,
> review-ready sequence of steps. It is the working spec for the v3/v4 effort
> (Phases 5 → 10). Pair it with the roadmap HTML (the "why" / science) — this doc is the "how".
>
> **How to use this doc**
> - Each phase has **Steps** (do in order), the **exact files** to touch, **feature flags**,
>   **acceptance criteria**, and a **Review checklist** for diffing against the remote GitHub branch.
> - Sections marked **[ww-backend]** are *schema/database* work that must NOT be done in this repo
>   (see Guardrail G1). They are listed here only so the website work can be sequenced against them.
> - Sections marked **[local/webgpu]** describe the in-browser DINOv3 path.

---

## 0. Guardrails (from `.agents/skills/SKILL.md` — non-negotiable)

| ID | Rule | Consequence for v4 |
|----|------|--------------------|
| **G1** | **Database is owned by `ww-backend`** (`ww-backend/supabase/schemas/`). This repo never creates/alters tables, columns, or DB functions. | Every `ALTER TABLE` / new table in the roadmap is a **ww-backend PR first**. The website consumes the schema only after it exists. All schema blocks below are tagged **[ww-backend]**. |
| **G2** | **Layer separation:** `routers → domain → services`. Domain must not import FastAPI. | DINOv3 / SpeciesNet / HDBSCAN logic lives in `domain/`. Qdrant + GPU + model loading live in `services/`. Routers stay thin and return the standard envelope. |
| **G3** | **Do not assume Redis/ARQ exists.** Current jobs = in-memory store + asyncio background tasks + Supabase persistence. | Embedding/reprocess jobs use the **existing** `app/jobs/runner.py` + `store.py` pattern, not ARQ. Keep compatibility with the current runner. |
| **G4** | **Feature-flag everything experimental** in `backend/app/config.py`; gate router registration in `main.py`. | New flags: `FF_SPECIESNET_ENABLED`, `FF_WILDLIFE_BRAIN_ENABLED`, `FF_MEDIA_REGISTRY_ENABLED`, `FF_ACTIVE_LEARNING_ENABLED`, `FF_INTELLIGENCE_ENABLED`, `FF_LOCAL_EMBEDDING_ENABLED`. |
| **G5** | **API envelope** `{ data, error, meta }` (`schemas/common.py`). | All new routers return `ApiResponse(...)`, never bare dicts. |
| **G6** | **Reuse model registries / constants** — don't invent model names. | New `registries/embedding_registry.py` holds the DINOv3/SpeciesNet model metadata; the `model_name` enum is defined once and reused FE+BE. |
| **G7** | **Verify schema before queries** (e.g. `user_roles` uses `scope_id`/`scope_type`, not `organisation_id`). | Confirm `media`, `observations`, `taxa`, `deployments` column names against `ww-backend` before writing any query. |
| **G8** | **Validation before commit:** backend = ruff + ruff format + pytest; frontend = eslint + tsc + build. | Every step's Review checklist assumes these pass. |
| **G9** | **Env is centralized** in root `.env` + `config.py`; fail fast on missing required config. | Qdrant/Azure-GPU/HF settings declared in `config.py` with safe defaults. |

---

## 1. Key v4 decisions & corrections vs the roadmap

These supersede the corresponding parts of `wildlife_watcher_v4_roadmap.html`.

### 1.1 SpeciesNet replaces MegaDetector (and the SpeciesNet stub)
- Install: `pip install speciesnet`. SpeciesNet is **detector + classifier in one ensemble** (its
  detector is MegaDetector v5/v6; its classifier covers ~2k species with a GBIF taxonomy).
- This **removes the roadmap's hidden blocker**: today both `MegaDetectorStep` and `SpeciesNetStep`
  in `domain/pipeline.py` are stubs (`confidence: 0.0`, no bboxes). A single real `SpeciesNetStep`
  now produces **bounding boxes** (→ animal crops for DINOv3) **and** a **supervised species guess**
  (→ `observations` with a `taxon_id`).
- Wherever the roadmap says "MegaDetector confirms `animal`" / "MegaDetector confidence", read
  **"SpeciesNet detector category = animal"** / **"SpeciesNet detector confidence"**.
- Synergy to preserve: SpeciesNet = *supervised* label; DINOv3+HDBSCAN = *zero-shot* grouping,
  novel-species discovery, and similarity. They are complementary, not redundant.

### 1.2 DINOv3 only — two variants, **per-variant** vector spaces
- **No DINOv2 fallback.** Both variants are DINOv3; `model_name` is explicit at the data level.
- Each variant has **its own dim + Qdrant collection** (they are different spaces):
  | Variant | `model_name` | Dim | Collection | Where it runs |
  |---------|--------------|-----|------------|----------------|
  | DINOv3 **ViT-H/16+** | `dinov3-vith` | **1280** | `media_embeddings` | Server (Azure GPU). Highest quality (V-measure 0.943–0.958). |
  | DINOv3 **ViT-S/16** | `dinov3-vits` | **384** | `media_embeddings_vits` | **Browser (WebGPU)** + CPU dev. Smaller/faster. ONNX: `onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX`. |
- **Per-variant, not shared (corrected):** the earlier "both 1280d in one collection" assumption was
  wrong — ViT-S/16 emits **384d**. So similarity is valid **within** a variant; cross-variant
  (local ↔ server) similarity is **not** supported without a learned projection. `embedding_runs`
  records `embedding_dim` + `qdrant_collection` per run; the registry (`get_embedding_dim`,
  `get_collection`) is the single source of truth and the Qdrant service routes by variant.

### 1.3 Local (in-browser) embedding via WebGPU — first-class option
- Users can run embedding **locally** in Chrome/Edge with a discrete GPU: convert DINOv3 ViT-S/16+ to
  ONNX with `optimum-cli`, then run `pipeline('image-feature-extraction', …)` from
  `@huggingface/transformers` with `device: 'webgpu'`. OOM risk on low-end devices is expected and
  surfaced to the user.
- **Split of work:** the browser does only the GPU-heavy *embedding* (per animal crop). HDBSCAN +
  UMAP + Qdrant upsert stay **server-side** (cheap CPU) because clustering needs the whole
  deployment's vectors together. Browser posts **vectors, not images** → privacy-friendly and zero
  server GPU cost. Full detail in §7.

### 1.4 Job system: existing runner, not ARQ (G3)
- Embedding, crop, thumbnail, reprocess, and AL-recompute jobs are registered in
  `app/jobs/definitions.py` and dispatched via `app/jobs/runner.py` + `store.py`, polled by the
  existing `useJob` hook. No Redis/ARQ dependency is introduced.

---

## 2. Net-new architecture surface (where things go)

```
backend/app/
  config.py                         # +flags, +Qdrant/HF/Azure-GPU/local settings   (G4, G9)
  registries/
    embedding_registry.py    [NEW]  # model_name enum + DINOv3/SpeciesNet metadata   (G6)
  schemas/
    brain.py                 [NEW]  # embedding/cluster/similarity/umap DTOs
    media_registry.py        [NEW]  # resolve/registry DTOs
    intelligence.py          [NEW]  # health/alerts/shift DTOs  (Phase 9)
  domain/
    pipeline.py              [EDIT] # +SpeciesNetStep (real), +MediaPrep/AnimalCrop/WildlifeBrain steps
    speciesnet_infer.py      [NEW]  # SpeciesNet ensemble wrapper (pure, GPU-agnostic)
    wildlife_brain.py        [NEW]  # DINOv3 embed + HDBSCAN + UMAP + purity (zero-shot)  (≠ clustering.py)
    media_registry.py        [NEW]  # resolve_url(), thumbnail/crop orchestration
    active_learning.py       [NEW]  # composite AL score  (Phase 8)
    intelligence.py          [NEW]  # shift detection, health, alerts  (Phase 9)
  services/
    qdrant_client.py         [NEW]  # collection mgmt, upsert, search, snapshot
    dinov3.py                [NEW]  # model load + embedding extraction (server/CPU)
    azure_gpu.py             [NEW]  # GPU worker dispatch / batch embedding
  jobs/
    definitions.py           [EDIT] # +embed_deployment_job, +backfill_thumbnails_job, +reprocess_*_job, +recompute_al_job
  routers/
    brain.py                 [NEW]  # /api/brain/*           (Phases 5, 5.5, 8)
    media.py                 [EDIT] # +/api/media/registry, +/resolve, +/thumbnails
    intelligence.py          [NEW]  # /api/intelligence/*    (Phase 9)
    qa.py                    [NEW]  # /api/qa/*              (Phase 5/8)
  main.py                    [EDIT] # register routers behind flags

frontend/src/
  lib/embedding/             [NEW]  # transformers.js WebGPU extractor  (§7)  [local/webgpu]
  hooks/                     [NEW]  # useMediaRegistry, useClusters, useUmapCoords, useSimilarImages,
                                    #   useReviewQueue, useOutlierQueue, useQaSamples, useReviewConflicts,
                                    #   useLocalEmbedding
  pages/                     [NEW]  # ImageExplorerPage, ClusterReviewPage, UmapExplorerPage, ReviewQueuePage
  App.tsx                    [EDIT] # new routes under RequireAuth

infra/
  docker-compose.yml         [EDIT] # +qdrant, +embedding-worker
  backend/requirements*.txt  [EDIT] # speciesnet, torch, transformers, qdrant-client, hdbscan, umap-learn
```

**Schema — AUTHORED in `ww-backend` (this section supersedes the per-phase DDL blocks below).**
After inspecting the real canonical schema, the v4 schema has been authored declaratively in
`ww-backend/supabase/schemas/` (see `ww-backend/docs/V4_WILDLIFE_BRAIN_SCHEMA.md`). Key corrections to
the roadmap's assumptions:

- **`taxa` already exists** (`scientific_name` unique, GBIF/iNat/NZOR ids). `observations` already has
  `taxon_id` (FK), `source_type` (`ai|human|imported|consensus`), `review_status`
  (`unreviewed|ai_reviewed|human_reviewed|expert_reviewed|consensus_approved`), `source_model_id`,
  `annotator_id`, `reviewer_id`, `confidence`, and **bbox** (`bbox_x/y/w/h`, `classifier_category`).
  The old `detections` table was collapsed into `observations` — **SpeciesNet writes media-level
  `observations` rows with bboxes; the animal-crop step reads those** (no new bbox storage).
- **AI fields go in side tables, NOT new `media` columns** — because `media` is offline-first synced to
  the mobile app. New 1:1 tables `media_assets` (storage/CDN urls) and `media_embeddings` (embedding,
  cluster, umap, AL score) keep `media` lean and are website-only (not in any sync function).
- **New tables:** `embedding_runs`, `media_assets`, `media_embeddings`, `cluster_assignments`,
  `ecological_shift_reports`, `conservation_alerts`. **Added columns:** `taxa.status`,
  `observations.embedding_run_id` + `observations.cluster_id`.
- **Reuse, don't duplicate:** `processing_runs` → existing `annotation_runs` (`run_type='ai_inference'`);
  `qa_samples` → existing `annotation_jobs/targets/reviews` + `observation_annotations.source='qa_review'`;
  `review_conflicts` → `cluster_assignments.review_state='conflicted'` + soft-lock columns +
  `annotation_reviews`. (The per-phase `qa_samples`/`review_conflicts`/`processing_runs` DDL below is
  **superseded** — do not author those tables.)
- Schema is **non-breaking** (new tables / nullable columns / indexes). Materialise via
  `DB_AGENT_MODE=1 npm run db:change v4_wildlife_brain` in ww-backend, then notify mobile (TYPE-SYNC).

---

## 3. Build order (critical path)

```
Phase 4.5  Make SpeciesNet real  ──► unblocks crops + supervised labels   (NEW, prerequisite)
Phase 6    Media Registry (thumbnails + animal_crop_url)  ──► unblocks DINOv3 input + UI grid
Phase 5    Wildlife Brain (DINOv3 embed, HDBSCAN, Qdrant)  ──► + [local/webgpu] §7
Phase 5.5  Embedding versioning + Qdrant DR
Phase 7    Native UI (Explorer / Cluster Review / UMAP / Review Queue)
Phase 8    Active Learning + QA report
Phase 9    Conservation Intelligence (health, shift, alerts, discovery)
Phase 10   Hardening + CamtrapDP embeddings export
```

> **Change vs roadmap:** (a) a new **Phase 4.5** is inserted because Phases 5 & 6 both depend on real
> detections/crops; (b) **Phase 6 is pulled ahead of Phase 5** because DINOv3 consumes
> `animal_crop_url` and the UI grid consumes `thumbnail_url`. The roadmap acknowledged the dependency
> but ordered 6 after 5.

**Day-0 long-lead items (no code):** request HuggingFace access to
`facebook/dinov3-vith16plus-pretrain-lvd1689m`; provision Azure GPU (NC-series) quota + credits;
stand up Qdrant locally; open the **ww-backend** schema PRs so migrations land before website work.

---

## 4. Phase 4.5 — Make SpeciesNet real (prerequisite)

**Goal:** replace the detection/classification stubs with a real SpeciesNet ensemble step that emits
bounding boxes + species guesses.

**Steps**
1. **Deps:** add `speciesnet` (+ its torch/tf deps) to `backend/requirements.txt`. Keep heavy ML deps
   out of the API image where possible (see Phase 5 worker image split).
2. **Registry (G6):** create `registries/embedding_registry.py` with the SpeciesNet model id/version
   and the species→taxon mapping strategy (SpeciesNet emits a GBIF taxonomy string; map to the
   existing `taxa` table, reusing the iNaturalist taxon registration path already in
   `domain/inaturalist.py`).
3. **Service:** `services/` — wrap SpeciesNet load + inference behind a class so the model is loaded
   once (lazy singleton), CPU/GPU agnostic. No FastAPI imports.
4. **Domain step:** in `domain/pipeline.py` add a real `SpeciesNetStep(PipelineStep)`:
   - `step_type = PipelineStepType.SPECIESNET` (add enum value — see step 5).
   - For each media: run ensemble → write `observations` rows with `observation_level='media'`,
     `source_type='ai'`, real `confidence`, `taxon_id` (best classification), and **persist bbox**
     (so `AnimalCropStep` and the UI overlay can use it). Verify the bbox column name in **ww-backend**
     (G7) before writing.
   - Honor `config["confidence_threshold"]`.
   - Mark the old `MegaDetectorStep`/`SpeciesNetStep` stubs **deprecated** (keep enum members for
     back-compat, route default to `SPECIESNET`).
5. **Schema [ww-backend]:** add `PipelineStepType.SPECIESNET = "speciesnet"` to
   `schemas/pipeline.py` (this is an app enum, not DB — fine here). If a bbox/detections column does
   not already exist on `observations`/`media`, that column add is a **ww-backend** change.
6. **Flag (G4):** `FF_SPECIESNET_ENABLED`; default pipeline step becomes `SPECIESNET` when on.

**Acceptance:** running `POST /api/pipeline/run` with `steps=[speciesnet]` on a 100-image test
deployment yields `observations` with non-zero confidence, a `taxon_id` for animal frames, and stored
bounding boxes. Empty frames flagged.

**Review checklist (diff):** ☐ no FastAPI import in `domain` ☐ envelope returned ☐ model id from
registry, not hardcoded ☐ bbox column verified against ww-backend ☐ ruff+pytest pass ☐ stub steps
deprecated not deleted.

---

## 5. Phase 6 — Media Registry & Supabase Storage CDN (pulled ahead)

**Goal:** storage-agnostic media + thumbnails/previews/crops on the public **Supabase Storage** bucket
(`media-renditions`), so DINOv3 and the UI never hit Google Drive on the hot path. **Originals stay in
Google Drive (free, 100 TB); only the small derivatives go to the CDN bucket.** Builds directly on the
**existing** `domain/media_resolver.py` (already a pluggable resolver registry).

**Schema [ww-backend]** — add to `media` (all nullable, backwards-compatible):
`storage_provider` (`google_drive|azure_blob|supabase_storage`), `storage_key`, `thumbnail_url`,
`preview_url`, `animal_crop_url`, `file_size_bytes`, `original_width`, `original_height`.
Backfill: `storage_provider='google_drive'`, `storage_key=<existing Drive id>`.

**Steps**
1. **Domain:** create `domain/media_registry.py`:
   - `resolve_url(media_row, size='thumbnail')` → `thumbnail_url` → `preview_url` → original Drive URL
     fallback. The UI always calls this; it never reads `storage_key`. (Complements the byte-level
     `media_resolver.resolve_media`.)
   - `backfill_thumbnails(deployment_id)` and `generate_animal_crop(media_id)` orchestration.
2. **Pipeline steps** in `domain/pipeline.py`:
   - `MediaPreparationStep` — after EXIF, before SpeciesNet: write 300px `thumbnail_url` + 800px
     `preview_url` to the public Supabase Storage bucket (`services/storage.py` → `upload_rendition`).
   - `AnimalCropStep` — after SpeciesNet: crop best detection bbox (+10% pad) → `animal_crop_url`.
3. **Jobs:** add `backfill_thumbnails_job` to `definitions.py` (runner pattern, G3); priority queue
   for deployments about to be opened in the Phase 7 UI.
4. **Router:** extend `routers/media.py`:
   - `POST /api/media/thumbnails/{deployment_id}` (enqueue backfill)
   - `GET  /api/media/{media_id}/resolve?size=thumbnail|preview|original`
   - `GET  /api/media/registry/{deployment_id}?page=&page_size=` (pre-resolved URL list; primary
     source for Phase 7 grid). Reuse `services/db_utils.py` pagination.
5. **Flag:** `FF_MEDIA_REGISTRY_ENABLED`.

**Acceptance:** all new uploads get `thumbnail_url`+`preview_url`; `resolve_url()` returns a working
URL for 100% of rows (new + backfilled); `animal_crop_url` populated for rows with detections.

**Review checklist:** ☐ schema landed in ww-backend first ☐ `resolve_url` fallback chain correct
☐ thumbnails are CDN-public, originals are not ☐ pagination via db_utils ☐ envelope ☐ flag-gated.

---

## 6. Phase 5 — Wildlife Brain (DINOv3 embeddings, HDBSCAN, Qdrant)

**Goal:** zero-shot species clustering. DINOv3 ViT-H/16+ extracts 1280d per animal crop; HDBSCAN
clusters per deployment; vectors in Qdrant; UMAP-2D persisted; purity drives review depth.

**Schema [ww-backend]** — add to `media`: `embedding_id`, `embedding_run_id` (FK, added fully in 5.5),
`cluster_id`, `cluster_confidence`, `cluster_purity` (`high|medium|low`), `is_outlier`, `umap_x`,
`umap_y`. New tables `cluster_assignments`, `review_conflicts`, `qa_samples` (see roadmap DDL).
Add provenance columns to `observations` (`model_name`, `model_version`, `embedding_run_id`,
`cluster_id`, `reviewer_id`, `review_timestamp`).

**Steps**
1. **Registry (G6):** in `registries/embedding_registry.py` define the **`model_name` enum**
   `dinov3-vith | dinov3-vits` and per-variant metadata (HF id, dim=1280, pooling, preprocessing,
   HNSW params). This is the single source of truth shared with the frontend (§7).
2. **Service `services/qdrant_client.py`:** collection `media_embeddings` (1280d, cosine, HNSW
   m=16/ef_construct=200); `upsert(ids, vectors, payload)`, `search(vector, n, filter)`,
   `snapshot()`. Payload: `{deployment_id, taxon_id, cluster_id, review_status, org_id, embedding_run_id}`.
3. **Service `services/dinov3.py`:** load ViT-H/16+ (HF), batch=32, extract 1280d. CPU path for dev.
   Falls back to **ViT-S** (`dinov3-vits`) only as a *smaller server model*, never to DINOv2.
4. **Service `services/azure_gpu.py`:** dispatch batch embedding to the GPU worker; checkpoint
   (Qdrant + Supabase) every 1,000 images so jobs are restartable.
5. **Domain `domain/wildlife_brain.py`** (NEW — keep separate from the perceptual-hash
   `domain/clustering.py`): `WildlifeBrainStep(PipelineStep)` runs after `AnimalCropStep`:
   embed crops → UMAP(2D persisted, 50D for clustering) → HDBSCAN(preset `small`) → purity score →
   upsert Qdrant → write back `media` columns. Purity→`review_depth`: `≥0.85 bulk`, `0.65–0.84
   sample`, `<0.65 full`.
6. **Job:** `embed_deployment_job` in `definitions.py` (runner, G3) with progress events for `useJob`.
7. **Router `routers/brain.py`** (envelope, G5), behind `FF_WILDLIFE_BRAIN_ENABLED`:
   - `POST /api/brain/embed/{deployment_id}` (enqueue; **also accepts client-computed vectors** for
     local mode — see §7)
   - `GET  /api/brain/clusters/{deployment_id}`
   - `POST /api/brain/clusters/{cluster_id}/confirm` (bulk-create `observations`, full provenance, one txn)
   - `PATCH /api/brain/clusters/{cluster_id}/split`
   - `GET  /api/brain/outliers/{deployment_id}`
   - `GET  /api/brain/similar/{media_id}?n=&org_scoped=`
   - `GET  /api/brain/umap/{deployment_id}`
   - `POST /api/brain/tsne/{deployment_id}` (on-demand, not persisted)
   - `POST /api/brain/intra-species/{cluster_id}`
8. **QA router `routers/qa.py`:** seed 5% random blind sample (`qa_samples`); `GET /api/qa/report/{deployment_id}`.
9. **Infra:** `docker-compose.yml` += `qdrant` (volume `/qdrant/storage`) and `embedding-worker`
   (GPU passthrough in prod; CPU+ViT-S in dev). `config.py` += `QDRANT_URL`, `HF_TOKEN`,
   `AZURE_GPU_*`, `EMBEDDING_BATCH_SIZE`.
10. **Deps:** `torch>=2.2`, `transformers>=4.40`, `huggingface_hub`, `hdbscan>=0.8.33`,
    `scikit-learn>=1.4`, `qdrant-client>=1.9`, `umap-learn>=0.5`, AI-EcoNet toolkit (pinned hash).
    Put these in the **worker** image; keep the API image lean.

**Pre-flight (blocks production rollout):** run AI-EcoNet benchmark on NZ subsets (kiwi, kea, takahē,
tūī, weka, possum, ship rat). Require V-measure ≥ 0.90. **Add the ViT-S/ViT-H 1280d parity check
(§1.2)** to this run.

**Acceptance:** 500-image test deployment → media rows have `embedding_id/run_id/cluster_id/umap_x/y`;
Qdrant holds 500 vectors; `confirm` creates provenance-complete observations; outlier rate <2%;
purity + `review_depth` set; QA 5% queue seeded.

**Review checklist:** ☐ `wildlife_brain.py` ≠ `clustering.py` ☐ no DINOv2 path / 768d anywhere
☐ both variants 1280d → one collection ☐ model_name from registry enum ☐ job via existing runner (no
ARQ) ☐ Qdrant + ML deps only in worker image ☐ envelope ☐ schema in ww-backend ☐ NZ V-measure ≥0.90
recorded.

---

## 6b. Phase 5.5 — Embedding versioning & Qdrant DR

**Schema [ww-backend]:** `embedding_runs`, `processing_runs` tables; add FK constraint
`media.embedding_run_id → embedding_runs.id`; backfill Phase 5 rows.

**Steps**
1. **Domain:** `reprocess_deployment(deployment_id, model, version)`,
   `reprocess_project(project_id, model)`, `reprocess_all(model, dry_run=True)` — each creates a new
   `embedding_run`, marks the old `superseded`, re-embeds, retains old `cluster_assignments` linked to
   the superseded run. `dry_run` estimates GPU hours/cost.
2. **Router (brain.py):** `GET /embedding-runs/{deployment_id}`,
   `POST /reprocess/deployment/{id}`, `POST /reprocess/project/{id}`,
   `GET /compare-runs?run_a=&run_b=` (label-change rate + divergent media ids).
3. **DR:** daily Qdrant snapshot → **private Supabase Storage bucket** `qdrant-backups/{date}.snapshot`
   (7-day retention, monthly restore drill). Originals in Google Drive + crop URLs/run configs in
   Supabase remain the source of truth, so Qdrant is always rebuildable: read
   `embedding_runs (status=complete)` → re-run `WildlifeBrainStep` from `animal_crop_url` → re-upsert.
   RPO 24h / RTO 48h @1M. (No Azure storage — consolidated on Supabase/Drive.)
4. **Docs:** check the cost-model table into `docs/`.

**Acceptance:** all Phase-5 rows have valid `embedding_run_id`; `reprocess_deployment` tested e2e on
500 images; `compare-runs` correct; daily backup operational; cost table approved.

**Review checklist:** ☐ FK only added after backfill ☐ superseded rows retained (not deleted)
☐ dry-run gating on `reprocess_all` ☐ snapshot job via runner ☐ docs updated.

---

## 7. Local in-browser embedding (WebGPU) — DINOv3 ViT-S/16+   [local/webgpu]

**Why:** lets users embed without server GPU; keeps images on-device (only vectors leave the browser).
Local variant **`dinov3-vits`** = DINOv3 **ViT-S/16, 384-d**, written to its **own** collection
`media_embeddings_vits` (it does **not** share the server's 1280-d `media_embeddings` — different space;
no cross-variant similarity).

**Model**
- Use **`onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX`** directly (pre-packaged for
  Transformers.js + WebGPU; no gated HF access needed). Already recorded as the variant's
  `onnx_artifact_id` in `registries/embedding_registry.py`. (Optional: re-export via
  `optimum-cli export onnx …` if you want to self-host.)

**Frontend (`frontend/src/lib/embedding/`)**
1. Add `@huggingface/transformers` (transformers.js v3).
2. `extractor = await pipeline('image-feature-extraction', 'onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX',
   { device: 'webgpu', dtype: 'fp32' })`. **Preprocessing + pooling must match the server's ViT-S path**
   — fetch them from `GET /api/brain/local-config` (`get_local_embedding_config()`), don't hardcode.
3. Capability gate: feature-detect `navigator.gpu`; if absent or low-mem, hide local mode and offer
   server embedding. Surface OOM risk; target Chrome/Edge + discrete GPU.
4. `useLocalEmbedding` hook: for each `animal_crop_url`, compute the **384-d** vector locally, batch them,
   then `POST /api/brain/embed/{deployment_id}` with `{ mode: 'client_vectors', model_name:
   'dinov3-vits', vectors: [...] }`.

**Backend**
- `POST /api/brain/embed/{deployment_id}` accepts either `mode: 'server'` (enqueue GPU job) or
  `mode: 'client_vectors'` (validate dim == the variant's dim → upsert to the variant collection →
  run HDBSCAN+UMAP server-side → write `media_embeddings`). HDBSCAN/UMAP always run server-side.
- The `embedding_run` records `model_name='dinov3-vits'`, `embedding_dim=384`,
  `qdrant_collection='media_embeddings_vits'` (provenance distinguishes local vs server).
- **Validation:** reject vectors whose dim ≠ `get_embedding_dim(model_name)` or whose `model_name`
  isn't a registry variant.
- **Flag:** `FF_LOCAL_EMBEDDING_ENABLED`. *(Status: endpoint currently returns NOT_IMPLEMENTED for
  client_vectors; this is the remaining slice.)*

**Acceptance:** on a WebGPU laptop, a 200-crop deployment embeds locally (384-d), posts vectors, and
clusters server-side in `media_embeddings_vits`; within-variant "show similar" works.

**Review checklist:** ☐ preprocessing/pooling fetched from `/local-config` (one source) ☐ dim ==
variant dim enforced server-side ☐ only vectors (never images) leave the browser ☐ capability + OOM
gating ☐ provenance records variant + dim + collection ☐ flag-gated.

---

## 8. Phase 7 — Native Wildlife Watcher UI

**Routes (under existing `RequireAuth` in `App.tsx`):** `/explore/:id` (ImageExplorerPage),
`/clusters/:id` (ClusterReviewPage — *primary v3 workflow*), `/umap/:id` (UmapExplorerPage),
`/review/:id` (ReviewQueuePage).

**Steps**
1. **Hooks (G-frontend):** `useMediaRegistry`, `useClusters`, `useClusterDetail`, `useUmapCoords`,
   `useSimilarImages`, `useReviewQueue`, `useOutlierQueue`, `useQaSamples`, `useReviewConflicts` —
   all via `apiClient` + TanStack Query (no raw `fetch`). Follow existing `useJob` patterns.
2. **ImageExplorerPage:** CDN thumbnail grid (`thumbnail_url`), filters (species/cluster/review_status/
   date/is_outlier/confidence), bbox overlay on hover, multi-select bulk ops, J/K/A/R/S/E shortcuts,
   slide-out detail with "Show similar" → `/api/brain/similar`.
3. **ClusterReviewPage:** cluster list (contact sheets, size, mean confidence, purity badge +
   `review_depth`), one-click confirm → bulk observations, merge (drag), split, outliers last. Disable
   bulk-confirm on low-purity clusters.
4. **UmapExplorerPage:** **add `deck.gl`** `ScatterplotLayer` (GPU render 100k+ pts); color by
   cluster/review_status/taxon; hover thumbnail; lasso select → bulk; outliers as hollow red circles;
   purity badges on centroids; cross-deployment overlay stub for Phase 9.
5. **ReviewQueuePage:** ordered by `active_learning_score DESC` (Phase 8); full-screen focus;
   A/R/E/S keys write straight to Supabase via API; burst/event filmstrip; progress funnel.
6. **Navigation:** MyDataPage "Explore → Clusters → Review → Events" row + "12/18 clusters confirmed";
   HomePage deployment cards show `cluster_unconfirmed_count` / `outlier_count`.
7. **`/labeling`:** already native-only (FiftyOne + CVAT were removed). Redirect `/labeling` → `/review`
   once the new queue lands, or retire the route.
8. **Multi-user conflict:** wire `review_conflicts` + cluster lock (`review_state`, `locked_by`,
   `lock_expires` 30-min) — surfaced to a supervisor.

**Schema [ww-backend]:** `cluster_assignments.review_state/locked_by/locked_at/lock_expires`;
`review_conflicts` (from Phase 5 DDL if not already landed).

**Acceptance:** 5k-image deployment <2s first paint; 18-cluster deployment confirmed <5 min by one
reviewer; UMAP 10k pts @60fps; conflict detection fires on simultaneous divergent confirmations.

**Review checklist:** ☐ all data via apiClient hooks (no raw fetch) ☐ thin route components
☐ deck.gl only on UMAP page ☐ envelope parsed once ☐ eslint+tsc+build.

---

## 9. Phase 8 — Active Learning + QA

**Schema [ww-backend]:** `media.active_learning_score`, `media.al_score_updated_at`; index
`(deployment_id, review_status, active_learning_score DESC)`.

**Steps**
1. **Domain `active_learning.py`:** `compute_active_learning_score(media_id)` =
   `0.35*novelty + 0.35*uncertainty + 0.20*disagreement + 0.10*outlier_boost` (novelty = Qdrant
   distance to nearest centroid; uncertainty = `1 - max ai confidence`; disagreement = ai≠human).
2. **Job:** `recompute_al_job(deployment_id)` (runner, G3); triggered after cluster confirm /
   annotation batch. If it deadlocks under concurrency, fall back to a scheduled run (rollback trigger).
3. **Router (brain.py):** `POST /api/brain/recalculate-al-scores/{deployment_id}`,
   `GET /api/brain/review-queue/{deployment_id}?limit=` (with score breakdown).
4. **QA (qa.py):** `GET /api/qa/report/{deployment_id}` — precision/recall/cluster-quality from the
   blind 5% sample. **Keep AL and QA separate** (QA is unbiased; AL is biased by design).
5. **FE:** ReviewQueuePage default sort = AL score; per-image score bar with reason.

**Acceptance:** AL cohort ≥5% higher accuracy vs random on a held-out deployment; AL recompute <60s
after a confirm; QA report returns valid precision (>85% on first deployment).

**Review checklist:** ☐ AL ≠ QA modules ☐ score weights match spec ☐ job via runner ☐ index requested
in ww-backend ☐ envelope.

---

## 10. Phase 9 — Conservation Intelligence

**Schema [ww-backend]:** `ecological_shift_reports`, `conservation_alerts`; `taxa.status`
(`confirmed|candidate|rejected`). Consider materialized views for the health dashboard.

**Steps**
1. **Domain `intelligence.py`:** `detect_distribution_shift(deployment_id, period_a, period_b)` via
   Jensen-Shannon / MMD over Qdrant vectors → `EcologicalShiftReport` (alert level by divergence).
   Species-discovery workflow (outlier clusters → provisional `taxa.status='candidate'` → expert
   queue; cross-org candidate matching at cosine >0.85).
2. **Router `intelligence.py`** (flag `FF_INTELLIGENCE_ENABLED`):
   `POST /shift-detection/{deployment_id}`, `GET /health/{project_id}`, `GET /alerts/{project_id}`,
   `GET /unknown-species/{org_id}`, `GET /cross-deployment/similar`, `GET /occupancy/{project_id}`,
   `GET /accumulation/{deployment_id}`.
3. **FE:** Dataset Health Dashboard (species coverage, data quality, ecological signals, spatial/
   temporal bias) as the primary entry point; cross-deployment UMAP overlay (stable coords).
4. **Cross-org:** Qdrant filter by `org_id`; cross-org only with explicit per-project opt-in (G-security).

**Acceptance:** 3-deployment health dashboard <3s; shift detection plausible on a known seasonal set;
camera-malfunction alert fires on simulated trigger-rate drop; accumulation curve matches manual calc.

**Review checklist:** ☐ cross-org gated by opt-in ☐ materialized views requested if queries >10s
☐ envelope ☐ flag-gated ☐ schema in ww-backend.

---

## 11. Phase 10 — Hardening & reproducible export

> FiftyOne (Voxel51) and CVAT were already removed from ww-website as a tech-debt pass — `/labeling`
> is native-only and the `mongodb`/`fiftyone` infra is gone. Any residual CVAT footprint in
> `ww-backend` (compose file, `cvat` views, `observation_annotations.source` enum value) is tracked
> separately as a schema PR.

**Steps**
1. **CamtrapDP export** (`domain/camtrapdp.py`): add optional `embeddings.csv` (media_id, cluster_id,
   umap_x/y, embedding_run_id, model_name, model_version) and full model provenance in
   `datapackage.json`. UMAP coords are stable → reproducible.
2. **Hardening:** Qdrant HNSW `ef` tuning (p99 <100ms @1M); embedding job checkpoint/resume;
   Supabase composite indexes `(deployment_id, is_outlier, active_learning_score DESC)` and
   `(deployment_id, cluster_id)` **[ww-backend]**; UMAP spatial-tile pagination >50k images.
3. **Observability:** Prometheus on embedding-worker (images/s, gpu_util, upsert p99; stall alert);
   Qdrant health endpoint on the admin page.

**Acceptance:** CamtrapDP includes embeddings + provenance; similarity p99 <100ms @100k in staging;
10k-image embed without checkpoint failure.

**Review checklist:** ☐ export reproducible ☐ indexes requested in ww-backend ☐ tests green.

---

## 12. Suggested first slices for your friend (and what I'll diff)

Ordered so each slice is independently reviewable against the remote branch:

1. **Registry + config + flags** — `registries/embedding_registry.py` (model_name enum
   `dinov3-vith|dinov3-vits`, 1280d, preprocessing constants), `config.py` flags + Qdrant/HF/Azure-GPU
   settings. *Small, foundational, low-risk.*
2. **Qdrant service** — `services/qdrant_client.py` + a unit test with a local Qdrant container.
3. **SpeciesNet step (Phase 4.5)** — `services` wrapper + real `SpeciesNetStep` in `pipeline.py`.
4. **Media Registry (Phase 6)** — `domain/media_registry.py` + `MediaPreparationStep`/`AnimalCropStep`
   + `routers/media.py` endpoints. (Coordinate the `media` column adds in **ww-backend** first.)
5. **Wildlife Brain core (Phase 5)** — `domain/wildlife_brain.py` + `services/dinov3.py` +
   `embed_deployment_job` + `routers/brain.py` (embed/clusters/confirm first).
6. **Local WebGPU (§7)** — `lib/embedding/` + `useLocalEmbedding` + `client_vectors` branch of
   `/api/brain/embed`.

**When reviewing diffs vs remote GitHub, I'll check, per slice:** G1 (no schema in this repo) · G2
(no FastAPI in domain) · G3 (existing runner, no ARQ) · G4 (flag-gated, off by default) · G5 (envelope)
· G6 (names from registry) · G7 (columns verified) · DINOv3-only / per-variant dim+collection
(ViT-H 1280·`media_embeddings`, ViT-S 384·`media_embeddings_vits`) · ruff/pytest/eslint/tsc/build.

---

## 13. Open questions to confirm with the ww-backend owner (G1/G7)

- Exact current columns on `media`, `observations` (esp. bounding-box storage), `taxa`, `deployments`.
- Does an `annotation_runs`-style provenance table already cover what `embedding_runs` needs, or is it
  net-new?
- Migration workflow / naming in `ww-backend/supabase/schemas/` and how the website pins a schema
  version.
- RLS policies for the new tables (`cluster_assignments`, `qa_samples`, `review_conflicts`,
  `conservation_alerts`) and the `org_id` scoping for cross-org similarity opt-in.
- ~~ViT-S/ViT-H 1280d parity~~ **Resolved:** per-variant dims/collections (ViT-S 384 / ViT-H 1280) — §1.2.
```
