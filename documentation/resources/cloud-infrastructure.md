# Cloud Infrastructure — Inventory & Maintenance

> **Status:** 🟢 Living — the authoritative map of every cloud resource the platform uses, what it's
> for, and how to keep it from drifting into sprawl. Pairs with [deployment-guide](deployment-guide.md)
> (*how to deploy*); this doc is *what exists and how to maintain it*. **Re-audit quarterly** (see the
> [review checklist](#periodic-review-checklist)). Last updated: **2026-06-30**.

> ### ✅ Single-RG AU East (migration complete — 2026-06-30)
> The org runs **only the `WW-AE` resource group** (`australiaeast`). The old `WW-Website` RG and the three
> `DefaultResourceGroup-*` RGs (plus all `mlwebsite*` Azure ML orphans) were **deleted on 2026-06-30** —
> `az group list` should return **only `WW-AE`**. If another RG ever appears, it's sprawl: investigate.
> *(One unrelated soft-deleted vault, `secrets-staging` in `newzealandnorth`, was intentionally left alone —
> decide separately whether to recover or purge it.)*

The platform spans four providers. Keep this list complete — an unlisted resource is either undocumented
or orphaned, and both are bugs.

| Provider | What it hosts |
|----------|---------------|
| **Azure** | Backend API + ARQ worker (Container Apps), container registry, upload blob buffer, Redis broker, logs |
| **Supabase** | Postgres + RLS, Auth, Storage (renditions), the system of record — **two projects** (dev / prod) |
| **Cloudflare** | Frontend (Pages + per-branch previews), DNS for `wildlifewatcher.ai`, CDN |
| **Google Drive** | Permanent original-image archive (`gdrive://`) |

---

## Azure

**Subscription:** `Microsoft Azure Sponsorship` (`f14bd966-e052-4c53-b26c-459dc764c33c`).
✅ **GPU is live (2026-07-03).** The ML worker runs on a **serverless T4 GPU** — a
`Consumption-GPU-NC8as-T4` workload profile named **`gpu-t4`** on `ww-env`, with the worker on `cuda`
and **scale-to-zero** (idle cost ≈ $0). This works on the sponsorship sub: ACA *serverless* GPU did not
require the `NCasv3_T4` VM-family quota we'd assumed was blocking it. See the worker row + scaling note.

**Convention:** **everything** lives in **one resource group, `WW-AE`**, in **Australia East**. There is
no other RG. Do not let tooling auto-create resource groups (`DefaultResourceGroup-*`), other regions, or
extra Log Analytics workspaces — that is the main source of sprawl and cost confusion.

### Resources (`WW-AE` RG, `australiaeast`)

| Resource | Type | Purpose | Status | Maintenance |
|----------|------|---------|--------|-------------|
| `ww-env` | Container Apps **environment** | Hosts all container apps; workload profiles **`Consumption`** (CPU apps) + **`gpu-t4`** (`Consumption-GPU-NC8as-T4`, serverless T4 for the worker); KEDA. | ✅ | Region-locked — recreating it means recreating its apps. GPU profile: `az containerapp env workload-profile list -g WW-AE -n ww-env`. |
| `wwregistry` | Container Registry (ACR) | Image repos `ww-backend` (api, `--target api`) + `ww-backend-worker` (worker). | ✅ | Standard SKU, admin-enabled; `az acr build` builds in-cloud (no local Docker). Login server `wwregistry.azurecr.io`. |
| `wwuploadsae` | Storage account | **Azure Blob** temporary upload buffer (deleted after Drive archival). | ✅ | Connection string is an ACA secret on the apps. |
| `ww-redis-dev` | Container App | **ARQ broker** (internal `redis:7-alpine`, TCP, `exposedPort=6379`). | ✅ | Reach app-to-app via the **short name** `redis://ww-redis-dev:6379` (the `.internal.*` FQDN times out for TCP). **Not KEDA-reachable** — see the worker row. |
| `ww-backend-dev` | Container App | **Dev API** (`--target api`), min-1, external ingress. `REDIS_URL` → offloads jobs to the worker. FQDN `ww-backend-dev.bravesand-8bd2f1d4.australiaeast.azurecontainerapps.io`. | ✅ | Dev Supabase project; secrets as **ACA secrets**. |
| `ww-embedding-worker-dev` | Container App | **Dev ML worker** (`--target worker`) on the **`gpu-t4` serverless T4 GPU** profile. SpeciesNet detect + per-crop BioCLIP (+ DINOv3 when the Brain is on). ~1–2 s/image vs ~30–50 s on CPU. | ✅ | `EMBEDDING_DEVICE=cuda` / `BIOCLIP_DEVICE=cuda` (SpeciesNet auto-detects CUDA). Scales **0↔1** via **KEDA Postgres scaler on `api_jobs`** (see below). Secrets as ACA secrets. |
| `ww-backend` | Container App | **Prod API** (`--target api`). FQDN `ww-backend.bravesand-8bd2f1d4.australiaeast.azurecontainerapps.io`. Currently unused. | ✅ | Prod Supabase project. |
| Log Analytics workspace | Log Analytics | Container Apps logs (auto-created with the env). | ✅ | Keep exactly one. |

**Worker scaling (the one subtlety).** The ARQ broker is an internal Redis container — fine for
**app-to-app** (worker/API reach it by short name) but **the ACA KEDA operator cannot reach it**
(`connection refused` to the pod). So the worker does **not** scale on Redis. Instead a **KEDA
PostgreSQL scaler** queries the dev Supabase `api_jobs` table (reachable over IPv4 via the shared pooler):

```
SELECT count(*) FROM api_jobs WHERE status IN ('queued','processing')
  AND updated_at > now() - interval '1 hour'      -- targetQueryValue=1
```

A pending job → `count ≥ 1` → KEDA scales the worker **0→1** (on the GPU node); queue drains → back to
**0**. The pooler connection string lives in the ACA secret **`pg-conn`** (must point at the **dev**
project's *shared Transaction pooler* — `postgres.<ref>@aws-…pooler.supabase.com:6543`, using the
**database password**, not the service-role key). **Verified 2026-07-03: scales to 0 when idle** (GPU T4,
so idle cost ≈ $0). If `pg-conn` is wrong/unset the scaler errors and KEDA holds the worker at its current
replica count (functional, just not scaling down).

> ⚠️ **Gotcha — never set the scale rule via `az containerapp update --scale-rule-metadata`.** The CLI
> silently drops metadata values containing spaces/quotes (i.e. the SQL), leaving `query`/`targetQueryValue`
> **empty**. With `min=0` an empty query means KEDA never wakes the worker → **uploads queue but AI never
> runs.** Edit the rule in the **Portal** (Container App → *Scale and replicas* → `pg-pending` rule) or via a
> full `--yaml` manifest. Confirm with:
> `az containerapp show -n ww-embedding-worker-dev -g WW-AE --query "properties.template.scale.rules[0].custom.metadata"`.

**GPU verification / readiness.** Confirm the worker actually has the GPU with
`az containerapp exec -n ww-embedding-worker-dev -g WW-AE --command "python -c \"import torch;print(torch.cuda.is_available())\""`
(→ `True`). Pipeline code is GPU-ready: BioCLIP/DINOv3 read `BIOCLIP_DEVICE`/`EMBEDDING_DEVICE`
(`services/bioclip_service.py`, `services/dinov3.py`); SpeciesNet passes no device and auto-detects CUDA.
The `ww-backend-worker:dev-latest` image already ships CUDA-enabled torch.

### How to keep Azure clean
- **Audit:** `az resource list -o table` — every resource should be in `WW-AE` and map to a row above.
  Anything in another RG/region is sprawl.
- **Cost:** check **Cost Management → Cost analysis** monthly. The **GPU worker** is now the main variable
  cost — a T4 billed per-second **while running**. Keep it near $0 by confirming KEDA returns it to
  **0 replicas when idle** (`az containerapp replica list -n ww-embedding-worker-dev -g WW-AE -o table`
  → empty). A worker stuck at ≥1 replica is an idle T4 burning money — investigate the scaler.
- **Don't** create resources outside `WW-AE` / AU East without adding them here.

---

## Supabase

**Two projects** (do not cross the wires — the dev backend, worker, and KEDA scaler must all point at the
*same* project):

| Project ref | Environment | Used by |
|-------------|-------------|---------|
| `qegeovogqxiouqbrxmnh` | **dev** | `ww-backend-dev`, `ww-embedding-worker-dev`, the KEDA `pg-conn` scaler |
| `nuhwmubvygxyddkycmpa` | **prod / staging** | `ww-backend` |

Each holds Postgres (+ RLS, the access model), Auth (GoTrue), and Storage (public `media-renditions`
bucket). Schema is owned by [`ww-backend`](https://github.com/wildlifeai/wildlife-watcher-backend)
(`db:change` workflow). **Dev DB resets every deploy; staging/prod persists.** The chosen cloud vector
store is **pgvector in these projects** (see deployment-guide → Vector Store).

**Connection strings:** for tools that connect directly to Postgres (e.g. the KEDA scaler), use the
**shared Transaction pooler** (`...pooler.supabase.com:6543`) — it accepts **IPv4 by default, no Pro
add-on needed**. The direct `db.*:5432` host and the *dedicated* pooler are IPv6-only (KEDA on Azure
can't reach them). Treat the DB password as a secret (ACA secret / vault, never in chat).

---

## Cloudflare

- **Pages** project hosts the React frontend with **per-branch previews** (`*.ww-website.pages.dev`;
  `dev.ww-website.pages.dev` is the dev preview).
- **DNS** for `wildlifewatcher.ai`; CDN + anonymous web analytics.
- Maintenance: deploys are git-driven (Pages build on push); no servers to patch. **After the AU East
  migration, the frontend's backend API URL + the API's CORS allow-list must point at the new
  `ww-backend-dev` / `ww-backend` FQDNs.**

## Google Drive

- Service account (`ww-drive-uploader@...`) archives originals to a canonical folder structure under a
  root folder ID. Credentials are a service-account JSON (an ACA secret on the backend/worker).

---

## Periodic review checklist

Run quarterly (or before a cost review):

- [ ] `az resource list -o table` — **every** resource is in `WW-AE`; no other RGs/regions exist.
- [ ] No new `DefaultResourceGroup-*` appeared.
- [ ] Exactly one Log Analytics workspace.
- [ ] Worker (`ww-embedding-worker-dev`) returns to **0 replicas when idle** (KEDA `pg-conn` working) —
      else it's silently billing always-on.
- [ ] Container Apps `min/max-replicas` match intent (API min-1; worker min-0 + KEDA).
- [ ] ACR repo tags aren't accumulating unbounded (`az acr repository show-tags`).
- [ ] Secrets are ACA secrets, not plaintext env (the legacy dev app stored Supabase/Azure/Google
      secrets as plaintext — the rebuilt apps use ACA secrets; rotate any exposed keys).
- [ ] Cost Management has no surprise line items.

## Naming conventions

- Container apps: `ww-<role>[-dev]` (`ww-backend`, `ww-backend-dev`, `ww-embedding-worker-dev`, `ww-redis-dev`).
- ACR: `wwregistry` (`wwregistry.azurecr.io`); repos `ww-backend` (api) + `ww-backend-worker` (worker); tags `dev-latest` / `latest` / `<sha>`.
- Storage: `wwuploadsae`. One resource group (`WW-AE`), one region (**Australia East**) for everything.
