# 03 — Data, Supabase & the Job System

How the web app reads and writes data, the security model it operates under, and how long-running
work is run as background jobs.

## Two paths to data

1. **Direct Supabase (most reads + observation writes).** The browser holds a Supabase session
   (anon key + the user's JWT → the **`authenticated`** Postgres role) and queries tables directly
   with `supabase.from('…')`. Row-Level Security (RLS) scopes every row to the user's projects.
2. **Backend API (privileged / heavy work).** EXIF parsing, Drive uploads, model conversion, the AI
   pipeline, LoRaWAN ingestion, and admin-only RPCs go through FastAPI, which uses the
   **service-role** key (bypasses RLS) where appropriate.

## The RLS + GRANT model (read this before debugging "permission denied")

Postgres checks permissions in **two layers, in order**:

1. **Table privileges (`GRANT`)** — failing this gives `permission denied for table <name>`.
2. **Row-Level Security policies** — failing this gives `new row violates row-level security policy`.

A table-level `GRANT` must exist **before** RLS policies are even consulted. A common failure mode:
a table has RLS policies for `INSERT`/`UPDATE` but only `GRANT SELECT … TO authenticated`, so writes
fail with *permission denied for table* even though the policy would have allowed the row.

> [!CAUTION]
> The schema, RLS policies, **and** table GRANTs are owned by the [`ww-backend`](https://github.com/wildlifeai/wildlife-watcher-backend)
> repo. The web app never alters them. To enable a new client-side write, add a `ww-backend`
> migration that grants the privilege to `authenticated` **and** a matching RLS policy.
> Example (observations): `GRANT INSERT, UPDATE ON public.observations TO authenticated;` plus a
> `FOR UPDATE … project_member` policy so reviewers — not just admins — can confirm/correct labels.

`has_project_role(uid, project, role)` is **hierarchical**: `project_admin` satisfies a
`project_member` check. Use `project_member` in policies for actions reviewers should perform.

## Core tables the web touches

| Table | Used by | Access |
|-------|---------|--------|
| `projects`, `deployments` | Results, EXIF matching, Drive folders | RLS (+ service-role) |
| `media` | Annotations grid + modal | RLS (read; uploads via backend) |
| `observations` | Annotations modal (confirm/correct/blank/box/add) | RLS — `authenticated` needs INSERT/UPDATE GRANT |
| `taxa` | SpeciesPicker (local search) | RLS read |
| `user_roles` | membership / `has_project_role` | RLS + `get_organisation_users` RPC |
| `media_embeddings`, `embedding_runs`, `annotation_runs` | Wildlife Brain / provenance | service-role |
| `devices`, `lorawan_*`, `firmware`, `ai_models`, `api_jobs` | LoRaWAN, manifests, models, jobs | service-role |

Observation provenance fields (`source_type`, `review_status`, `reviewer_id`, `annotator_id`,
`classification_method`) are written through one helper, `frontend/src/lib/observations.ts`, so
every surface records review state consistently. See [05-ANNOTATION-WORKFLOW](./05-ANNOTATION-WORKFLOW.md).

## Frontend ⇄ backend env mapping

`frontend/vite.config.ts` loads the **root** `.env` and exposes a subset to the browser:

| Root `.env` | Frontend `import.meta.env` |
|-------------|----------------------------|
| `SUPABASE_URL` | `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY` |
| `VITE_API_BASE_URL` | `VITE_API_BASE_URL` |

The **service-role key is never exposed to the browser** — it stays in the backend.

## Async job system

Heavy tasks (Drive uploads, model conversion, pipeline runs) run as **in-process `asyncio`
background tasks** — no Redis required for local dev. Container deploys can switch to ARQ + Redis
via `jobs/worker.py`.

```
create_job() → queued → processing → completed
                              └────────→ completed_with_errors | failed
```

| Status | Meaning |
|--------|---------|
| `queued` | created, waiting for the runner |
| `processing` | actively executing |
| `completed` | success — result available |
| `completed_with_errors` | partial success (some files failed) |
| `failed` | error — details in `error` |

- **Persistence**: in-memory dict (fast path) + async sync to the Supabase `api_jobs` table (durable).
- **Crash recovery**: on boot, any `processing` jobs in Supabase are marked `failed`.
- **Frontend**: polls `GET /api/jobs/{id}` (~2s); responses carry ordered `events[]` for incremental
  UI updates. The global `UploadContext` keeps progress alive across navigation via `ProgressDock`.

## Supabase resources expected

- **Storage buckets**: `firmware`, `ai-models` (private).
- **Auth providers**: GitHub + Google OAuth.
- **Realtime**: enable on `lorawan_parsed_messages` for live mobile updates.
