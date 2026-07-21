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
via `jobs/worker.py`. When no Redis is reachable, enqueue logs
`redis connection error … arq_enqueue_failed_fallback_local` and the job falls back to the
in-process runner — expected noise in local dev, not a failure.

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

## Image upload pipeline

Dragging camera images into the website (Upload Data page → `AnalyseImages`, or the global Upload
modal) runs this end-to-end. **Images always sync to Google Drive** — the old "Sync to Google Drive"
toggle was removed; Drive is the default long-term store.

```
POST /api/exif/parse  → parse EXIF, match deployment (EXIF Deployment_ID → UserComment → GPS),
                        buffer bytes to Azure blob store, enqueue upload_drive_images_job
upload_drive_images_job:
  DOWNLOAD → PREPROCESS (rename/sort into project/deployment folders)
  → DRIVE_UPLOAD     google_drive.upload_analysis_images — hash-dedup skips files already in Drive
  → REGISTER MEDIA   insert `media` rows (file_path = gdrive://<id>, file_hash) so images appear in
                      the Annotations grid and the pipeline has something to run on
                      (EXIF timestamps are normalised "YYYY:MM:DD HH:MM:SS" → ISO before insert —
                       raw EXIF is rejected by Postgres and would silently create 0 media rows)
  → AUTO-ANNOTATE    enqueue auto_annotate_deployments (the AI pipeline, async) — see 04-AI-PIPELINE
  → CLEANUP          delete the Azure blobs; job completes
```

**Idempotency guards** (so re-uploads / partial uploads are safe):
- **Guard 1 — media dedup + self-heal:** Drive upload hashes content (`appProperties.sha256`) and
  skips duplicates, returning the *existing* file id. Media registration then dedups by
  `media.file_hash` **or** `gdrive://` path (no duplicate rows), and **back-fills a `media` row for
  any image that's in Drive but has no DB row yet** — so re-uploading recovers stranded images.
- **Guard 2 — annotate only un-annotated media:** the auto-trigger runs `only_unannotated=true`, so
  it processes only images without an AI observation (see [04-AI-PIPELINE](./04-AI-PIPELINE.md)).

> **Local dev gotcha:** the Drive credential file is mounted by the **dev** compose, so always start
> the API with both files: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`.
> Starting with only the base compose drops the mount and the upload job fails to authenticate.

## Timezones & capture time

Camera EXIF timestamps are **UTC**, and `media.timestamp` (a `timestamptz`) stores that exact UTC
instant — never local wall-clock. To show users "the time where the photo was taken", we format that
instant in the **deployment's** timezone at display time.

- **`deployments.timezone`** — an IANA zone name (e.g. `Pacific/Auckland`), owned by the `ww-backend`
  schema (display-only; `media.timestamp` stays UTC). It is **app-populated** (no DB trigger):
  `resolve_timezone(lat, lon)` in [`domain/photo_preprocessing.py`](../../backend/app/domain/photo_preprocessing.py)
  derives it from the deployment's GPS via `timezonefinder`. CamtrapDP import sets it automatically;
  existing/device deployments are filled by `POST /api/deployments/backfill-timezones` (idempotent).
- **Display** — [`frontend/src/lib/time.ts`](../../frontend/src/lib/time.ts) (`formatCaptureTime`,
  `getTimeOfDay`, `hourInTimezone`) renders the UTC instant in the deployment zone (with a label like
  `10:44 am NZST`) and drives the day/night filter. **Store the IANA name, not a fixed offset**, so DST
  is handled automatically (NZ is +12 in winter, +13 in summer).
- **Graceful fallback** — when `timezone` is `NULL` (or the column isn't deployed yet) the UI falls
  back to the **viewer's browser** zone, i.e. the previous behaviour. Deployment queries fetch the
  column defensively (retry without it) so the app keeps working during the schema rollout.

> **Why not store local time in the DB?** A `timestamptz` is an absolute instant; putting local
> wall-clock in it loses the instant, breaks cross-deployment sorting, mishandles DST, and corrupts
> CamtrapDP / Darwin Core export. One source of truth (UTC) + a per-deployment zone is the correct model.

## Supabase resources expected

- **Storage buckets**: `firmware`, `ai-models` (private); `media-renditions` (public — thumbnails/previews, see [04-AI-PIPELINE](./04-AI-PIPELINE.md)).
- **Auth providers**: GitHub + Google OAuth.
- **Realtime**: enable on `lorawan_parsed_messages` for live mobile updates.
