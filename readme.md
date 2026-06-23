<p align="center">
  <a href="https://wildlife.ai/">
    <img src="https://wildlife.ai/wp-content/uploads/2025/10/wildlife_ai_logo_dark_lightbackg_1772x591.png" alt="Wildlife.ai Logo" width="400">
  </a>
</p>

<h1 align="center">Wildlife Watcher Web</h1>

<p align="center">
  <strong>The web platform for uploading, AI-labelling, reviewing and analysing camera-trap data from Wildlife Watcher devices.</strong>
</p>

Welcome to the development repository of the Wildlife Watcher web app. This README covers
local setup and day-to-day commands; everything deeper lives under [`documentation/`](#documentation).

The app is a two-service stack: a **React + Vite** frontend and a **FastAPI** backend, both
talking to **Supabase** (PostgreSQL, Auth, Storage). Conservation teams use it to upload SD-card
images to Google Drive, run the **SpeciesNet** AI pipeline, review/label observations, and export
CamtrapDP / Darwin Core datasets.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 8, React Router 7, TanStack Query 5
- **Backend**: FastAPI (Python 3.11+), async in-process job runner (ARQ-ready)
- **Database / Auth / Storage**: Supabase (PostgreSQL + RLS, Auth, Storage)
- **AI**: SpeciesNet ensemble (detector + species classifier); DINOv3 "Wildlife Brain" embeddings → HDBSCAN clustering → active-learning review
- **Charts / Maps**: Vega-Lite (`vega-embed`), Leaflet (`react-leaflet`)
- **Hosting**: Cloudflare Pages (frontend) + Azure Container Apps (backend)
- **External services**: Google Drive (image archive), Azure Blob (temp buffer), Qdrant (embedding vectors), iNaturalist, Sentry
- **Schema owner**: the database schema is owned by the [`ww-backend`](https://github.com/wildlifeai/wildlife-watcher-backend) repo (see [Database Migrations](#database-migrations))

> For the complete dependency reference with versions and rationale, see the
> [Technology Stack Guide](./documentation/onboarding/01-TECHNOLOGY-STACK.md).

## Architecture at a Glance

How the services fit together. Each owns one job; the topology is identical in dev
and production — only the instances and scale differ (see the
[Deployment Guide](./documentation/resources/deployment-guide.md)).

```
                            ┌──────────────────────────┐
          Browser  ───────▶ │  Cloudflare Pages         │   static React/Vite bundle
                            │  (frontend, CDN, DNS)     │   + per-branch previews
                            └──────────────────────────┘
              │                              │
              │ direct reads + observation   │ heavy / privileged work
              │ writes (RLS, user JWT)       │ (VITE_API_BASE_URL)
              ▼                              ▼
   ┌────────────────────┐        ┌──────────────────────────────┐
   │  Supabase          │◀──────▶│  FastAPI backend             │
   │  • Postgres + RLS  │ service│  (Azure Container Apps + ACR)│
   │  • Auth (JWT)      │  role  │  • in-process asyncio jobs   │
   │  • Storage:        │        │  • EXIF, AI pipeline,        │
   │    media-renditions│        │    LoRaWAN, model convert    │
   │    (public bucket) │        └──────────────────────────────┘
   │  • api_jobs        │            │        │          │
   └────────────────────┘            │        │          │
                                     ▼        ▼          ▼
                          ┌─────────────┐ ┌──────────┐ ┌────────────────┐
                          │ Azure Blob  │ │ Google   │ │ Qdrant         │
                          │ (TEMP buffer│ │ Drive    │ │ (DINOv3 vectors│
                          │  during     │ │ (PERMANENT│ │  similarity /  │
                          │  upload;    │ │  original │ │  clustering)   │
                          │  deleted    │ │  archive) │ │  ⚠ local only  │
                          │  after)     │ │           │ │  today         │
                          └─────────────┘ └──────────┘ └────────────────┘

   iNaturalist ──▶ taxa autocomplete + lineage, observation publish + community-ID sync
   TTN/Chirpstack ──▶ LoRaWAN uplink webhooks ──▶ FastAPI ──▶ Supabase
```

**One image upload, end to end** (detail in
[03-DATA-AND-SYNC](./documentation/onboarding/03-DATA-AND-SYNC.md)):

1. Browser (Cloudflare) drags images in → `POST /api/exif/parse` on the Azure backend.
2. Backend parses EXIF, matches the deployment, **buffers bytes to Azure Blob** (temporary), enqueues a job.
3. Job downloads from the buffer → **uploads originals to Google Drive** (content-hash dedup) → **inserts `media` rows in Supabase** (`file_path = gdrive://…`).
4. Thumbnails/previews are generated and stored in the **public Supabase `media-renditions` bucket** — that's what the grid displays (Drive is never on the hot path).
5. The **AI pipeline** auto-runs (SpeciesNet → crop → classify), writing `observations` to Supabase; embeddings optionally go to **Qdrant**.
6. **Azure blobs are deleted** — they're purely transient; Drive is the archive, Supabase holds the rows + renditions.

The browser reads observations **directly from Supabase** (RLS-scoped by the user's JWT) and only calls the **Azure backend** for privileged/heavy work. **iNaturalist** is contacted when reviewers publish observations or look up taxa.

> **Cloud gap:** Qdrant runs in the local `docker-compose` stack but is **not yet provisioned**
> in the dev-cloud or staging environments. Until it is, the Wildlife Brain
> (embeddings → clustering → similarity) is local-only — see the
> [Deployment Guide](./documentation/resources/deployment-guide.md#qdrant-vector-store-not-yet-in-cloud).

## Architecture at a glance

How the services fit together. Dev-cloud and staging/production have the **same topology** — only
the instances differ (dev Supabase project, `ww-backend-dev` container app, `*.pages.dev` previews,
dev Drive subfolder; see the [Deployment Guide](./documentation/resources/deployment-guide.md)).

```
                                   ┌─────────────────────────────┐
                                   │   Browser (React + Vite)    │
                                   │  served by CLOUDFLARE PAGES │
                                   │  wildlifewatcher.ai / *.pages.dev
                                   └──────┬───────────────┬──────┘
                 direct reads/writes      │               │  privileged / heavy work
                 (user JWT, RLS-scoped)   │               │  (REST, VITE_API_BASE_URL)
                                          ▼               ▼
                            ┌──────────────────┐   ┌────────────────────────────────┐
                            │     SUPABASE     │   │  FastAPI backend on AZURE      │
                            │ Postgres + RLS   │◀──│  Container Apps (image via ACR,│
                            │ Auth (JWT)       │   │  GitHub Actions deploy)        │
                            │ Storage:         │   │  in-process async job runner   │
                            │  · media-        │   └──┬──────┬──────┬──────┬────────┘
                            │    renditions    │      │      │      │      │
                            │    (public:      │      │      │      │      │
                            │    thumbs/crops) │      ▼      │      ▼      ▼
                            │  · firmware,     │  ┌────────┐ │ ┌────────┐ ┌─────────────┐
                            │    ai-models     │  │ AZURE  │ │ │ GOOGLE │ │ iNATURALIST │
                            └──────────────────┘  │ BLOB   │ │ │ DRIVE  │ │ taxa + obs  │
                                                  │ temp   │ │ │ perm.  │ │ publishing /│
                                                  │ upload │ │ │ image  │ │ community-ID│
                                                  │ buffer │ │ │ archive│ │ sync        │
                                                  └────────┘ │ └────────┘ └─────────────┘
                                                             ▼
                                                       ┌───────────┐
                                                       │  QDRANT   │  DINOv3 vectors
                                                       │ (container│  (Wildlife Brain) —
                                                       │  in local │  ⚠ not yet provisioned
                                                       │  compose) │  in the cloud envs
                                                       └───────────┘

Image upload flow:  browser → backend /

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 20 (LTS)+ | Frontend dev server and build |
| **Python** | 3.11+ | Backend runtime |
| **Git** | Any | Version control |
| **Docker** + Compose | _(optional)_ | Containerised full-stack run / deploy |

A **Supabase** project with the Wildlife Watcher schema (from `ww-backend`) is required.

## Getting Started

The frontend and backend share a **single `.env` at the repository root** (`vite.config.ts` loads
it from `../`, and the backend reads `../.env` first).

1. **Clone and configure environment**
   ```bash
   git clone https://github.com/wildlifeai/ww-website.git
   cd ww-website
   cp .env.example .env       # then fill in the Supabase keys below
   ```
   ```env
   SUPABASE_URL=https://your-project.supabase.co/
   SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...   # bypasses RLS — keep secret
   ```

2. **Backend (FastAPI)**
   ```bash
   cd backend
   python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
   Verify: <http://localhost:8000/health> → `{"status":"ok"}` · Swagger at `/docs`.

3. **Frontend (React/Vite)** — in a second terminal
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Opens at <http://localhost:5173> with hot-reload.

> Full step-by-step setup, the env-var reference, and a verification checklist are in
> [00-GETTING-STARTED.md](./documentation/onboarding/00-GETTING-STARTED.md).

## Building & Deployment

```bash
# Frontend → static bundle (tsc -b + vite build → frontend/dist/)
cd frontend && npm run build

# Full stack via Docker
cp .env.example .env && docker compose up -d --build
```

Set `VITE_API_BASE_URL` to your production backend URL at build time. Full hosting options
(Cloudflare Pages, Vercel, Render, VPS) and the production security checklist are in the
[Deployment Guide](./documentation/resources/deployment-guide.md).

## Running the AI/ML pipeline locally

The heavy ML dependencies (`torch`, `speciesnet`, `pybioclip`, `transformers`, `hdbscan`, …) and
the OpenCV **system libs** are **not** in the lean production image — they live in the **`dev`**
Docker target (`backend/Dockerfile` → `backend/requirements-ml.txt`). Always start the local stack
with **both** compose files:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

The dev API is tagged **`ww-website-api-dev`** (distinct from the base `ww-website-api`) so a
base-only `docker compose up` can't clobber the ~10 GB ML image — the recurring cause of
`No module named 'speciesnet'`.

**Enable the flags** in `.env` (all off by default):

| Flag | Enables |
|------|---------|
| `FF_ML_ENABLED` + `FF_PIPELINE_ENABLED` | the pipeline + auto-annotate after upload |
| `FF_SPECIESNET_ENABLED` | SpeciesNet detect + classify (core observations) |
| `FF_BIOCLIP_ENABLED` | BioCLIP secondary zero-shot classifier |
| `FF_MEDIA_REGISTRY_ENABLED` | thumbnails / animal crops (`media_prep`) |
| `FF_WILDLIFE_BRAIN_ENABLED` | DINOv3 embeddings / clustering |

**Model weights download on the first inference** (SpeciesNet from Kaggle; BioCLIP + DINOv3 from
HuggingFace), so the first run is slow then cached. For CPU dev set `EMBEDDING_DEVICE=cpu`,
`BIOCLIP_DEVICE=cpu`, and `EMBEDDING_DEFAULT_MODEL=dinov3-vits` (small/fast). DINOv3 is a **gated**
HF model — put a token in `HF_TOKEN` (SpeciesNet/BioCLIP need none). Architecture:
[04-AI-PIPELINE.md](./documentation/onboarding/04-AI-PIPELINE.md).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Backend refuses to start | A required env var is missing — `config.py` validates them at boot. Check `SUPABASE_*`. |
| Frontend can't reach API | Set `VITE_API_BASE_URL` (defaults to `http://localhost:8000`); confirm backend is running. |
| `permission denied for table observations` | The `authenticated` role lacks write GRANTs — apply the `ww-backend` migration. See [03-DATA-AND-SYNC.md](./documentation/onboarding/03-DATA-AND-SYNC.md). |
| iNaturalist / pipeline endpoints 404 | They are feature-flagged off by default — see [Feature Flags](#feature-flags). |
| `No module named 'speciesnet'` / `torch` in a job | The container is on the lean base image. Rebuild + start with **both** compose files — see [Running the AI/ML pipeline locally](#running-the-aiml-pipeline-locally). |
| `libxcb.so.1: cannot open shared object file` during inference | OpenCV system libs missing — rebuild the **dev** image (the Dockerfile installs `libgl1`, `libxcb1`, …). |
| Uploaded images don't appear in Annotations | The Drive credential file is mounted only by the dev compose — start with both files, or the upload job can't authenticate. |
| Vite env vars undefined | Root `.env` only; `vite.config.ts` maps `SUPABASE_URL`→`VITE_SUPABASE_URL`, etc. No `frontend/.env` needed. |

## Database Migrations

> [!CAUTION]
> **Never make database schema changes from this repository.** All schema, RLS policies, and
> table GRANTs are owned by the [`ww-backend`](https://github.com/wildlifeai/wildlife-watcher-backend)
> repo. The web app only consumes the schema (and, for the `authenticated` role, whatever
> table privileges `ww-backend` grants). When a write fails with `permission denied for table …`,
> the fix is a `ww-backend` migration — see [03-DATA-AND-SYNC.md](./documentation/onboarding/03-DATA-AND-SYNC.md).

## Testing

```bash
cd backend && python -m pytest tests/ -v          # backend unit/domain tests
cd frontend && npm run lint && npx tsc --noEmit    # frontend lint + type check
```

See the [Testing Guide](./documentation/resources/testing-with-seed-users.md) for seed users and role-based validation.

## Additional Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` (frontend) | Vite dev server with hot-reload |
| `npm run build` (frontend) | `tsc -b` type-check + production bundle |
| `npm run lint` (frontend) | ESLint |
| `uvicorn app.main:app --reload` (backend) | Dev API server |
| `ruff check app/ && ruff format app/` (backend) | Lint + format Python |
| `python -m pytest tests/ -v` (backend) | Run the test suite |
| `docker compose up -d --build` | Full-stack container run |

## Documentation

All documentation lives under [`documentation/`](./documentation) — see the
**[documentation index](./documentation/README.md)** for the complete, status-tagged list. Summary:

### Onboarding (Start Here)

| Guide | What It Covers |
|-------|----------------|
| [00-GETTING-STARTED.md](./documentation/onboarding/00-GETTING-STARTED.md) | Setup, env reference, run both services, verification checklist |
| [01-TECHNOLOGY-STACK.md](./documentation/onboarding/01-TECHNOLOGY-STACK.md) | Every dependency, version, and integration |
| [02-CODEBASE-GUIDE.md](./documentation/onboarding/02-CODEBASE-GUIDE.md) | Repo layout, frontend pages/nav/routes, backend layered architecture |
| [03-DATA-AND-SYNC.md](./documentation/onboarding/03-DATA-AND-SYNC.md) | Supabase, RLS + GRANT model, the async job system |
| [04-AI-PIPELINE.md](./documentation/onboarding/04-AI-PIPELINE.md) | SpeciesNet pipeline, blank handling, the DINOv3 Wildlife Brain & active learning |
| [05-ANNOTATION-WORKFLOW.md](./documentation/onboarding/05-ANNOTATION-WORKFLOW.md) | Annotations tab, ribbon, full-screen labeling modal, review provenance |

### Reference Guides (`documentation/resources/`)

| Guide | What It Covers |
|-------|----------------|
| [API Reference](./documentation/resources/api-reference.md) | Backend endpoint reference |
| [Deployment Guide](./documentation/resources/deployment-guide.md) | Render / VPS / Docker deployment + security checklist |
| [LoRaWAN Webhook Setup](./documentation/resources/lorawan-webhook-setup.md) | TTN / Chirpstack network-server configuration |
| [CamtrapDP Import](./documentation/resources/camtrapdp-import.md) | Importing CamtrapDP packages |
| [AI Model Pipeline](./documentation/resources/ai-model-pipeline.md) | Edge Impulse → Vela model conversion |
| [Embedded Model Lifecycle](./documentation/resources/embedded-model-lifecycle.md) | End-to-end on-device model flow across website / backend / mobile / firmware |
| [UI Components](./documentation/resources/ui-components.md) | Shared frontend design-system primitives |
| [Testing with Seed Users](./documentation/resources/testing-with-seed-users.md) | Role-based test users and validation |

### Development Reports (`documentation/development reports/`)

**Active engineering specs** (current hand-offs, kept up to date until shipped) — e.g.
[bmp-ingestion-analysis.md](./documentation/development%20reports/bmp-ingestion-analysis.md),
[dual-camera-rpi-analysis.md](./documentation/development%20reports/dual-camera-rpi-analysis.md),
[exif-telemetry-firmware-spec.md](./documentation/development%20reports/exif-telemetry-firmware-spec.md),
[access-test-seed-spec.md](./documentation/development%20reports/access-test-seed-spec.md).

**Archive** ([`development reports/_archive/`](./documentation/development%20reports/_archive)) — frozen
point-in-time plans, roadmaps and research spikes (v2/v4 plans, the UI-redesign roadmaps, the charting
spike). They capture *why* decisions were made and are **not** kept current with the code. Each report
carries a `> **Status:**` banner. Full list in the [documentation index](./documentation/README.md).

## Contributing

Submit a [pull request](https://github.com/wildlifeai/ww-website/pulls). Use
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, …).
Backend changes follow the **router → domain → service** layering (see
[02-CODEBASE-GUIDE.md](./documentation/onboarding/02-CODEBASE-GUIDE.md)); frontend changes must pass
`npm run lint` and `tsc --noEmit`.

## Maintainers

- Tobyn Packer
- Victor Anton

If you find this project helpful, consider [donating to Wildlife.ai](https://givealittle.co.nz/donate/org/wildlifeai).

## License

Licensed under the **GPL-3.0 License** — see [`LICENSE`](LICENSE).
