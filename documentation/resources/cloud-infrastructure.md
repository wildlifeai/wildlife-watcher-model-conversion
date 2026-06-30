# Cloud Infrastructure — Inventory & Maintenance

> **Status:** 🟢 Living — the authoritative map of every cloud resource the platform uses, what it's
> for, and how to keep it from drifting into sprawl. Pairs with [deployment-guide](deployment-guide.md)
> (*how to deploy*); this doc is *what exists and how to maintain it*. **Re-audit quarterly** (see the
> [review checklist](#periodic-review-checklist)). Last updated: **2026-06-30**.

> ### 🚧 Migration in progress (2026-06-30): consolidating to **one RG in AU East**
> The org runs **nothing else in Azure**, so the entire stack is being rebuilt clean in a single resource
> group **`WW-AE`** (`australiaeast`); **everything outside `WW-AE` is being deleted** (the old
> `WW-Website` RG and the auto-created `DefaultResourceGroup-*` RGs). Rows below are tagged
> ✅ done / 🔄 in progress / ⏳ pending. Remove this banner + the [decommissioning](#decommissioning-being-deleted)
> section once teardown is complete and only `WW-AE` remains.

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
⚠️ **Sponsorship subs have no GPU quota** (no NCasT4_v3 SKUs in any region) — GPU work needs a separate
PAYG sub (see [gpu-worker-infra-spec](../development%20reports/gpu-worker-infra-spec.md)). The env is
created **workload-profiles-enabled** so a GPU profile can be added later without recreating it.

**Convention:** **everything** lives in **one resource group, `WW-AE`**, in **Australia East**. There is
no other RG. Do not let tooling auto-create resource groups (`DefaultResourceGroup-*`), other regions, or
extra Log Analytics workspaces — that is the main source of sprawl and cost confusion.

### Resources (`WW-AE` RG, `australiaeast`)

| Resource | Type | Purpose | Status | Maintenance |
|----------|------|---------|--------|-------------|
| `ww-env` | Container Apps **environment** | Hosts all container apps; workload-profiles (Consumption profile); KEDA. | ✅ | Region-locked — recreating it means recreating its apps. |
| `wwregistry` | Container Registry (ACR) | Image repos `ww-backend` (api, `--target api`) + `ww-backend-worker` (worker). | ✅ | Standard SKU, admin-enabled; `az acr build` builds in-cloud (no local Docker). Login server `wwregistry.azurecr.io`. |
| `wwuploadsae` | Storage account | **Azure Blob** temporary upload buffer (deleted after Drive archival). | ✅ | Connection string is an ACA secret on the apps. |
| `ww-redis-dev` | Container App | **ARQ broker** (internal `redis:7-alpine`, TCP, `exposedPort=6379`). | ✅ | Reach app-to-app via the **short name** `redis://ww-redis-dev:6379` (the `.internal.*` FQDN times out for TCP). **Not KEDA-reachable** — see the worker row. |
| `ww-backend-dev` | Container App | **Dev API** (`--target api`), min-1, external ingress. `REDIS_URL` → offloads jobs to the worker. FQDN `ww-backend-dev.bravesand-8bd2f1d4.australiaeast.azurecontainerapps.io`. | ✅ | Dev Supabase project; secrets as **ACA secrets**. |
| `ww-embedding-worker-dev` | Container App | **Dev ML worker** (`--target worker`, CPU). SpeciesNet detect + per-crop BioCLIP. | ✅ | Scales 0↔1 via **KEDA Postgres scaler on `api_jobs`** (see below). Secrets as ACA secrets. |
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

A pending job → `count ≥ 1` → KEDA scales the worker **0→1**; queue drains → back to **0**. The pooler
connection string lives in the ACA secret **`pg-conn`** (must point at the **dev** project's *shared
Transaction pooler* — `postgres.<ref>@aws-…pooler.supabase.com:6543`, using the **database password**,
not the service-role key). **Verified 2026-06-30: scales to 0 when idle.** If `pg-conn` is ever wrong/unset
the scaler errors and KEDA holds the worker at its current replica count (functional, just not scaling down).

### Decommissioning (being deleted)

Everything below is **outside `WW-AE`** and is being torn down once the new stack is verified — the org
runs nothing else in Azure. After teardown, **only `WW-AE` should remain**:

- **Entire `WW-Website` RG** — old env `ww-env` + apps (`ww-backend`, `ww-backend-dev`, `ww-redis-dev`,
  `ww-embedding-worker-dev`) in AU Southeast, old ACR `wildlifewatcher` + storage `wildlifewatcheruploads`
  (NZ North), the keeper + duplicate Log Analytics, the unused managed identity `wildlifewatcher`, **and**
  the orphaned Azure ML leftovers (`mlwebsite*`: 2 Key Vaults, 2 storage accounts, 2 App Insights, an
  action group + 2 alert rules — the ML workspace that owned them is already gone).
  ⚠️ Key Vaults soft-delete → **purge** after (`az keyvault purge`).
- **`DefaultResourceGroup-SEAU`, `-australiasoutheast`, `-australiaeast`** — auto-created Log Analytics
  RGs; delete whole.

### How to keep Azure clean
- **Audit:** `az resource list -o table` — every resource should be in `WW-AE` and map to a row above.
  Anything in another RG/region is sprawl.
- **Cost:** check **Cost Management → Cost analysis** monthly. The worker is the main variable cost — keep
  it near $0 by confirming KEDA returns it to **0 replicas when idle**.
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
