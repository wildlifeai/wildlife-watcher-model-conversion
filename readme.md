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
- **External services**: Google Drive (image archive), Azure Blob (temp buffer), iNaturalist, Sentry
- **Schema owner**: the database schema is owned by the [`ww-backend`](https://github.com/wildlifeai/wildlife-watcher-backend) repo (see [Database Migrations](#database-migrations))

> For the complete dependency reference with versions and rationale, see the
> [Technology Stack Guide](./documentation/onboarding/01-TECHNOLOGY-STACK.md).

## Prerequisites

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

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Backend refuses to start | A required env var is missing — `config.py` validates them at boot. Check `SUPABASE_*`. |
| Frontend can't reach API | Set `VITE_API_BASE_URL` (defaults to `http://localhost:8000`); confirm backend is running. |
| `permission denied for table observations` | The `authenticated` role lacks write GRANTs — apply the `ww-backend` migration. See [03-DATA-AND-SYNC.md](./documentation/onboarding/03-DATA-AND-SYNC.md). |
| iNaturalist / pipeline endpoints 404 | They are feature-flagged off by default — see [Feature Flags](#feature-flags). |
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

All documentation lives under [`documentation/`](./documentation), split into three folders.

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
| [UI Components](./documentation/resources/ui-components.md) | Shared frontend design-system primitives |
| [Testing with Seed Users](./documentation/resources/testing-with-seed-users.md) | Role-based test users and validation |

### Development Reports (`documentation/development reports/`)

Point-in-time design docs, roadmaps, research spikes and audits — e.g.
[annotation-pipeline-review.md](./documentation/development%20reports/annotation-pipeline-review.md),
[inaturalist-integration.md](./documentation/development%20reports/inaturalist-integration.md),
[ui-redesign-roadmap.md](./documentation/development%20reports/ui-redesign-roadmap.md),
[v4-implementation-plan.md](./documentation/development%20reports/v4-implementation-plan.md).
These capture *why* decisions were made; they are not kept current with the code.

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
