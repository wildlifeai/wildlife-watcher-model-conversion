# UI Redesign Report — Fitting 8 Field Personas with Minimum Clicks

*Point-in-time analysis (June 2026). Compares the current IA against the workflows of 8 target
users and evaluates three redesign options. Companion to
[ui-redesign-roadmap.md](./ui-redesign-roadmap.md).*

> **Decision (June 2026):** a direction was chosen from these variants — Toolkit · (conditional)
> Field · Annotations · Insights, with notifications + settings under the avatar menu.
> Implementation plan: [ui-navigation-roadmap.md](./ui-navigation-roadmap.md).

---

## 1. The current UI, as built

```
Header:  Wildlife Watcher | 🏷️ Annotations | 📊 Results | ⚙ Other   [Project ▾] [account ▾] [⬆ Upload]

Annotations  → MediaBrowser grid (filters: deployment, species, status, annotator, date/day-night)
               + MediaDetail modal (labels, confirm/reject, bbox) + iNaturalist ribbon tab
Results      → sub-tabs: Projects | Deployments | Map | Reports (KPIs + ChartBuilder/Vega)
Other        → grab-bag: Connect iNaturalist · Export for R · Prepare SD card (→ /manifest)
               · Upload AI model (→ /upload-model, org managers) · Publish to GBIF
Upload       → header modal → ProgressDock (bottom-right) → /upload/logs full view
Deep pages   → /explore /clusters /umap /review /events (per deployment) · /intelligence (per project)
```

### What exists vs. what each persona needs

| # | Persona | Today's path | Clicks* | Gaps found in code |
|---|---------|-------------|---------|--------------------|
| 1 | SD-card upload → results → fix odd species → export PNG | Upload ▸ dock ▸ Results▸Reports ▸ spot error ▸ Annotations ▸ filter species ▸ fix ▸ back ▸ export | ~10–12 | **No PNG export** (`VegaChart` sets `actions: false`); no "fix this species" deep-link from a chart to a pre-filtered Annotations grid |
| 2 | Prepare cameras: latest Himax firmware + model for SD cards | Other ▸ Prepare SD card ▸ pick firmware ▸ download | 3–4 | Works (`GenerateManifest` lists `firmware` type `himax`), but buried under "Other"; no batch "N cameras" packaging |
| 3 | Field status of 20 cameras (daily LoRaWAN heartbeat) | Results ▸ Map | 2 | **Map tooltip shows name only** — no last-seen, battery, or active/silent status. LoRaWAN data exists in backend (`lorawan_parsed_messages`, realtime enabled) but is not surfaced anywhere |
| 4 | Email alerts on rat detections; per-project notification prefs | — | n/a | **Does not exist** (no notifications UI or backend); no project-settings surface to put it on |
| 5 | Train skink model in Edge Impulse → upload → set default for project | Other ▸ Upload AI model | 3 + external | Upload/convert/versioning exists (`UploadModel`, Vela). **Missing: export labelled crops by species** (for EI training), and **"default model per project"** selector |
| 6 | Review all annotations in a project; push some to iNaturalist | Annotations ▸ filter ▸ open modal ▸ ←/→ keys ▸ iNat ribbon tab | 3–4 | Strong already (review verbs, keyboard nav, burst publish). Review-queue page exists but is per-deployment, not per-project |
| 7 | Plot pictures/day per species vs environment (altitude, temp, other species, date) | Results ▸ Reports ▸ ChartBuilder | 3 | ChartBuilder only plots species/dimension counts — **no environmental axes, no species-vs-species, no rate (pictures/day) normalisation** |
| 8 | Project admin: invite member as admin, set default trigger (timelapse…) | Results ▸ Projects ▸ members panel | 3 | Members panel exists; **no project settings page** (capture defaults, notifications, default model are scattered or absent) |

\* Clicks counted from a signed-in landing, excluding typing.

**Diagnosis.** The 3-tab IA is clean but optimised for one persona (the annotator). Three
structural problems generate most of the friction:

1. **"Other" is a junk drawer** — camera prep, model management, integrations, and exports
   (personas 2 & 5) hide behind an unscannable label.
2. **There is no "Field" surface** — the map is a sub-tab without camera health, although the
   LoRaWAN heartbeat data the personas need already lands in the database.
3. **There is no "Project Settings" surface** — members live in a Results sub-tab; notification
   prefs, capture defaults, and default-model have no home (personas 4, 5, 8).

---

## 2. Quick wins (independent of any redesign)

These remove persona friction without moving any furniture; all are small:

| Win | Persona | Effort |
|-----|---------|--------|
| `VegaChart actions: true` (Vega's built-in PNG/SVG export menu) | 1, 7 | one line |
| Chart → "fix these annotations" deep-link (`/annotations?species=X`, filter pre-applied — the grid already supports the param mechanism used by `?deployment=`) | 1 | small |
| Map markers coloured by heartbeat freshness (green <36 h, amber <72 h, red silent) + tooltip with last-seen/battery from `lorawan_parsed_messages` | 3 | medium |
| "Pictures per day" metric + numeric axes (altitude from `deployments`, date) in ChartBuilder | 7 | medium |
| Rename **⚙ Other → 🧰 Toolkit** with grouped sections | 2, 5 | trivial |

---

## 3. Three redesign options

### Option A — "Mission Control" home + 3 tabs kept

Post-login home becomes a task launcher of 6 cards (Upload SD card · Prepare cameras · Field
status · Review annotations · Charts & export · Project settings), each deep-linking into the
existing pages with filters pre-applied. A new **Project Settings** drawer (members, notifications,
defaults, default model) opens from the project selector. Everything else stays put.

| Clicks | 1: ~7 · 2: 2 · 3: 1 · 4: 2 · 5: 3 · 6: 2 · 7: 2 · 8: 2 |
|---|---|

**Advantages**
- Smallest engineering cost and zero retraining for existing users; ships incrementally.
- First click is intent-shaped for *every* persona; the home page doubles as onboarding.
- Keeps the grid-heavy Annotations page full-width (no sidebar tax).

**Disadvantages**
- Adds a layer without fixing the underlying IA — "Other" still exists behind a card.
- Two ways to reach everything (cards + tabs) — navigation truth gets blurry as features grow.
- Field status and notifications still have no first-class surface; they're links, not places.

---

### Option B — Lifecycle rail (recommended)

Replace the 3 tabs with a slim left rail mirroring the camera-trap lifecycle — the order a
practitioner actually works in:

```
▸ 🛠 Prepare    SD manifest · firmware · model library · Edge Impulse round-trip
▸ 📡 Field      camera map + health table (LoRaWAN last-seen, battery) · alert feed
▸ 🖼 Data       upload · annotations grid · review queue · iNaturalist
▸ 📈 Insights   KPIs · chart builder (env axes) · exports (PNG/R/GBIF)
▸ ⚙ Settings   project: members/roles · notifications · capture defaults · default model
```

Rail collapses to icons; Annotations keeps ~96% width. The upload dock stays global.

| Clicks | 1: ~6 · 2: 2 · 3: 1 · 4: 2 · 5: 2–3 · 6: 2 · 7: 2 · 8: 2 |
|---|---|

**Advantages**
- Every persona's first click is a named home: camera prep stops hiding (2, 5), Field gives the
  LoRaWAN health view a real page (3), Settings gives notifications/defaults/default-model one
  predictable address (4, 5, 8). "Other" dies.
- Scales: new features land inside a lifecycle stage instead of spawning tabs.
- Matches the mental model used in the field (prepare → deploy → collect → analyse), which makes
  it self-documenting for new conservation teams.

**Disadvantages**
- Largest navigation refactor of the three; every route and breadcrumb is touched, docs and
  screenshots go stale at once.
- A rail costs horizontal pixels on small laptops (mitigated by icon-collapse, but the
  annotation grid is the page users live in).
- Five top-level destinations is more to scan than three for the single-task hobbyist who only
  ever uploads and looks at pictures.

---

### Option C — Project-centric workspace

The project becomes the root object. Landing = project switcher; inside a project, contextual
tabs: **Overview** (health, recent uploads, alerts) · **Cameras** (map + heartbeats) · **Data**
(upload/annotations) · **Insights** · **Settings** (members, notifications, defaults, default
model). Org-level pages (model library, firmware, cross-project map) live under the org menu.

| Clicks | 1: ~6 · 2: 3 · 3: 2 · 4: 2 · 5: 3 · 6: 2 · 7: 2 · 8: 1–2 |
|---|---|

**Advantages**
- Mirrors how organisations actually operate ("the snail project", "the kiwi project") —
  settings, notifications, and default model are *naturally* project-scoped, which is exactly
  what personas 4, 5, and 8 ask for.
- Overview tab answers "is my project OK?" in zero clicks after selection.
- Permissions map cleanly (project tabs appear per role).

**Disadvantages**
- Cross-project work regresses: the all-cameras map for a 20-camera org, org model libraries,
  and multi-project exports all need an extra "org level" that duplicates structure.
- Heaviest migration: every URL becomes `/p/:projectId/...`; the global project *multi-select*
  (which the Results filters rely on today) has no clean equivalent.
- Solo users with one project pay a constant selection ceremony for no benefit.

---

## 4. Recommendation

**Ship the quick wins now**, then adopt **Option B** as the IA backbone, borrowing Option C's
best idea: the **Settings rail item is project-scoped** (driven by the existing global project
selector) so notifications, capture defaults, members, and default model land in one place
without re-rooting every URL.

Suggested order:

1. **Quick wins** (§2) — unblocks personas 1, 3, 7 within days.
2. **Rail shell + "Other" dissolution** — pure navigation move of existing pages (2, 5, 6).
3. **Field page** — map + health table from `lorawan_parsed_messages` (3).
4. **Project Settings** — members move in; add capture defaults + default-model selector (5, 8).
5. **Notifications** — backend (event rules → email/web/push) + prefs panel in Settings (4);
   biggest net-new build, last on purpose.
6. **Edge Impulse round-trip** — labelled-crop export by species in Prepare (5).

---

## 5. Per-persona click paths under the recommendation

| # | Path after redesign | Clicks |
|---|--------------------|--------|
| 1 | ⬆ Upload → dock auto-progress → dock "View results" → chart ⋯ → PNG · chart legend → "Fix species" → pre-filtered grid → fix → back | ~6 |
| 2 | Prepare → SD manifest (latest firmware pre-selected) → Download | 2 |
| 3 | Field (map opens with heartbeat colours; silent cameras listed first) | 1 |
| 4 | Settings → Notifications → toggle rat alerts (email/web/app) | 2 |
| 5 | Prepare → Export labelled images (species=skink) → [Edge Impulse] → Prepare → Upload model → Settings → Default model | 3 + external |
| 6 | Data → Annotations (project pre-scoped) → grid + ←/→ review → iNat ribbon → publish | 2 |
| 7 | Insights → Chart builder → Y: pictures/day per species · X: altitude/temp/date/other-species → PNG | 2 |
| 8 | Settings → Members → invite as admin · Settings → Capture defaults → timelapse | 2 |
