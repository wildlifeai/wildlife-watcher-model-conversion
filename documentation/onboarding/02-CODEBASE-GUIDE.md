# 02 — Codebase Guide

How the repository is organised, how the frontend is routed, and how the backend is layered.

## Repository layout

```
ww-website/
├── readme.md                  # entry point (setup + command reference)
├── docker-compose.yml         # full-stack run
├── documentation/             # all docs (onboarding / resources / development reports)
├── backend/                   # FastAPI service
└── frontend/                  # React + Vite SPA
```

## Frontend (`frontend/src/`)

```
src/
├── App.tsx                 # Router, signed-in Layout (3-tab nav), auth guard, UploadProvider
├── main.tsx                # React entry
├── pages/                  # route-level components
├── components/
│   ├── ui/                 # design-system primitives (Modal, Ribbon, DataTable, ControlBar,
│   │                       #   FilterSelect, StatusBadge, VegaChart) — see resources/ui-components.md
│   ├── data/               # feature components (MediaBrowser, MediaDetail, SpeciesPicker,
│   │                       #   DeploymentMap, ObservationReports, ChartBuilder, …)
│   ├── upload/             # UploadModal, ProgressDock (global upload UX)
│   ├── toolkit/            # AnalyseImages, GenerateManifest, UploadModel, PipelineStatusBox
│   └── common/             # nav/shared bits
├── contexts/UploadContext.tsx  # global upload store (survives navigation)
├── hooks/                  # useAuth, useJob, useBrain, useIntelligence, usePipeline, …
├── lib/                    # apiClient (fetch + Supabase JWT), observations (provenance helpers)
├── config/supabase.ts      # Supabase client init
└── styles/index.css        # CSS variables + base styles
```

### Signed-in navigation (3 tabs)

Defined as `USER_TABS` in `App.tsx`. The active tab is highlighted, so pages no longer repeat
their own title.

| Tab | Route | Page |
|-----|-------|------|
| 🏷️ Annotations | `/annotations` | `AnnotationsPage` → `MediaBrowser` (+ full-screen modal) |
| 📊 Results | `/results` | `ResultsPage` (Projects · Deployments · Map · Reports ribbon) |
| ⚙ Other | `/other` | `OtherPage` (export, SD-card prep, model upload) |

### Routes

**Public**: `/`, `/login`, `/reset-password`, `/privacy`, `/terms`, `/support`, `/resources`.

**Protected (`RequireAuth`)**

| Route | Page | Purpose |
|-------|------|---------|
| `/annotations` | `AnnotationsPage` | Filter/browse media; click a photo → full-screen labeling modal |
| `/results` | `ResultsPage` | Projects/Deployments tables, Map, Reports — under one ribbon |
| `/other` | `OtherPage` | CamtrapDP export, SD-card prep, privileged model upload |
| `/upload-data`, `/upload/logs` | `UploadDataPage`, `UploadLogsPage` | Image upload + log view |
| `/manifest` | `ManifestPage` | Firmware `MANIFEST.zip` builder |
| `/upload-model` | `UploadModelPage` | Edge Impulse → Vela model upload (org managers) |
| `/clusters/:id` | `ClusterReviewPage` | Bulk-confirm HDBSCAN clusters |
| `/review/:id` | `ReviewQueuePage` | Active-learning review queue |
| `/explore/:id`, `/umap/:id` | `ImageExplorerPage`, `UmapExplorerPage` | Embedding-space exploration |
| `/events/:id` | `EventReviewPage` | Temporal event aggregation |
| `/intelligence/:id` | `DatasetHealthPage` | Dataset health + QA agreement (per project) |
| `/analysis/:id`, `/reporting/:id` | `AnalysisPage`, `ReportingPage` | Diel activity, CamtrapDP / Darwin Core exports |

**Redirects / legacy**: `/my-data` → `/results`, `/analyse-images` → `/upload-data`. The old
`MyDataPage` is retained only at `/my-data-legacy`. `LabelingPage` was **removed** — its rich
editor now lives in the Annotations full-screen modal (see [05-ANNOTATION-WORKFLOW](./05-ANNOTATION-WORKFLOW.md)).

## Backend (`backend/app/`)

Layered so HTTP concerns never leak into business logic:

```
routers/   → thin HTTP controllers: validate input, delegate, shape ApiResponse
domain/    → pure business logic, NO FastAPI/HTTP imports (unit-testable)
services/  → infrastructure adapters (Supabase, Azure, Drive, Vela, SpeciesNet, http)
schemas/   → Pydantic request/response models
jobs/      → async job system (definitions, runner, store, ARQ worker)
middleware/→ request id, structured logging, rate limiting, CORS
registries/→ static config (camera configs, model + embedding registries)
```

**Routers** (`/api/*`): `exif`, `jobs`, `manifest`, `models`, `lorawan`, `clustering`,
`camtrapdp`, `inaturalist`, `media`, `pipeline`, `deployments`, `brain` (embeddings/clusters/UMAP/
similarity), `intelligence` (dataset health/alerts), `qa` (AI-vs-human agreement), `public_api`.

**Key domain modules**: `exif`, `photo_preprocessing`, `pipeline` (SpeciesNet steps), `events`,
`clustering`, `wildlife_brain` + `embedding_lifecycle` + `active_learning` (the DINOv3 "Brain"),
`intelligence`, `media_registry` / `media_resolver`, `model`, `manifest`, `lorawan`, `camtrapdp`,
`inaturalist`, `public_api`.

### Adding a feature (backend)

1. **Schema** — Pydantic models in `schemas/`
2. **Domain** — logic in `domain/` (no HTTP imports)
3. **Router** — thin endpoint in `routers/` (validate → delegate)
4. **Register** — include the router in `app/main.py`
5. **Test** — add to `tests/`

See [03-DATA-AND-SYNC](./03-DATA-AND-SYNC.md) for the job system and the Supabase RLS/GRANT model,
and [04-AI-PIPELINE](./04-AI-PIPELINE.md) for the inference layer.
