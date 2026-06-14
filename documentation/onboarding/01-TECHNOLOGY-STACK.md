# 01 — Technology Stack

The exact dependencies the web app runs on. Versions are the source of truth in
[`frontend/package.json`](../../frontend/package.json) and
[`backend/requirements.txt`](../../backend/requirements.txt); this guide explains the *why*.

## Frontend

| Area | Package | Version | Notes |
|------|---------|---------|-------|
| Framework | `react` / `react-dom` | 19.2 | Function components + hooks only |
| Build | `vite` | 8 | Dev server + `tsc -b && vite build` |
| Language | `typescript` | ~6.0 | `strict` mode; `tsc --noEmit` gate |
| Routing | `react-router-dom` | 7.14 | `useSearchParams`, `NavLink`, nested routes |
| Server state | `@tanstack/react-query` | 5 | All backend/API reads (`useQuery`/`useMutation`) |
| Auth/data | `@supabase/supabase-js` | 2 | Direct DB reads/writes (RLS-scoped) + Auth |
| Auth UI | `@supabase/auth-ui-react` | 0.4 | Login screen |
| Charts | `vega-embed` (Vega-Lite) | 7 | All charts — Recharts fully removed |
| Maps | `leaflet` + `react-leaflet` | 1.9 / 5 | Deployment maps |
| Icons / QR | `lucide-react`, `qrcode.react` | — | UI icons, app-store QR |
| Tooling | `eslint` 9, `typescript-eslint` 8, `husky` 9, `lint-staged` 16 | — | Lint + pre-commit |

**Conventions**: no Tailwind — components use inline `style={{}}` objects with CSS variables
(`--primary`, `--surface`, `--border`, `--radius`). Shared primitives live in
`src/components/ui/` (`Modal`, `Ribbon`, `DataTable`, `ControlBar`/`FilterSelect`, `StatusBadge`,
`VegaChart`).

## Backend

| Area | Package | Notes |
|------|---------|-------|
| Framework | `fastapi` + `uvicorn` | ASGI, async throughout |
| Runtime | Python 3.11+ | |
| Validation | `pydantic` (+ `pydantic-settings`) | request/response models + env validation |
| DB client | `supabase` (supabase-py) | service-role + per-request user clients |
| Jobs | in-process `asyncio` runner; `arq` worker settings | container deploys can use ARQ + Redis |
| Storage | `azure-storage-blob`, Google Drive API | temp buffer + permanent archive |
| HTTP | `httpx` + `tenacity` | retrying external calls |
| AI | SpeciesNet, DINOv3 (Wildlife Brain), `ethos-u-vela` | inference, embeddings, model conversion |
| Logging | `structlog` | structured JSON logs |
| Errors | `sentry-sdk` | optional, via `SENTRY_DSN` |
| Lint/test | `ruff`, `pytest` | `pyproject.toml` config (line length 100) |

## External services

| Service | Used for | Gate |
|---------|----------|------|
| **Supabase** | PostgreSQL + RLS, Auth, Storage (incl. the public `media-renditions` bucket), RPCs | always |
| **Cloudflare** | Frontend hosting (Pages, per-branch previews), DNS for `wildlifewatcher.ai`, CDN, anonymous web analytics | always (hosting) |
| **Azure** | Backend hosting (Container Apps + ACR); **Blob** = temporary image buffer during upload (deleted after Drive archival) | hosting; Blob with Drive uploads |
| **Google Drive** | Permanent image archive (`gdrive://` originals) | `GOOGLE_DRIVE_ENABLED` |
| **Qdrant** | Vector store for DINOv3 embeddings (Wildlife Brain similarity/clustering). Runs as a container in the local compose stack; **not yet provisioned in the cloud environments** — see [Deployment Guide](../resources/deployment-guide.md) | `FF_WILDLIFE_BRAIN_ENABLED` |
| **iNaturalist** | Taxa autocomplete + lineage registration, observation publishing + community-ID sync | `FF_INAT_ENABLED` |
| **TTN / Chirpstack** | LoRaWAN uplink webhooks | `FF_LORAWAN_WEBHOOKS_ENABLED` |
| **Sentry** | Error tracking | `SENTRY_DSN` |

## Feature flags

Toggle behaviour without code changes (defined in `backend/app/config.py`):

| Flag | Default | Controls |
|------|---------|----------|
| `FF_INAT_ENABLED` | `false` | iNaturalist endpoints |
| `FF_ML_ENABLED` | `false` | ML-assisted classification |
| `FF_CLUSTERING_ENABLED` | `false` | Image clustering endpoints |
| `FF_LORAWAN_WEBHOOKS_ENABLED` | `true` | LoRaWAN webhook ingestion |
| `FF_PUBLIC_API_ENABLED` | `false` | Public data API (`/api/v1/*`) |
| `FF_CAMTRAPDP_IMPORT_ENABLED` | `true` | CamtrapDP package import |
| `FF_PIPELINE_ENABLED` | `false` | AI pipeline inference endpoints |
| `FF_SPECIESNET_ENABLED` | `false` | SpeciesNet detector+classifier step |
| `FF_WILDLIFE_BRAIN_ENABLED` | `false` | DINOv3 embedding / clustering / similarity |
| `FF_MEDIA_REGISTRY_ENABLED` | `false` | Thumbnail/crop generation + resolve endpoints |
| `FF_ACTIVE_LEARNING_ENABLED` | `false` | Active-learning review queue + QA report |

> Always confirm the current set against `config.py` — flags are added as features land.
