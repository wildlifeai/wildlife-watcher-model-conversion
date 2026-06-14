# Documentation Index

Every doc in this repo, with its purpose and currency. **Living** docs track the code; **specs** are
active engineering hand-offs; **archive** is frozen history. Start with onboarding `00`.

## Onboarding — living, read in order

| Doc | Covers |
|-----|--------|
| [00-GETTING-STARTED](onboarding/00-GETTING-STARTED.md) | Local setup, env reference, run both services, verification checklist |
| [01-TECHNOLOGY-STACK](onboarding/01-TECHNOLOGY-STACK.md) | Every dependency + external service (Supabase, Cloudflare, Azure, Drive, Qdrant, iNat) + feature flags |
| [02-CODEBASE-GUIDE](onboarding/02-CODEBASE-GUIDE.md) | Repo layout, frontend nav/routes, backend router→domain→service layering |
| [03-DATA-AND-SYNC](onboarding/03-DATA-AND-SYNC.md) | Supabase, the RLS + GRANT model, async job system, the image-upload pipeline |
| [04-AI-PIPELINE](onboarding/04-AI-PIPELINE.md) | SpeciesNet detect→crop→classify, dedup + taxonomic roll-up, blank handling, DINOv3 Wildlife Brain |
| [05-ANNOTATION-WORKFLOW](onboarding/05-ANNOTATION-WORKFLOW.md) | Annotations grid, ribbon, full-screen labeling modal, review provenance |

## Reference guides — living

| Doc | Covers |
|-----|--------|
| [api-reference](resources/api-reference.md) | Backend `/api/*` endpoint reference |
| [deployment-guide](resources/deployment-guide.md) | Dev/prod environments, Azure + Cloudflare, CI/CD, Qdrant gap, security checklist |
| [ai-model-pipeline](resources/ai-model-pipeline.md) | Edge Impulse → Vela on-camera model conversion |
| [camtrapdp-import](resources/camtrapdp-import.md) | Importing CamtrapDP packages |
| [lorawan-webhook-setup](resources/lorawan-webhook-setup.md) | TTN / Chirpstack network-server config |
| [ui-components](resources/ui-components.md) | Shared frontend design-system primitives |
| [testing-with-seed-users](resources/testing-with-seed-users.md) | Role-based seed users + access-control validation matrix |

## Active engineering specs — `development reports/`

Current hand-offs; kept up to date until the work ships, then moved to `_archive/`.

| Spec | For | Covers |
|------|-----|--------|
| [bmp-ingestion-analysis](development%20reports/bmp-ingestion-analysis.md) | website + firmware | Raw-BMP ingest + in-pipeline JPEG re-compress; device capture behaviour; #1 same-frame dual-write |
| [dual-camera-rpi-analysis](development%20reports/dual-camera-rpi-analysis.md) | firmware/hardware | HM0360 (night/IR) ↔ Raspberry Pi (day/colour) camera swap + dual-write interaction |
| [exif-telemetry-firmware-spec](development%20reports/exif-telemetry-firmware-spec.md) | firmware | Add temperature/battery to EXIF via UserComment (smallest change) |
| [access-test-seed-spec](development%20reports/access-test-seed-spec.md) | ww-backend | Seed rows for the access-scenario upload fixtures (valid / no-access / not-found) |
| [inaturalist-integration](development%20reports/inaturalist-integration.md) | website | iNaturalist publish + community-ID sync integration |

## Archive — `development reports/_archive/` (frozen history)

Point-in-time plans, roadmaps, research spikes and audits. They capture *why* decisions were made and
are **not** kept current with the code.

| Doc | What it was |
|-----|-------------|
| [v2-architecture-plan](development%20reports/_archive/v2-architecture-plan.md) | The v2 architecture & execution plan (superseded by v4) |
| [v4-implementation-plan](development%20reports/_archive/v4-implementation-plan.md) · [v4-ui-roadmap](development%20reports/_archive/v4-ui-roadmap.md) · [v4-cost-model](development%20reports/_archive/v4-cost-model.md) | v4 planning set |
| [ui-redesign-roadmap](development%20reports/_archive/ui-redesign-roadmap.md) · [ui-navigation-roadmap](development%20reports/_archive/ui-navigation-roadmap.md) · [ui-personas-redesign-report](development%20reports/_archive/ui-personas-redesign-report.md) | UI redesign history (the 3-tab nav, status badges, Vega migration) |
| [viz-package-research-spike](development%20reports/_archive/viz-package-research-spike.md) | Charting library decision (resolved → Vega-Lite) |
| [annotation-pipeline-review](development%20reports/_archive/annotation-pipeline-review.md) | Point-in-time review of the annotation pipeline |
| [be-3-chart-specs-persistence](development%20reports/_archive/be-3-chart-specs-persistence.md) | Chart-spec persistence design note |
| [site-map](development%20reports/_archive/site-map.md) | Old site map (pre-Toolkit/Insights nav) |
| [gecko_monitoring_storyboard](development%20reports/_archive/gecko_monitoring_storyboard.md) | UX storyboard |

## Conventions

- **Living docs** (onboarding + resources) describe **current behaviour** and must be updated with the
  code. Nav/page names come from `App.tsx` `USER_TABS` — renaming a tab should trigger a doc grep for
  the old name.
- **Specs** (development reports, top level) are dated active hand-offs. When the work ships, drop a
  `🕰️ Historical snapshot` status banner and move the file into `_archive/`.
- Every development report carries a one-line **`> **Status:**`** banner under its title so currency is
  visible at a glance.
- The schema, RLS, and table GRANTs are owned by [`ww-backend`](https://github.com/wildlifeai/wildlife-watcher-backend) — never documented here as editable.
