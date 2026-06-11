# UI Navigation Roadmap — Toolkit · (Field) · Annotations · Insights

*Implementation roadmap (June 2026) for the chosen navigation redesign. Direction was selected
from the variants analysed in
[ui-personas-redesign-report.md](./ui-personas-redesign-report.md).*

---

## 1. Target design

### Header

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Wildlife Watcher [🗂 Projects ▾]  🧰 Toolkit · 📡 Field · 🏷 Annotations · 📈 Insights   │
│                                                              [⬆ Upload]  [🔔• avatar ▾] │
└────────────────────────────────────────────────────────────────────────────────────────┘
   ▲ project selector moves          ▲ Field tab renders ONLY when        ▲ unread badge
     next to the logo                  the user can access ≥1 project       on the avatar
                                       with an ACTIVE deployment
                                                       avatar menu: 🔔 Notifications · ⚙ Settings · ↪ Log out
```

### Rules

1. **Three pages for everyone:** Toolkit, Annotations, Insights (in that order, Toolkit first —
   lifecycle order: prepare → collect → analyse).
2. **Field is conditional:** inserted between Toolkit and Annotations **only if** the user has
   access to a project with at least one *active* deployment (status `started` / no
   `deployment_end`). First-time users see a clean 3-tab UI; field teams get the monitoring
   surface automatically.
3. **Avatar = personal surface:** unread-notification badge on the icon; dropdown gains
   **Notifications** and **Settings** entries above **Log out**.
4. **Project selector** sits directly right of the "Wildlife Watcher" logo (it scopes
   everything to its right, so it reads left-to-right as "*in these projects → these views*").

### Where today's content lands

| Today | Lands in |
|---|---|
| ⚙ Other (SD prep, firmware, AI models, iNat connect, R export, GBIF) | 🧰 **Toolkit** (grouped: Camera prep · AI models · Integrations · Exports) |
| 📊 Results ▸ Reports (KPIs, ChartBuilder) | 📈 **Insights** (default tab) |
| 📊 Results ▸ Deployments (table + per-deployment analysis links) | 📈 **Insights** ▸ Deployments |
| 📊 Results ▸ Map | 📡 **Field** (markers coloured by heartbeat freshness) |
| 📊 Results ▸ Projects (table, create, members) | ⚙ **Settings** ▸ Projects |
| 🏷️ Annotations | 🏷 **Annotations** (unchanged) |
| — (new) | 🔔 **Notifications** page + avatar badge |
| Header: `[Project ▾] [account ▾] [⬆ Upload]` (right side) | `[Project ▾]` → left next to logo; right side: `[⬆ Upload] [avatar ▾]` |

---

## 2. Phases

Dependency-ordered; 1–3 are frontend-only, 4–5 need new backend + one `ww-backend` schema change.

### Phase 1 — Header & navigation shell *(frontend only, no behaviour change)*

Pure re-arrangement; every existing URL keeps working.

- [ ] `App.tsx`: move `GlobalProjectSelector` from the right-side controls to directly after the
      logo `Link`.
- [ ] `App.tsx` `USER_TABS`: `[toolkit, annotations, insights]` — rename `other → toolkit`
      (label 🧰 Toolkit), `results → insights` (label 📈 Insights), reorder Toolkit first.
- [ ] Routes: add `/toolkit` + `/insights`; keep `/other → /toolkit` and `/results → /insights`
      redirects (pattern already exists: `/my-data → /results`). Update internal `Link`s
      (`OtherPage`, dock "View Annotations", DeploymentActionRow nav buttons).
- [ ] `AccountMenu` (inline in `App.tsx:53`): add **Notifications** (→ `/notifications`, stub
      page "coming soon" until Phase 4) and **Settings** (→ `/settings`, stub until Phase 2)
      above Log out.
- **Acceptance:** all legacy URLs redirect; active-tab highlight works on nested routes; no
  references to "Other"/"Results" remain in UI copy.
- **Effort:** ~½ day.

### Phase 2 — Page restructure *(content moves into the new homes)*

- [ ] **Toolkit** (`OtherPage` → `ToolkitPage`): regroup the existing `Section`s under four
      headed groups — Camera prep (SD manifest, firmware) · AI models (upload/convert) ·
      Integrations (iNaturalist) · Exports (R, GBIF). Inline `/manifest` and `/upload-model`
      content or keep as sub-routes under `/toolkit/*`.
- [ ] **Insights** (`ResultsPage` → `InsightsPage`): default sub-tab **Reports**; keep
      **Deployments**; *remove* Projects and Map sub-tabs (their content moves below).
- [ ] **Settings v1** (`/settings`, new page): two sections —
      **Projects** (projects table + Create project + `ProjectMembersPanel`, moved verbatim from
      Results) and **Account** (email, password reset link). Per-project capture defaults and
      default-model selector come later (Phase 6).
- [ ] Map: temporarily keep reachable from Insights ▸ Deployments ("View map") until Phase 3
      gives it its real home, so nothing disappears mid-migration.
- **Acceptance:** all four former Results sub-tabs reachable in their new homes; Settings opens
  from the avatar; project create/invite flows work from Settings.
- **Effort:** ~1–1.5 days.

### Phase 3 — Field page *(the conditional tab)* — ✅ SHIPPED (LoRaWAN health deferred)

> **Status (June 2026):** shipped a **no-LoRaWAN version**. The conditional **📡 Field** tab now
> appears (via `useHasActiveDeployments`, cached + localStorage-seeded) when the user has an active
> deployment (no end date / future end date). `FieldPage` shows those cameras on the map + a status
> table (longest-deployed first, row → `/explore` drill-in) with an honest "Active — awaiting
> LoRaWAN" state. **Still deferred** until heartbeats flow: the `GET /api/field/health` endpoint,
> the 🟢/🟠/🔴 freshness colouring, battery, and true silent-first ordering. No backend was needed
> for the shipped version (pure `deployments` query).


Backend (ww-website, read-only — no schema change):

- [ ] `GET /api/field/health`: per active deployment → last LoRaWAN heartbeat
      (`lorawan_parsed_messages` latest per device), battery if present, classification:
      🟢 fresh (<36 h) · 🟠 stale (<72 h) · 🔴 silent (≥72 h). Active = status `started` /
      `deployment_end` null.

Frontend:

- [ ] `useHasActiveDeployments()` hook: cheap `count` query over accessible projects'
      deployments (head request), cached in react-query **and seeded from localStorage** so the
      tab doesn't flash in/out on page load.
- [ ] `App.tsx`: insert `{ id: 'field', label: '📡 Field', to: '/field' }` between Toolkit and
      Annotations when the hook returns true.
- [ ] `FieldPage`: `DeploymentMap` (moved from Results) with markers coloured by heartbeat
      class + tooltip (name, last seen, battery); health table below, **silent cameras sorted
      first**; row click → deployment drill-in.
- **Acceptance:** a fresh user with no active deployments never sees the tab; the 20-camera
  snail-project user lands on the map in **1 click** and silent cameras are listed first; tab
  appears without re-login once a deployment goes active.
- **Effort:** ~2 days (backend ½, frontend 1.5).

### Phase 4 — Notifications, in-app *(first net-new system)*

Schema (**ww-backend** — follow `.agents/SKILL.md`: declarative schema in `supabase/schemas/`,
`DB_AGENT_MODE=1 npm run db:change`, never hand-edit migrations; non-breaking = new tables):

- [ ] `notifications` (id, user_id FK, project_id, deployment_id, type, title, body, read_at,
      created_at) — RLS: owner select/update(read_at); insert via service role only.
- [ ] Enable Supabase **realtime** on `notifications` (badge updates live).

Backend (ww-website):

- [ ] Emitters: (a) pipeline post-step — species detection matching a watch rule (e.g. rat) →
      notification per subscribed user; (b) Field health sweep — deployment transitions to
      *silent* → notification. Hardcode sensible defaults until Phase 5 rules exist.

Frontend:

- [ ] Avatar badge: unread count (realtime subscription, fallback poll).
- [ ] Avatar dropdown: 5 most recent + "View all".
- [ ] `/notifications` page: list, filters (project/type/unread), mark read / mark all read.
- **Acceptance:** a rat detection during upload produces a badge increment within seconds and a
  row on the Notifications page; mark-read clears the badge.
- **Effort:** ~3 days incl. ww-backend coordination.

### Phase 5 — Notification rules & email channel

- [ ] `notification_rules` (ww-backend, same workflow): project_id, user_id, event_type
      (`species_detection` · `camera_silent` · `upload_complete`), species filter (taxon/text),
      channels (`web` · `email` · `push`), digest preference.
- [ ] Settings ▸ Notifications panel: per active project, event-type × channel matrix — the
      persona-4 flow (*avatar → Settings → Notifications → toggle rat alerts for the project*).
- [ ] Email delivery worker (provider decision needed: Azure ACS / Resend / SendGrid; respect
      digest pref). `push` channel is recorded but greyed out — delivery is the mobile app's
      job (coordinate via `project-context/cross-project-coordination/`).
- **Effort:** ~3–4 days + provider setup.

### Phase 6 — Settings completion & polish

- [ ] Per-project **capture defaults** (e.g. default triggering method: timelapse/PIR) in
      Settings ▸ Projects (persona 8).
- [ ] **Default AI model per project** selector (persona 5) — pairs with the Edge Impulse
      round-trip work tracked in the personas report.
- [ ] Quick wins if not already shipped: Vega PNG export (`VegaChart actions: true`),
      chart → pre-filtered Annotations deep-link.
- [ ] Docs: update `02-CODEBASE-GUIDE.md` (pages/nav/routes) + `readme.md` screenshots/copy;
      retire stale "Other"/"Results" references.

---

## 3. Sequencing & risk

```
P1 shell ──► P2 restructure ──► P3 Field ──► P4 notifications ──► P5 rules+email ──► P6 polish
(½ d)        (1.5 d)            (2 d)        (3 d, ww-backend)     (3–4 d)            (2 d)
```

| Risk | Mitigation |
|---|---|
| Conditional Field tab flickers on load | Seed `useHasActiveDeployments` from localStorage; only ever *add* the tab mid-session, never remove |
| Old bookmarks / docs point at `/other`, `/results` | Permanent redirects (Phase 1) + docs pass (Phase 6) |
| Notifications schema is cross-repo | New-tables-only (non-breaking per SKILL.md); mobile app consumes the same `notifications` table later — share types via `database.types.ts` |
| Settings becomes a new junk drawer | Hard rule: Settings holds only *configuration* (account, project membership, defaults, notification rules); tools stay in Toolkit |
| Email provider lock-in | Channel abstraction in the worker; provider behind one interface |

**Total: ~12–14 working days** spread across 6 independently shippable phases — each phase
leaves the app fully functional, so the rollout can pause at any boundary.
