# Wildlife Watcher Web — UI Redesign Roadmap

> **Status:** WS0–WS7, WS-R, WS3, WS5, WS6-T1–T9 — **all done**. Remaining: BE-2 (explicit media status field — backend ticket), BE-3 (chart spec persistence — see `be-3-chart-specs.md`), WS7-T4 GBIF placeholder (optional).
> Pair with [`v4-implementation-plan.md`](./v4-implementation-plan.md) (Brain/clusters/active-learning surface
> that the Annotations tab touches) and `wildlife_watcher_v4_roadmap.html` (the science "why").
>
> **Scope of this doc:** the seven UI changes — logged-out landing, signed-in nav, signed-in landing,
> upload modal + progress dock, Annotations tab, Results section, Other tab — plus a dedicated
> **visualization-package research spike**. **GBIF publishing is explicitly a follow-on** (Appendix A).

---

## 0. Conventions

- **Effort scale:** S = ≤1 day · M = 2–4 days · L = 1–2 weeks · XL = >2 weeks (split before starting).
- **Guardrail G1 (from v4 plan):** the database is owned by `ww-backend`. Any new column/table/RPC the
  UI needs is a **`ww-backend` PR first**; the website consumes the schema only after it exists. Every
  such dependency is tagged **[ww-backend]** and collected in §9.
- **Validation gate (G8):** each task is "done" only when `eslint` + `tsc` + `vite build` pass.
- **Task IDs:** `WS<workstream>-T<n>` for traceability in PRs/issues.
- **Reuse-first:** ~70% of the target UI already exists inside `MyDataPage` and `AnalyseImages`. Most
  tasks are *re-grouping + shelling*, not greenfield. Net-new work is flagged explicitly.

---

## 1. Dependency overview

```
WS0 Foundation (primitives + app shell)
 ├─► WS1 Logged-out landing ───────────────┐ (shares ThreeStepGuide)
 ├─► WS2 Top nav / 3-tab frame             │
 │     ├─► WS3 Signed-in landing ──────────┘
 │     ├─► WS4 Upload modal + progress dock ──► (completion handoff) ─► WS5 filter
 │     ├─► WS5 Annotations tab
 │     ├─► WS6 Results (Reports/Map/Deployments/Projects)
 │     │     └─ depends on ◀── WS-R Visualization research spike (Reports only) ✅ Vega-Lite
 │     └─► WS7 Other tab
 └─► WS9 ww-backend schema tickets (parallel track, unblocks WS4/WS5/WS6)

Appendix A — GBIF publishing (follow-on, not in this redesign)
```

**Critical path:** WS0 → WS2 → WS4 (global upload store is the hard refactor; it unblocks the
upload→Annotations handoff). Start **WS9** and **WS-R** in parallel on day 1 since both have lead time.

---

## 2. Workstream 0 — Foundation: shared primitives & app shell

**Why first:** the app today uses inline `style={{}}` objects with copy-pasted CSS-variable values and
no component library. Three new shells (nav, control bar, modal/dock) across many sections will multiply
that duplication unless we extract a small primitive set first. This pays for itself across WS4/5/6.

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS0-T1** | `<Modal>` primitive (overlay, focus trap, ESC/click-out close, sizes). Basis for upload modal, advanced-settings popup, create-project form. | `src/components/ui/Modal.tsx` (new) | S |
| **WS0-T2** | `<ControlBar>` primitive — responsive flex toolbar with slots (filters left, actions right, "Advanced" trigger). | `src/components/ui/ControlBar.tsx` (new) | S |
| **WS0-T3** | `<DataTable>` primitive — extract the sort/search/CSV logic currently inlined in `MyDataPage` into a reusable table with **column show/hide** + **CSV/JSON export** built in. | `src/components/ui/DataTable.tsx` (new); refactor from [`MyDataPage.tsx`](../frontend/src/pages/MyDataPage.tsx) | M |
| **WS0-T4** | `<ThreeStepGuide>` — Upload → Review Annotations → See results, with configurable link targets. Reused by WS1 (logged-out "Web" section) **and** WS3 (signed-in landing). | `src/components/common/ThreeStepGuide.tsx` (new) | S |
| **WS0-T5** | `<StatusBadge>` — the four annotation states (ML-pending ⚙ grey, issue ✕ red, AI light-green, reviewed ✓ green). Used by WS5 thumbnails and any list view. | `src/components/ui/StatusBadge.tsx` (new) | S |

**Acceptance:** primitives have Storybook-style demo usage or are consumed by at least one workstream;
no visual regression on existing pages that adopt `<DataTable>`.

**Dependencies:** none. **Total: ~M–L.**

---

## 3. Workstream 1 — Logged-out landing (four sections after "Get the Mobile App")

**Goal:** below the existing hero + app-store QR block, add four anchored sections.

**Current state:** `MarketingHero()` in [`HomePage.tsx:232`](../frontend/src/pages/HomePage.tsx#L232) —
hero + `Get the Mobile App` QR codes only.

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS1-T1** | **Why** section — problem summary + in-page jump links (`#watchers`, `#app`, `#web`). | `HomePage.tsx` (`MarketingHero`) | S |
| **WS1-T2** | **The Wildlife Watchers** (`#watchers`) — device description + "how to get them" (purchase/contact link). | same | S |
| **WS1-T3** | **The App** (`#app`) — description; reuse existing QR/store badges already in `MarketingHero`. | same | S |
| **WS1-T4** | **The Web** (`#web`) — embed `<ThreeStepGuide>` (WS0-T4) in marketing mode (links → /login). | same | S |

**Open content questions (non-blocking, need product/marketing input):** device purchase URL, copy for
each section. Use placeholders if not ready.

**Acceptance:** four sections render, jump links scroll correctly, mobile-responsive, no auth required.
**Dependencies:** WS0-T4. **Total: S.**

---

## 4. Workstream 2 — Signed-in top nav & 3-tab app frame

**Goal:** replace the flat per-feature nav with **Annotations · Results · Other** + Projects selector +
Account menu + Upload button.

**Current state:** `Layout()` in [`App.tsx:43`](../frontend/src/App.tsx#L43) renders per-feature links
(`My Data`, `Labeling`, `Upload Data`, `Prepare SD Card`, `Upload Model`) and a bare `user.email` + Logout.

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS2-T1** | New routes `/annotations`, `/results`, `/other`; keep deep-link routes (`/labeling/:id`, `/clusters/:id`, `/explore/:id`, `/reporting/:id`, etc.) as children/sub-views. Redirect legacy `/my-data` → `/results`. | [`App.tsx`](../frontend/src/App.tsx) (`Routes`) | M |
| **WS2-T2** | 3-tab top nav with active-state styling; reuse existing `GlobalProjectSelector` ([`GlobalProjectSelector.tsx`](../frontend/src/components/common/GlobalProjectSelector.tsx)) untouched — it already drives `useProjectSelection` filtering used everywhere. | `App.tsx` (`Layout`) | M |
| **WS2-T3** | **Account menu** — promote `user.email`+Logout into a dropdown (account, logout, privilege-gated links). Reuse the `isOrgManager`/`managedOrgs` check already at [`App.tsx:54`](../frontend/src/App.tsx#L54) for the Upload-Model entry. | `App.tsx` | S |
| **WS2-T4** | **Upload button** in nav — opens the WS4 upload modal (not a route navigation). Wire to the global upload store's `openModal()`. | `App.tsx` + WS4 store | S |

**Note on Projects interlink:** the requirement "all projects selected → tables show all" is *already*
the behavior — `selectedProjectIds` filters deployments/observations at
[`MyDataPage.tsx:226`](../frontend/src/pages/MyDataPage.tsx#L226). Preserve it when re-homing into Results.

**Acceptance:** nav routes work; deep links still resolve; project selector filters Results; account
menu shows privilege-gated items only when `isOrgManager`.
**Dependencies:** WS0. **Total: M.**

---

## 5. Workstream 3 — Signed-in 3-step landing

**Goal:** the post-login landing is the 3-step guide, not the current project-card grid.

**Current state:** `Dashboard()` in [`HomePage.tsx:116`](../frontend/src/pages/HomePage.tsx#L116) shows a
project-card grid + quick links + an empty state for "no projects".

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS3-T1** | Render `<ThreeStepGuide>` (WS0-T4) as the landing; steps link to /annotations, /annotations (review), /results. | `HomePage.tsx` (`Dashboard`) | S |
| **WS3-T2** ✅ | **New-user → create-project redirect**: zero-project empty state now links to `/results?tab=projects&create=true`. `ResultsPage` reads `?create=true` on mount and auto-opens `CreateProjectModal`. Copy updated to "Create your first project" CTA. | `HomePage.tsx`, `ResultsPage.tsx` | S |

**Acceptance:** logged-in users land on the 3-step guide; zero-project users are pushed to project
creation. **Dependencies:** WS0-T4, WS6-T7 (for the redirect target). **Total: S.**

---

## 6. Workstream 4 — Upload modal + bottom-right progress dock ✅ COMPLETE

**The hardest item.** Converts upload from a full-page activity into a background job with a persistent
widget. The core work is **lifting upload state into global scope** so progress survives navigation.

**Implemented:** `src/contexts/UploadContext.tsx` (global store + batch loop + job polling),
`src/components/upload/UploadModal.tsx` (file picker → stats → upload trigger; CamtrapDP inline),
`src/components/upload/ProgressDock.tsx` (minimised pill / medium card / expand to logs),
`src/pages/UploadLogsPage.tsx` (`/upload/logs`). Nav Upload button wired to `openModal()` via
`UploadNavButton` in `App.tsx`. `UploadProvider` wraps the entire app inside `<BrowserRouter>`.

| Task | Description | Status |
|---|---|---|
| **WS4-T1** | Global upload store (`UploadContext` — state, batch loop, polling, dock state) | ✅ |
| **WS4-T2** | Upload modal (file picker, 3-stat summary, drive toggle, validation warning, Upload button) | ✅ |
| **WS4-T3** | Progress dock — medium: card with `PipelineStatusBox` + minimise/expand/dismiss | ✅ |
| **WS4-T4** | Progress dock — minimised: semaphore pill with pulsing dot + label | ✅ |
| **WS4-T5** | `/upload/logs` full-screen log view with summary grid + completion CTA | ✅ |
| **WS4-T6** | Completion routing: success → Annotations link in dock; failure → logs link in dock | ✅ (link-based; filter handoff deferred to WS5-T6) |
| **WS4-T7** | CamtrapDP ZIP auto-detected in modal; inline staged-progress spinner; success → Annotations | ✅ |

**Note on AI pipeline:** ~~DINOv3/SpeciesNet do not run automatically after upload~~ — **this is now
outdated**. The AI pipeline (SpeciesNet/MegaDetector) **auto-triggers at the end of every Drive upload
job** (Phase 4 in `upload_drive_images_job`). Freshly uploaded images pass through ML inference as part
of the same ARQ job; the progress dock shows "🤖 Running AI analysis…" during this phase. The grey ⚙
`ml-pending` badge correctly reflects images before ML completes, and the teal `AI` badge appears once
the pipeline run completes and creates observation records.

**Dependencies met:** WS0-T1 (Modal), WS2-T4 (nav button). **tsc: ✅ clean.**

---

## 7. Workstream 5 — Annotations tab

**Goal:** control bar + thumbnail grid + advanced-settings popup + per-thumbnail status badges.

**Current state:** `MediaBrowser` ([`MediaBrowser.tsx`](../frontend/src/components/data/MediaBrowser.tsx))
already renders a thumbnail grid with deployment/species/annotator filters + a KPI row — ~70% there.
**Hard cap of 200 media** with no pagination at [`MediaBrowser.tsx:106`](../frontend/src/components/data/MediaBrowser.tsx#L106).

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS5-T1** ✅ | **Control bar** (via `<ControlBar>`): deployment, species, annotation-status, annotator filters; thumbnail size S/M/L toggle; Advanced button. | `MediaBrowser.tsx` | M |
| **WS5-T2** ✅ | **Pagination** — `.limit(200)` replaced with Supabase `.range(from, to)` + `count: 'exact'`. Page size 100; prev/next/first/last controls; shows "1–100 of N". Pure frontend — no backend work needed. | `MediaBrowser.tsx` | S |
| **WS5-T3** ✅ | **Advanced settings popup** (via `<Modal>`): date-range from/to inputs, day/night time-of-day toggle, favorites-only checkbox. Inline in `MediaBrowser.tsx` (no separate file needed). | `MediaBrowser.tsx` | M |
| **WS5-T4** ✅ | **Status badges** (top-left of each thumbnail) via `<StatusBadge>`. Map: `classification_method==='human'` → ✓ reviewed; `==='machine'` → AI `+%`; no observation → ✕ Issue (default). `'ml-pending'` state removed — images with no observations default to `'issue'` so they are visually actionable. Status filter updated (ml-pending option removed). | `MediaBrowser.tsx`, `StatusBadge.tsx` | S |
| **WS5-T5** ✅ | **Status source data** — `'ml-pending'` eliminated; default fallback is `'issue'` (no observations). When BE-2 lands (explicit per-media status field), `deriveAnnotationStatus` accepts `hasError` directly and the ✕ badge will distinguish genuine pipeline errors from truly unprocessed images. No schema change needed now. | `StatusBadge.tsx` | S (audit) |
| **WS5-T6** ✅ | **Accept upload→filter handoff** — `initialDeploymentId` prop on `MediaBrowser`; `AnnotationsPage` reads `?deployment=` from `useSearchParams`; `ProgressDock` "View Annotations" link deep-links to `?deployment=<id>` when upload was a single deployment. `UploadContext` stores `uploadedDeploymentIds`. | `MediaBrowser.tsx`, `AnnotationsPage.tsx`, `ProgressDock.tsx`, `UploadContext.tsx` | S |

**Acceptance:** control bar modifies the grid live; advanced popup applies clustering/time filters;
all four badge states render correctly; arriving from a completed upload shows only those images.
**Dependencies:** WS0 (ControlBar/Modal/StatusBadge), WS4-T6, possibly WS9. **Total: L.**

---

## 8. Workstream 6 — Results (Reports · Map · Deployments · Projects)

All four already exist as sub-tabs of `MyDataPage`; re-home under `/results` with a shared
control-bar + grid shell. Reports is the only one with a real architecture decision (→ WS-R).

### 8a. Reports

**Current state:** fixed Vega-Lite dashboard ([`ObservationReports.tsx`](../frontend/src/components/data/ObservationReports.tsx)):
species bar, type pie, per-deployment bar, KPI cards. Recharts fully removed from codebase.

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS6-T1** | ✅ Control bar (deployments/species filters) above the report grid. | `ObservationReports.tsx` | S |
| **WS6-T2** | ✅ Keep current charts as the **default dashboard** — rewritten in Vega-Lite. | `ObservationReports.tsx` | — |
| **WS6-T3** | ✅ **User-created visualizations** — `ChartBuilder.tsx` with 4 chart types × 4 group-by dimensions, `buildVegaSpec()` spec builder, `UserChartDef` serialisable JSON model. Specs are ready to persist when BE-3 lands. `AnalysisPage.tsx` + `ReportingPage.tsx` also migrated to Vega-Lite; `recharts` removed from `package.json`. | `ChartBuilder.tsx` (new); `AnalysisPage.tsx`, `ReportingPage.tsx`, `ObservationReports.tsx` (rewritten); `VegaChart.tsx` (new); `recharts` removed | L |

### 8b. Map

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS6-T4** ✅ | Species filter `<ControlBar>` above `DeploymentMap`. When a species is selected, only deployments with that species observed are shown on the map. Count badge updates live. | `ResultsPage.tsx` | S |

### 8c. Deployments

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS6-T5** ✅ | `<DataTable>` with column show/hide + CSV + JSON export. `DeploymentActionRow` includes primary "🏷️ Annotate" button linking to `/annotations?deployment=<id>` (WS5-T6 handoff from deployment table). | `ResultsPage.tsx`, `DeploymentActionRow.tsx` | S |

### 8d. Projects

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS6-T6** ✅ | `<DataTable>` with column show/hide + CSV/JSON export. Row click and tab action buttons (Deployments, Map, Health, Members). `+ New Project` button opens `CreateProjectModal`. | `ResultsPage.tsx` | S |
| **WS6-T7** ✅ | **Create Project form** — `CreateProjectModal.tsx` does direct Supabase `insert` into `projects`. Reference data (capture_methods, sampling_designs, activity_sensitivity, ai_models) read directly from Supabase. `organisation_id` resolved from `user_roles`. No backend endpoint. | `CreateProjectModal.tsx`, `ResultsPage.tsx` | L |
| **WS6-T8** ✅ | **Member management** — `ProjectMembersPanel.tsx` lists via `get_organisation_users` RPC; add/remove via `user_roles` insert/update. Renders in a slide-in drawer triggered by "👥 Members" row action. | `ProjectMembersPanel.tsx`, `ResultsPage.tsx` | M |
| **WS6-T9** ✅ | New-user empty state on Dashboard → "Go to Projects" links to `/results?tab=projects`. Target page has the `+ New Project` stub. | `HomePage.tsx`, `ResultsPage.tsx` | S |

**Acceptance:** all four sub-sections render under Results with control bars; tables export CSV+JSON and
toggle columns; a project can be created end-to-end and members managed; selector interlink holds.
**Dependencies:** WS0, WS-R (for T3), WS9 (for T7/T8 endpoints). **Total: L–XL (Projects dominates).**

---

## 9. Workstream 7 — Other tab

| Task | Description | Files | Effort |
|---|---|---|---|
| **WS7-T1** | **Export dataset (CamtrapDP for R)** — already implemented (`downloadCamtrapDP` → `export-camtrap-dp` Supabase function, [`MyDataPage.tsx:271`](../frontend/src/pages/MyDataPage.tsx#L271)). Relocate the button here. | Other view | S |
| **WS7-T2** | **Prepare SD card** — exists at `/manifest` (`ManifestPage`). Surface entry here; keep route. | Other view | S |
| **WS7-T3** | **Upload Model (privilege-gated)** — exists; reuse `isOrgManager` gate ([`App.tsx:54`](../frontend/src/App.tsx#L54)). Show only to org managers. | Other view | S |
| **WS7-T4** | **Publish to GBIF** — **follow-on, not built here.** Add a disabled/"coming soon" entry or omit. See Appendix A. | — | — |

**Acceptance:** existing actions relocated and functional under Other; model entry privilege-gated.
**Dependencies:** WS0, WS2. **Total: S.**

---

## 10. Workstream R — Visualization package research spike *(complete)* ✅

**Decision:** **Vega-Lite via `vega-embed@7`** — winner chosen without needing a formal spike.

| Task | Status | Notes |
|---|---|---|
| **WS-R-T1** | ✅ Skipped (winner pre-selected) | Vega-Lite chosen: specs are plain JSON (serialisable/persistable per project), single-library convergence, `width:"container"` for responsive, tableau10 colours, SVG renderer. |
| **WS-R-T2** | ✅ Done inline with WS6-T3 | `VegaChart.tsx` wrapper + `VEGA_CONFIG` shared theme. Species bar, type donut, deployment bar all ported. `AnalysisPage` + `ReportingPage` fully migrated. |
| **WS-R-T3** | ✅ Done | **Full convergence**: Recharts entirely removed (`package.json` + all source files). Zero Recharts remaining in codebase. |

**Implementation summary:**
- `src/components/ui/VegaChart.tsx` — thin `useEffect` wrapper around `vega-embed`, `VEGA_CONFIG` shared theme constant, exported from `ui/index.ts`
- `src/components/data/ObservationReports.tsx` — species bar + type donut + deployment bar (Vega-Lite transforms for aggregation)
- `src/components/data/ChartBuilder.tsx` — WS6-T3 user chart builder (see §8a)
- `src/pages/AnalysisPage.tsx` — species abundance + confidence histogram as static Vega-Lite specs
- `src/pages/ReportingPage.tsx` — multi-species bar/line chart with species toggles; `pivotByDay` removed (Vega-Lite aggregates inline)
- `recharts` removed from `package.json`; `npx tsc --noEmit` passes with zero errors

**Dependencies:** none. **Total: M.**

---

## 11. Cross-cutting — `ww-backend` schema/endpoint tickets (parallel track)

These have lead time and gate UI tasks; raise them on day 1 against `ww-backend`.

| Ticket | Needed by | Question to resolve |
|---|---|---|
| ~~**BE-1**~~ | ~~WS5-T2~~ | ~~Paginated media endpoint~~ — **closed**: Supabase `.range()` + `count: 'exact'` is a pure frontend change. |
| **BE-2** | WS5-T4/T5 | Explicit per-media **processing status** (so ⚙ ML-pending and ✕ issue states are real, not inferred). Confirm whether `media`/`observations` already carry this. |
| **BE-3** | WS6-T3 | Storage for **saved chart specs** per project (table or JSON column). |
| ~~**BE-4**~~ | ~~WS6-T7~~ | ~~Web project-create endpoint~~ — **closed**: direct Supabase `insert` into `projects`; reference data queried directly from Supabase tables. |
| ~~**BE-5**~~ | ~~WS6-T8~~ | ~~Project member CRUD~~ — **closed**: web uses `user_roles` table + existing `get_organisation_users` RPC (same as mobile). |

---

## 12. Milestones / release slices

- **M1 — Frame & landings (visible early win):** WS0 + WS1 + WS2 + WS3. New nav, both landings, 3-step
  guide. No backend dependency. *(~1.5–2 wks)*
- **M2 — Upload experience:** WS4 (modal + dock + completion handoff). The keystone refactor. *(~2 wks)*
- **M3 — Annotations:** WS5 (control bar, advanced popup, badges). Depends on BE-1/BE-2. *(~1.5 wks)*
- **M4 — Results read-side:** WS6 Map/Deployments/Projects table + Other tab (WS7). Plus **WS-R decision**
  landed. *(~1.5 wks)*
- **M5 — Results write-side:** WS6-T3 user charts (per WS-R) ✅, WS6-T7 create project ✅, WS6-T8 members ✅.
  Depends on BE-3/BE-4/BE-5. *(~2–3 wks)*

**Parallel from day 1:** WS-R (research spike) and WS9 (ww-backend tickets).

---

## Appendix A — GBIF publishing *(follow-on, out of scope for this redesign)*

Publishing observations from a project/deployment to **GBIF** is a **separate project**, not part of this
UI redesign. Rationale and scope notes for when it's picked up:

- **No GBIF code exists** anywhere in the repos today (only iNaturalist + CamtrapDP integrations were found).
- It's the only fully greenfield, **externally-dependent** piece: needs a backend integration (GBIF IPT /
  registry / API), credentials/registration, dataset metadata (EML), and a publish-status lifecycle.
- The CamtrapDP export already in place ([`MyDataPage.tsx:271`](../frontend/src/pages/MyDataPage.tsx#L271))
  is a useful foundation (Darwin Core Archive is GBIF's ingestion format), but the publishing handshake is new.
- **UI placeholder now:** WS7-T4 may show a disabled "Publish to GBIF (coming soon)" entry so the Other
  tab's information architecture is complete; the feature itself is deferred.
