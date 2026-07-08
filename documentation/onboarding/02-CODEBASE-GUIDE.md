# 02 — Codebase Guide

How the repository is organised, how the frontend is routed, and how the backend is layered.

## Repository layout

```
ww-website/
├── readme.md                  # entry point (setup + command reference)
├── docker-compose.yml         # full-stack run (lean API image)
├── docker-compose.dev.yml     # dev overlay: ML image + Drive credential mount — always use BOTH files
├── documentation/             # all docs (onboarding / resources / development reports)
├── scripts/                   # dev utilities (seed-fixture generator, demo seeding, exports, …)
├── test-fixtures/             # camera-trap SD-card fixtures for upload testing (see its README)
├── backend/                   # FastAPI service
└── frontend/                  # React + Vite SPA
```

## Frontend (`frontend/src/`)

```
src/
├── App.tsx                 # Router, signed-in Layout (Toolkit·Annotations·Insights nav), auth guard, UploadProvider
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

### Signed-in navigation

Defined as `USER_TABS` in `App.tsx`. The active tab is highlighted, so pages no longer repeat
their own title. Lifecycle order: **prepare → collect → analyse**. The 📡 **Realtime** tab appears only
when the user has an active deployment.

| Tab | Route | Page |
|-----|-------|------|
| 🧰 Toolkit | `/toolkit` | `ToolkitPage` (upload, SD-card prep, manifest, model upload) |
| 📡 Realtime | `/field` | `FieldPage` (live-deployment view; shown only with an active deployment) |
| 🏷️ Annotations | `/annotations` | `AnnotationsPage` → `MediaBrowser` (+ full-screen modal) |
| 📈 Insights | `/insights` | `InsightsPage` (projects, deployments, charts, maps) |

### Routes

**Public**: `/`, `/login`, `/reset-password`, `/privacy`, `/terms`, `/resources`, `/faq`, `/guides`.

**Protected (`RequireAuth`)**

| Route | Page | Purpose |
|-------|------|---------|
| `/toolkit` | `ToolkitPage` | Upload, SD-card prep, manifest, privileged model upload |
| `/annotations` | `AnnotationsPage` | Filter/browse media; click a photo → full-screen labeling modal |
| `/insights` | `InsightsPage` | Projects/Deployments, charts, maps |
| `/field` | `FieldPage` | Active-deployment view (LoRaWAN heartbeats) |
| `/upload-data`, `/upload/logs` | `UploadDataPage`, `UploadLogsPage` | Image upload + log view |
| `/manifest` | `ManifestPage` | Firmware `MANIFEST.zip` builder |
| `/upload-model` | `UploadModelPage` | Edge Impulse → Vela model upload (org managers) |
| `/clusters/:id` | `ClusterReviewPage` | Bulk-confirm HDBSCAN clusters |
| `/review/:id` | `ReviewQueuePage` | Active-learning review queue |
| `/umap/:id` | `UmapExplorerPage` | Embedding-space exploration |
| `/intelligence/:id` | `DatasetHealthPage` | Dataset health + QA agreement (per project) |
| `/reporting/:id` | `ReportingPage` | Diel activity, CamtrapDP / Darwin Core exports |
| `/processing` | `ProcessingHistoryPage` | Upload & pipeline job history |
| `/notifications` | `NotificationsPage` | Notification inbox |
| `/settings` | `SettingsPage` | Account settings |
| `/admin/usage` | `AdminUsagePage` | Per-user usage limits (platform admin) |

**Redirects / legacy**: `/results` → `/insights`, `/other` → `/toolkit`, `/my-data` → `/insights`,
`/analyse-images` → `/upload-data` (query strings preserved), `/explore/:id` →
`/annotations?deployment=:id` (the Annotations grid now does clustering, bulk cluster-confirm and
similar-image search), `/analysis/:id` → `/reporting/:id`. The old `MyDataPage` is retained only at
`/my-data-legacy`. `LabelingPage` was **removed** — its rich editor now lives in the Annotations
full-screen modal (see [05-ANNOTATION-WORKFLOW](./05-ANNOTATION-WORKFLOW.md)). `EventReviewPage` is
currently **unrouted** (`/events/:id` was removed from `App.tsx`; the file remains pending
re-route-or-delete).

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
