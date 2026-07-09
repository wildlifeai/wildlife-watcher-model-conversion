# Deployment Guide

How to deploy the Wildlife Watcher V2 platform (backend + frontend) to production.

## Table of Contents

- [Environments](#environments)
- [Backend Deployment (Azure Container Apps)](#backend-deployment-azure-container-apps)
- [Frontend Deployment (Cloudflare Pages)](#frontend-deployment-cloudflare-pages)
- [Environment Variables](#environment-variables)
- [Supabase Setup](#supabase-setup)
- [CI/CD Pipeline](#cicd-pipeline)
- [Monitoring](#monitoring)
- [Scaling](#scaling)
- [Troubleshooting](#troubleshooting)

---

## Environments

| Component | Dev | Staging (current "prod") |
|-----------|-----|--------------------------|
| **Supabase** | `qegeovogqxiouqbrxmnh` (Dev_Wildlife_Watcher) | `nuhwmubvygxyddkycmpa` (Stag_Wildlife_Watcher) |
| **Azure Container App** | `ww-backend-dev` (WW-Website RG) | `ww-backend` (WW-Website RG) |
| **Azure Blob Container** | `wildlife-watcher-uploads-dev` | `wildlife-watcher-uploads` |
| **Frontend** | Cloudflare Pages preview deploys (per branch) | Cloudflare Pages (`ww-website.pages.dev` + `wildlifewatcher.ai`) |
| **Google Drive** | Dev subfolder under root folder | Root folder `1jIWV3OjSEnBK4Z64syHd2ugoRuXdVrK5` |

> **Seed data**: The dev Supabase project includes 17 test users (password: `test123`), 4 organisations, 5 projects, 9 devices, and 11 deployments. See `ww-backend/supabase/seeds/USER-CREDENTIALS-REFERENCE.md` for login details and `ww-backend/supabase/CLOUD_SEEDING.md` for the seeding workflow.

---

## Backend Deployment (Azure Container Apps)

The backend runs as a single containerised FastAPI application on **Azure Container Apps** (Consumption plan), deployed via **Azure Container Registry (ACR)**.

### Architecture

```
GitHub Actions (CI/CD)
  │
  ├── Build Docker image (backend/Dockerfile)
  ├── Push to Azure Container Registry (ACR)
  └── Update Azure Container App
        │
        ▼
Azure Container App ("ww-backend" or "ww-backend-dev")
  ├── FastAPI API Server (port 8000)
  ├── In-process async job runner (asyncio tasks)
  └── Supabase sync for job persistence (api_jobs table)
```

> **Note**: The target architecture adds a Redis-backed GPU worker as a separate, scale-to-zero container (always-on CPU API + on-demand GPU). Currently, jobs run in-process with in-memory state synced to Supabase. The dispatch seam, `worker` image, and ARQ registration are already in code; see [GPU Worker + Scale-to-Zero](#gpu-worker--scale-to-zero-redis--arq--keda) for the deployment spec.

### Manual Deployment

```bash
# 1. Build the Docker image
docker build -t <ACR_LOGIN_SERVER>/ww-backend:latest -f backend/Dockerfile backend/

# 2. Push to ACR
docker push <ACR_LOGIN_SERVER>/ww-backend:latest

# 3. Update the Container App
az containerapp update \
  --name ww-backend \
  --resource-group WW-Website \
  --image <ACR_LOGIN_SERVER>/ww-backend:latest
```

### Verify Deployment

```bash
# Get the FQDN
FQDN=$(az containerapp show \
  --name ww-backend \
  --resource-group WW-Website \
  --query "properties.configuration.ingress.fqdn" -o tsv)

# Health check
curl "https://${FQDN}/health"
# → {"status": "ok"}
```

---

## Frontend Deployment (Cloudflare Pages)

The frontend is a static React+Vite app deployed to **Cloudflare Pages** with automatic preview deployments per branch.

### Setup (One-Time)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Pages** → **Create a project** → **Connect to Git**
2. Select the `wildlifeai/ww-website` repository
3. Configure build settings:

   | Setting | Value |
   |---------|-------|
   | **Build command** | `cd frontend && npm install && npm run build` |
   | **Build output directory** | `frontend/dist` |
   | **Root directory** | `/` (repository root) |
   | **Node.js version** | `18` |

4. Set environment variables (in Cloudflare Pages settings):

   | Variable | Value |
   |----------|-------|
   | `SUPABASE_URL` | `https://nuhwmubvygxyddkycmpa.supabase.co` |
   | `SUPABASE_ANON_KEY` | _(from Supabase Dashboard)_ |
   | `VITE_API_BASE_URL` | `https://ww-backend.salmonsand-b067677e.australiasoutheast.azurecontainerapps.io` |

5. Assign custom domain: `wildlifewatcher.ai` (DNS is already on Cloudflare)

### Preview Deployments

Every push to a non-production branch creates a preview deployment at `https://<branch>.<project>.pages.dev`. This is automatic — no configuration needed.

---

## Environment Variables

See [00-GETTING-STARTED.md](../onboarding/00-GETTING-STARTED.md#environment-variables) for the complete variable reference.

**Critical production checklist:**

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set and kept secret
- [ ] `ALLOWED_ORIGINS` is set to your exact frontend domain(s)
- [ ] `LORAWAN_WEBHOOK_SECRET` is set (not empty)
- [ ] `SENTRY_DSN` is set for error tracking
- [ ] `LOG_LEVEL` is `info` (not `debug`)
- [ ] `RATE_LIMIT_PER_MINUTE` is appropriate for your traffic
- [ ] `AZURE_STORAGE_CONNECTION_STRING` is set for image buffering
- [ ] `GOOGLE_DRIVE_ENABLED` is set to `true` if Drive uploads are needed

### Azure Container App Environment Variables

Set environment variables on the Container App via Azure CLI:

```bash
az containerapp update \
  --name ww-backend \
  --resource-group WW-Website \
  --set-env-vars \
    SUPABASE_URL=<value> \
    SUPABASE_ANON_KEY=<value> \
    SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-key \
    ALLOWED_ORIGINS=https://wildlifewatcher.ai \
    LOG_LEVEL=info
```

> **Tip:** Use `secretref:` prefix for sensitive values. Create secrets first with `az containerapp secret set`.

### Full-pipeline config checklist (per subsystem)

A **fresh container only has the env you explicitly set** — feature flags and storage default to off/empty in code. `az containerapp update --set-env-vars` **merges** (it won't wipe existing vars), but a newly-created container needs the whole set below or the upload → store → AI → annotate flow silently no-ops. Each row maps a **symptom you'd see if it's missing** to the vars that fix it.

**Core (required to boot at all)**

| Var | Notes |
|-----|-------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | DB + auth. Service-role as `secretref:`. |
| `ALLOWED_ORIGINS` | Exact frontend origin(s). |
| `GENERAL_ORG_ID` | Default org for auto-assignment. |
| `REDIS_URL` | **ARQ job queue.** Empty → in-memory fallback (no durable/cross-container jobs). The **worker needs the same value.** |

**Original-image storage** — *missing → uploads "complete" but produce no usable media; `GET /api/media/:id/image` returns **422** ("cannot be resolved"):*

| Var | Enables |
|-----|---------|
| `AZURE_STORAGE_CONNECTION_STRING` (+ `AZURE_STORAGE_CONTAINER_NAME`) | Blob buffering of originals — **this is the one that bites.** The container *name* alone does nothing; without the **connection string** every upload logs `azure_storage_not_configured_for_store` and no media rows are created. |
| `SUPABASE_MEDIA_BUCKET` | Supabase Storage bucket for media. |
| `GOOGLE_DRIVE_ENABLED=true` + `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_DRIVE_FOLDER_ID` | Drive archival. **Folder ID alone does nothing** — without `ENABLED` + the service account, queued uploads stay `pending_drive_uploads` and the images never become servable. |

**AI pipeline** — *missing → "No animals detected"; no `speciesnet`/`pipeline` log lines:*

| Var | Enables |
|-----|---------|
| `FF_PIPELINE_ENABLED=true` | Inference endpoints. |
| `FF_SPECIESNET_ENABLED=true` (+ `SPECIESNET_RUN_MODE`) | SpeciesNet detector+classifier. **Runs in the ARQ worker, not the API image (`--target api`)** — confirm the worker container is deployed with the same flags + `REDIS_URL` + GPU. |
| `FF_MEDIA_REGISTRY_ENABLED=true` | Thumbnails / animal crops (the **Labels** view is empty without crops). |
| `FF_BIOCLIP_ENABLED`, `FF_WILDLIFE_BRAIN_ENABLED` (+ `HF_TOKEN`, `EMBEDDING_*`; the vector store is **pgvector** in Supabase — the legacy `QDRANT_*` vars apply only until the migration lands) | BioCLIP + DINOv3 embeddings / clustering. See [Vector Store](#vector-store--pgvector-supabase). |
| `FF_PER_CROP_CLASSIFY_ENABLED` | Per-detection (per-crop) species — one observation per animal, BioCLIP refines each crop. **Requires the GPU worker**; default off (collapses per image when off). |

**Demo account** — *missing → "Try the demo" self-disables (`DEMO_DISABLED`):*

| Var | Notes |
|-----|-------|
| `DEMO_EMAIL`, `DEMO_PASSWORD` | Must match the seeded demo user (`DEMO_PASSWORD` = dev `SEED_USER_PASSWORD`). See [demo-account.md](./demo-account.md). |

**Integrations (optional)**

| Var | Enables |
|-----|---------|
| `INAT_CLIENT_ID`, `INAT_CLIENT_SECRET`, `INAT_REDIRECT_URI` + `FF_INAT_ENABLED` | iNaturalist sync/publish. |
| `LORAWAN_*_WEBHOOK_SECRET` | LoRaWAN webhooks. |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` / `SENDGRID_API_KEY` / `ACS_CONNECTION_STRING` | Notification email. |
| `SENTRY_DSN`, `LOG_LEVEL` | Error tracking / log verbosity. |

> **Quick audit** of a container's current env:
> ```bash
> az containerapp show --name ww-backend-dev -g WW-Website \
>   --query "properties.template.containers[0].env[].name" -o tsv | sort
> ```
> If `GOOGLE_DRIVE_ENABLED`, `FF_PIPELINE_ENABLED`, `FF_SPECIESNET_ENABLED`, or `FF_MEDIA_REGISTRY_ENABLED` are absent, that subsystem is off regardless of what the UI seems to show.

---

## Supabase Setup

The backend expects these Supabase resources:

### Storage Buckets

| Bucket | Purpose | Public |
|--------|---------|--------|
| `firmware` | Config firmware, manifest results | Yes (mobile app downloads) |
| `ai-models` | AI model ZIPs | No (signed URLs) |

Create them in Supabase Dashboard → Storage → New Bucket.

### Database Tables

The backend reads/writes these tables (schema managed by `ww-backend` repo):

| Table | Used By | Access |
|-------|---------|--------|
| `devices` | LoRaWAN domain (device lookup by EUI) | RLS + service-role |
| `deployments` | LoRaWAN domain (active deployment match) | RLS + service-role |
| `ai_models` | Model domain (register/update) | RLS + service-role |
| `ai_model_families` | Model domain (family→firmware ID mapping) | RLS + service-role |
| `firmware` | Manifest domain (config firmware lookup) | RLS + service-role |
| `user_roles` | Dependencies (permission checks) | RLS + service-role |
| `lorawan_messages` | LoRaWAN domain (raw message store) | service-role only |
| `lorawan_parsed_messages` | LoRaWAN domain (parsed data store) | service-role only |
| `api_jobs` | Job system (status persistence + recovery) | service-role only |

### RPC Functions

| Function | Purpose |
|----------|---------|
| `check_user_uploader_role(p_user_id, p_org_id)` | Verifies user has upload permission |

### Realtime

Enable Realtime on `lorawan_parsed_messages` so the mobile app receives live updates:

1. Supabase Dashboard → Database → Replication
2. Enable `lorawan_parsed_messages` table for Realtime

---

## Vector Store — pgvector (Supabase)

The **Wildlife Brain** (DINOv3 embeddings → clustering → similarity search) needs a vector store, and
the **vector store is `pgvector` in the Supabase Postgres** we already run. Vectors live as a
`vector(1280)` column beside the relational data, so they inherit RLS + PITR backup and add **no new
vendor or ops surface**. At this project's scale (one DINOv3 vector per crop → hundreds of thousands,
low millions) pgvector's HNSW is comfortably sufficient, and embedding/cluster queries are
`deployment_id`/`project_id`-scoped (small candidate sets). If scale ever demands more, **pgvectorscale**
(StreamingDiskANN) lifts the ceiling *without leaving Postgres* — there is no plan to adopt a separate
vector database.

> **Migration in progress — the code still uses Qdrant.** The store is currently implemented against
> Qdrant (`backend/app/services/qdrant_client.py`, a local `docker-compose` container), which is **not
> provisioned in any cloud environment** — so Group-by-Cluster, similarity, and the review queue
> produce no cloud data yet. Qdrant is **being removed in favour of pgvector** (see below); until that
> lands, the client's `health()` degrades gracefully (never raises), so the API is unaffected.

**Implementing pgvector** (schema changes are owned by [`ww-backend`](https://github.com/wildlifeai/wildlife-watcher-backend)):
1. In `ww-backend`: enable the `vector` extension and add the vector column/table (`vector(1280)` +
   HNSW index) — e.g. store the vector on `media_embeddings` (which today only holds metadata + a
   `qdrant_point_id` pointer).
2. In `ww-website`: add a pgvector implementation behind the existing `get_qdrant_service()` seam
   (`embedding_runs` is store-agnostic), writing/reading vectors via `<=>` (cosine); then delete the
   Qdrant service, `QDRANT_*` config, the compose container, and `qdrant-client`.
3. Stamp each row with `embedding_model` and **filter on it at read time** (`WHERE embedding_model = $1`)
   so a model/weights change can't mix incompatible vectors. DR is automatic — the vectors are a
   Postgres table under Supabase PITR (the Qdrant-snapshot `/api/brain/backup` job is then obsolete).

> The heavy ML inference (DINOv3/SpeciesNet on GPU) is a separate concern — see the `gpu` profile +
> `embedding-worker` in `docker-compose.yml`, which also needs Redis + ARQ before it can run as a
> cloud worker (the API currently runs jobs in-process; see [Scaling](#scaling)).

---

## CI/CD Pipeline

### Backend: GitHub Actions → ACR → Azure Container App

The workflow `.github/workflows/deploy-backend.yml` triggers on pushes to `dev` and `main`:

| Branch | Target Container App | Image Tag |
|--------|---------------------|-----------|
| `dev` | `ww-backend-dev` | `dev-latest` + `<sha>` |
| `main` | `ww-backend` | `latest` + `<sha>` |

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `ACR_LOGIN_SERVER` | Azure Container Registry login server |
| `ACR_USERNAME` | ACR admin username |
| `ACR_PASSWORD` | ACR admin password |
| `AZURE_CREDENTIALS` | Azure service principal JSON (for `az login`) |
| `SUPABASE_URL` | Supabase project URL (for model deployment) |
| `SUPABASE_ANON_KEY` | Supabase anon key (for model deployment) |
| `GENERAL_ORG_ID` | `b0000000-0000-0000-0000-000000000001` |



---

## Monitoring

### Health Checks

The API exposes `/health` for automated monitoring:

```bash
# Simple check
curl -f https://<FQDN>/health || echo "API is down"

# Uptime monitoring services (UptimeRobot, Better Uptime, etc.)
# URL: https://<FQDN>/health
# Interval: 60 seconds
# Expected: 200 OK
```

### Structured Logging

All logs are JSON-formatted for easy ingestion into log aggregators:

```json
{
  "event": "request_complete",
  "method": "POST",
  "path": "/api/manifest/generate",
  "status_code": 200,
  "duration_ms": 42.3,
  "request_id": "a1b2c3d4-..."
}
```

### Azure Container App Logs

```bash
# View recent logs
az containerapp logs show \
  --name ww-backend \
  --resource-group WW-Website \
  --type console \
  --follow

# View system logs (crashes, restarts)
az containerapp logs show \
  --name ww-backend \
  --resource-group WW-Website \
  --type system
```

### Sentry

For error tracking, set `SENTRY_DSN` to your Sentry project DSN:

```
SENTRY_DSN=https://abc123@o456.ingest.sentry.io/789
```

This automatically captures:
- Unhandled exceptions
- Performance traces (10% sample rate)
- Request context (URL, method, headers)

---

## Scaling

### Azure Container Apps

| Setting | Dev | Staging/Prod |
|---------|-----|--------------|
| `min-replicas` | 0 (scale to zero) | 1 |
| `max-replicas` | 1 | 3 |
| CPU | 0.25 vCPU | 0.5 vCPU |
| Memory | 0.5 Gi | 1 Gi |

```bash
# Scale staging
az containerapp update \
  --name ww-backend \
  --resource-group WW-Website \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 0.5 \
  --memory 1.0Gi
```

### GPU Worker + Scale-to-Zero (Redis + ARQ + KEDA)

The two-container split — **always-on CPU API + on-demand GPU worker** — is already wired in code; this is the infra to light it up. The seam:

- [`dispatch.py`](../../backend/app/jobs/dispatch.py): `REDIS_URL` set → `enqueue_job` pushes to Redis and the worker runs the job; empty → in-process. The lean API image never imports torch/SpeciesNet.
- Dockerfile **`worker`** target bundles `requirements-ml.txt` (torch, transformers, hdbscan, umap, speciesnet); its CMD is `arq app.jobs.worker.WorkerSettings`.
- [`worker.py`](../../backend/app/jobs/worker.py) auto-registers every function in `definitions.JOBS` — including `annotate_deployments_job`, the offload target the upload flow enqueues when `REDIS_URL` is set.
- Job status is mirrored to Supabase `api_jobs`, so the API's `/api/jobs/{id}` polling works regardless of which process ran the job (cross-process by design).

| Component | Azure resource | Replicas | Rough cost |
|-----------|----------------|----------|-----------|
| API | Container App, CPU, **`base`** image | min 1 | ~$15–40/mo |
| Queue + status mirror | Azure Cache for Redis (Basic C0) | — | ~$16/mo |
| GPU worker | Container App on a **GPU workload profile**, **`worker`** image | **min 0** | GPU only while processing (per-second) |
| Vectors | **pgvector** in Supabase (chosen) — or Qdrant Cloud free tier | — | $0 |

**1 — Redis.** ARQ needs a broker; Azure Redis requires TLS on 6380, so use a `rediss://` DSN.

```bash
az redis create --name ww-redis-dev --resource-group WW-Website \
  --location australiaeast --sku Basic --vm-size c0
# REDIS_URL=rediss://:<primary-access-key>@ww-redis-dev.redis.cache.windows.net:6380
```

**2 — Point the API at Redis** (this alone flips `dispatch` from in-process to ARQ; uploads then offload their AI phase):

```bash
az containerapp update --name ww-backend-dev --resource-group WW-Website \
  --set-env-vars REDIS_URL=rediss://:<key>@ww-redis-dev.redis.cache.windows.net:6380
```

**3 — Build + push the GPU worker image** (the `worker` Dockerfile target):

```bash
docker build --target worker -t <ACR>/ww-backend-worker:latest -f backend/Dockerfile backend/
docker push <ACR>/ww-backend-worker:latest
```

**4 — Add a GPU workload profile** to the Container Apps environment (one-time; **request GPU quota in the region first** — profile types/regions vary). Consumption GPU profiles support scale-to-zero:

```bash
az containerapp env workload-profile add \
  --name <ACA_ENV> --resource-group WW-Website \
  --workload-profile-name gpu-t4 --workload-profile-type Consumption-GPU-NC8as-T4
```

**5 — Deploy the worker, scale-to-zero:**

```bash
az containerapp create \
  --name ww-embedding-worker-dev --resource-group WW-Website \
  --environment <ACA_ENV> \
  --image <ACR>/ww-backend-worker:latest \
  --workload-profile-name gpu-t4 \
  --command "arq" "app.jobs.worker.WorkerSettings" \
  --min-replicas 0 --max-replicas 2 \
  --env-vars REDIS_URL=rediss://:<key>@ww-redis-dev.redis.cache.windows.net:6380 \
             HF_TOKEN=<hf-token> EMBEDDING_DEVICE=cuda \
             SUPABASE_URL=<url> SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service>
```

> **Vector-store env:** the **pgvector** store needs none — it reuses the Supabase connection above.
> The `QDRANT_URL` / `QDRANT_API_KEY` vars are legacy (the code's current Qdrant implementation) and
> go away with the migration ([Vector Store](#vector-store--pgvector-supabase)).

**6 — Scale rule (the one real gotcha).** ARQ enqueues to a Redis **sorted set** (`arq:queue`), but KEDA's stock `redis` scaler reads **list length (`LLEN`)** — it cannot watch a sorted set directly. Pick one:

- **(Recommended, stays on ARQ) Mirror a pending-list marker — *implemented*.** On every offload, [`dispatch.enqueue_job`](../../backend/app/jobs/dispatch.py) `LPUSH`es the ARQ job id onto the `ww:gpu:pending` list, and the worker adapter ([`worker.py`](../../backend/app/jobs/worker.py)) `LREM`s that id when the job finishes. KEDA scales on the list length:
  ```bash
  az containerapp update --name ww-embedding-worker-dev --resource-group WW-Website \
    --scale-rule-name redis-queue --scale-rule-type redis \
    --scale-rule-metadata listName=ww:gpu:pending listLength=1 \
                          address=ww-redis-dev.redis.cache.windows.net:6380 enableTLS=true \
    --scale-rule-auth password=redis-password-secret
  ```
  Worker scales 0→1 when work is pending, back to 0 when drained. The marker is best-effort (a missing push only affects autoscaling, never correctness). The retry edge is already handled: `WorkerSettings.max_tries = 1`, so a job can't be re-deferred after its marker was removed (our jobs self-handle errors and return normally, so retries aren't wanted anyway).
- **(Cleaner cloud-native) Azure Service Bus / Storage Queue + KEDA `azure-queue` scaler.** Swap the offload broker from ARQ/Redis to an Azure queue at the `dispatch.py` seam; KEDA then scales natively on queue depth with no marker. Bigger change, no drift risk.
- **(Interim, zero code) KEDA `cron` scaler** to pre-warm the worker during expected upload windows, or pin `--min-replicas 1` during an active tagging campaign and back to `0` afterwards.

**7 — Model cache (cold start).** A GPU cold start pulls a multi-GB image and re-downloads DINOv3/SpeciesNet (~1–3 min). Mount an **Azure Files** volume on the worker and point the HF cache at it so models persist across scale-to-zero cycles:

```bash
# set on the worker: HF_HOME=/models/hf  (+ mount an Azure Files share at /models)
az containerapp update --name ww-embedding-worker-dev --resource-group WW-Website \
  --set-env-vars HF_HOME=/models/hf
```

### Verifying the split works

1. Trigger an AI run (upload, or `POST /api/brain/reprocess/deployment/{id}`). API logs should show **`job_enqueued_arq`** (not `job_enqueued_local`).
2. `az containerapp replica list --name ww-embedding-worker-dev -g WW-Website` shows the worker scaling **0 → 1**.
3. Worker logs show `arq_worker_startup` then `auto_embed_complete` with a cluster count.
4. Annotations → **Group → Cluster (embeddings)** populates; the worker scales back to **0** when idle.

> Status polling already works cross-process: `recover_stuck_jobs()` + the Supabase `api_jobs` mirror mean the API reports progress on jobs the worker ran. No extra wiring needed.

---

## Troubleshooting

### Common Issues

**App won't start: `ValidationError` on startup**

Missing required environment variables. Check that `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are set.

```bash
# Verify env vars are loaded
az containerapp show \
  --name ww-backend \
  --resource-group WW-Website \
  --query "properties.template.containers[0].env"
```

**Jobs stuck in `queued` status**

Jobs run in-process as asyncio background tasks. If the container restarts mid-job, the job store's `recover_stuck_jobs()` function marks interrupted jobs as `failed` on next boot. Check container restart logs:

```bash
az containerapp logs show \
  --name ww-backend \
  --resource-group WW-Website \
  --type system
```

**Model conversion fails: "Vela command not found"**

The `ethos-u-vela` package needs to be installed in the container. Verify it's in `requirements.txt` and the Docker image was rebuilt.

**Rate limiting is too aggressive**

Increase the limit via environment variable:

```
RATE_LIMIT_PER_MINUTE=120
```

**CORS errors from frontend**

Add your frontend origin to `ALLOWED_ORIGINS`:

```
ALLOWED_ORIGINS=https://wildlifewatcher.ai,http://localhost:5173
```

**LoRaWAN webhooks returning 401**

Webhook secret mismatch. Verify the secret matches between your network server and `LORAWAN_TTN_WEBHOOK_SECRET` / `LORAWAN_CHIRPSTACK_WEBHOOK_SECRET`.
