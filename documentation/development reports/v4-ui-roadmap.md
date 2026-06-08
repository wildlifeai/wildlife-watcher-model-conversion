# v4 UI Roadmap — Making the workflow fit real users

Goal: turn the v4 building blocks (Media Registry, Wildlife Brain, clusters, review
queue, intelligence) into a coherent end-to-end journey for a working ecologist.
Driven by `docs/gecko_monitoring_storyboard.md` (Dr. Sarah: 5 trail cams → upload →
auto-AI → contact-sheet review + iNaturalist → interactive report/export).

This is a UI roadmap (frontend-led, with the few backend hooks called out). It
starts with the **MyData deployment nav** because that's the smallest change that
makes everything already built reachable.

---

## 1. Storyboard → current state (gap analysis)

| Step | Storyboard wants | Today | Gap |
|------|------------------|-------|-----|
| 1. Login | Land on a useful Home | `HomePage` = marketing + app QR for everyone | **No logged-in dashboard** |
| 2. Upload | Home shows active projects + prominent Upload; auto deployment-ID linking | `UploadDataPage`→`AnalyseImages` (drag-drop, EXIF, Drive). No project list on Home | Home dashboard; Upload CTA |
| 3. Auto AI | Images appear in Review with AI species %, clustering, **no manual trigger** | Upload does EXIF + Drive only; SpeciesNet/embed/cluster are manual | **Auto-pipeline on upload** + live "processing → review" status |
| 4. Review | Contact sheets, **Confirm Cluster**, select odd photos → **Publish to iNaturalist**, bulk-refine (Rat→Ship Rat) | `ClusterReviewPage` confirms whole clusters only | Per-photo select within cluster; iNat publish; subset reassign |
| 5. Report | Interactive grapher: pick X (weather) / Y (gecko/day), scatter/line, export **PDF + PNG + CSV** | `ObservationReports` fixed charts; `ReportingPage` mock downloads | Configurable grapher; weather source; real exports |
| — | Find any of the above | v4 pages reachable only by URL | **Navigation** |

**Backend already supports** most of step 4–5 data: clusters/confirm, similar, review
queue, media registry, iNaturalist OAuth + taxa endpoints, CamtrapDP/Darwin Core export.
The gaps are mostly **frontend + a couple of backend triggers**.

---

## 2. Target happy path (what we're building toward)

```
Login → Home (projects + "Upload Data")
      → Upload Data (drag SD card) → auto: EXIF → SpeciesNet → crops → DINOv3 embed → cluster
      → Deployment workspace shows live progress, then:
        Explore (grid) · Clusters (confirm / iNat publish / reassign) · Review Queue · UMAP
      → Reports (interactive grapher + weather) → export PDF / PNG / CSV
      → (project) Dataset Health dashboard + alerts
```

---

## 3. Roadmap (phased)

### U1 — MyData deployment nav + status badges  ← do first (small, high-leverage)
Make every built page reachable from where users already are.

- **MyDataPage › Deployments table actions:** replace `Label / Events / Analyse / Report`
  with the v4 lifecycle row:
  `Explore 🖼 → Clusters ◧ → Review ▶ → UMAP ✦ → Events 📂 → Analyse 📊 → Report 📦`
  (routes already exist: `/explore/:id`, `/clusters/:id`, `/review/:id`, `/umap/:id`).
- **Status badges per deployment row:** "clusters confirmed X/Y", "outliers N",
  "unreviewed N" — from `GET /api/brain/clusters/{id}` (+ outliers). Lazy-load per row
  or a small batched stats endpoint to avoid N calls (follow-up: `/api/brain/stats?deployment_ids=`).
- **Projects tab actions / MyData header:** add **Dataset Health** → `/intelligence/:project_id`.
- Keep `/labeling` working but de-emphasise (native review is now Clusters/Review).
- *Effort: S. Pure frontend; uses existing endpoints.*

### U2 — Home dashboard for logged-in users  (storyboard Step 1–2)
- When `user`, `HomePage` shows **active project cards** (name, deployment count,
  "needs review" count) + a prominent **Upload Data** CTA. Keep the marketing/QR
  content for logged-out visitors.
- Project card → MyData filtered to that project; card badge → Clusters/Review.
- *Effort: S–M. Frontend; reuse Supabase project/deployment queries from MyData.*

### U3 — Auto-pipeline on upload + live review hand-off  (Step 3)
The biggest UX promise: "she doesn't trigger anything."
- **Backend:** after `/api/exif/parse` ingests a deployment's images, optionally
  enqueue the chain `SpeciesNet → AnimalCrop → embed/cluster` (gated, e.g.
  `FF_AUTO_PIPELINE`, per-project opt-in). Reuse the job runner; emit progress events.
- **Frontend:** `AnalyseImages` shows a staged status ("Uploaded → Detecting →
  Embedding → Clustering") and a **"Go to Review"** link the moment clusters exist.
- Honest note: today this runs in-process; at scale it wants the ARQ/GPU-worker path
  (already scaffolded in docker-compose `--profile gpu`).
- *Effort: M. Backend trigger + frontend status.*

### U4 — Cluster review power tools  (Step 4)
Bring `ClusterReviewPage` up to the storyboard:
- **Per-photo selection inside a cluster** (open a cluster → grid of members from
  `media_embeddings`+registry; multi-select).
- **Publish to iNaturalist:** selected photos → existing iNat integration
  (`/api/inat/*`, OAuth already built). Surface "link iNaturalist account" if not linked.
- **Subset reassign / bulk-refine:** mark a sub-selection as a different taxon
  (Rat → Ship Rat) → `POST /api/brain/review/{media_id}` per item or a new bulk
  endpoint `POST /api/brain/reassign` (follow-up).
- **Eject to expert queue / "flag as unknown species"** (ties to Phase 9 candidate taxa).
- *Effort: M–L. Mostly frontend; one optional bulk endpoint + iNat publish wiring.*

### U5 — Interactive reporting + weather + real exports  (Step 5)
- New **`InteractiveReport`** component: choose **Y** (e.g. observations/day for a
  species) and **X** (date, trap-night, or **external weather** like max temp);
  render scatter/line (recharts already a dependency).
- **Weather source:** fetch daily weather by deployment GPS + date range (e.g.
  Open-Meteo historical API) via a small backend proxy `GET /api/weather?lat&lon&from&to`
  (keeps keys server-side, caches).
- **Exports:** PNG (chart-to-canvas), CSV (the plotted series), PDF (chart + summary).
  Replace `ReportingPage`'s **mock** downloads with the real CamtrapDP/Darwin Core/CSV
  already available, plus the new graph exports.
- *Effort: L. Frontend grapher + backend weather proxy + export wiring.*

### U6 — Polish & consistency
- A per-deployment **Workspace landing** (`/deployment/:id`) showing lifecycle stage
  (uploaded → processed → clustered → reviewed → reported) with the right next action.
- Consistent design system (the new pages use ad-hoc inline styles; extract shared
  `Card`, `Badge`, `Toolbar`, `Stat` from `components/common`).
- Empty/loading/error states; keyboard help; mobile responsiveness pass.
- Accessibility (focus order, alt text, ARIA on the canvas UMAP).
- *Effort: M, ongoing.*

---

## 4. The MyData deployment nav (U1) — concrete design

**Replace** the deployments-table action cell (`MyDataPage.tsx`, the `Label/Events/
Analyse/Report` buttons) with a compact lifecycle toolbar + badges:

```
[ Explore ] [ Clusters 12/18 ] [ Review 240 ] [ UMAP ] [ ⋯ Events · Analyse · Report ]
```

- **Primary (v4):** Explore → Clusters → Review → UMAP (the day-to-day flow).
- **Secondary (overflow menu):** Events, Analyse, Report, Label (legacy).
- **Badges:** `Clusters X/Y confirmed`, `Review N` (unreviewed/outliers). Source:
  `useClusters(id)` (already built) for confirmed/total; outliers from `useOutliers(id)`.
  To avoid N requests on a big table, render badges only for the expanded/last-opened
  row first, then add a batched `/api/brain/stats` endpoint.
- **Header:** add a project-scoped **Dataset Health** button (→ `/intelligence/:projectId`)
  next to "Download CamtrapDP".
- Reuses: `hooks/useBrain.ts`, existing routes. No backend change for the MVP (badges
  can start from the single-deployment cluster call when a row is opened).

**Acceptance:** from MyData a user can reach Explore/Clusters/Review/UMAP for any
deployment and Dataset Health for any project; confirmed-cluster progress is visible
without opening the page.

---

## 5. Backend follow-ups this roadmap implies
- `FF_AUTO_PIPELINE` + auto-enqueue after EXIF ingest (U3).
- `GET /api/brain/stats?deployment_ids=[]` — batched per-deployment counts for badges (U1).
- `POST /api/brain/reassign` — bulk subset reassign (U4).
- iNaturalist **publish** endpoint for selected media (U4) — observation upload (OAuth exists).
- `GET /api/weather` proxy (Open-Meteo historical) + cache (U5).
- Real report exports (PNG/PDF) — chart export is client-side; PDF may reuse a server template.

## 6. Sequencing
U1 (now) → U2 → U4 → U5 → U3 → U6. (U3 auto-pipeline is higher-effort/backend-coupled,
so it lands after the review + reporting surfaces are usable; until then the Clusters
page's "Run Wildlife Brain" button is the manual trigger.)
