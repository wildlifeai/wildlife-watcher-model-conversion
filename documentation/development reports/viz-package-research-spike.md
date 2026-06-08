# Visualization Package Research Spike — WS-R

> **Task ID:** WS-R-T1 → WS-R-T3
> **Status:** 🔬 Open — assigned to team
> **Time-box:** 3–4 days total (see task breakdown below)
> **Output:** A decision memo (`docs/viz-package-decision.md`) + a working prototype branch
> **Blocks:** WS6-T3 (user-created visualisations in the Reports tab)

---

## 1. Why this decision matters

The Reports tab in `ResultsPage` today renders a **fixed Recharts dashboard**
([`ObservationReports.tsx`](../frontend/src/components/data/ObservationReports.tsx)):
a species bar chart, observation-type pie chart, per-deployment bar chart, and four KPI cards.

The product requirement is to let users **build their own charts** — choose chart type, axes, and
filters — and ideally save and share those views per project.

That requirement creates a fork in the road:

- **Stay on Recharts** — every user-defined chart type must be hand-coded as a new JSX component.
  "User-created" is then just a limited menu of pre-built options.
- **Adopt a spec-driven engine** — a chart is a *data structure* (a JSON spec). Users compose
  specs via a form UI; the engine renders them. Specs are serialisable → saveable → shareable.
  This is the approach that scales without linear engineering cost.

The risk of deciding *without* a spike is shipping a half-solution: bolting a form UI onto Recharts
that only supports the chart types someone already hard-coded, then having to rewrite it when the
spec model is adopted later. Alternatively, adopting the wrong library creates a different kind of
debt (bundle bloat, abandoned package, poor TypeScript support).

**This spike answers the question once, before a line of WS6-T3 code is written.**

---

## 2. Scope

### In scope
- Evaluate the four candidate libraries against the criteria in §4.
- Build a minimal throwaway prototype (one branch, never merged) demonstrating:
  - The current default dashboard (species bar + type pie) rendered via the chosen engine.
  - A "add chart" form that produces a new chart from live `observations` data without code changes.
- Produce a written recommendation with migration stance.

### Out of scope
- Implementing WS6-T3 (that follows from this spike's output).
- Evaluating non-charting libraries (maps, tables, etc.).
- Back-end changes (the spike is frontend only).
- GBIF, CamtrapDP, or any other feature.

---

## 3. Candidate libraries

| # | Library | Bundle (min+gz approx.) | Key characteristic |
|---|---|---|---|
| **A** | **Recharts** (status quo) | ~50 KB | Already in `package.json`. Declarative JSX components. Charts are code, not data. |
| **B** | **Vega-Lite via `react-vega`** | ~180 KB | Grammar-of-graphics. A chart is a JSON spec → serialisable. Industry standard for "user-defined" charts. |
| **C** | **Plotly via `react-plotly.js`** | ~3.4 MB (!) | Very rich interactivity. Config-driven. Large bundle — evaluate whether tree-shaking helps. |
| **D** | **Observable Plot** | ~55 KB | Concise JS API. Beautiful defaults. Specs are JS expressions, not plain JSON → harder to persist. |

Start with **B and A** (most likely winner vs. status quo). Evaluate C and D to rule them in or out.

---

## 4. Evaluation criteria

Score each candidate 1–5 on each criterion. Add notes. Produce a weighted total.

| # | Criterion | Weight | Rationale |
|---|---|---|---|
| **C1** | **User-defined charts as serialisable data** | ×3 | Can a user's chart be expressed as a plain JSON/object that can be saved to the database and loaded back without code? This is the primary requirement. |
| **C2** | **Default dashboard parity** | ×2 | Can the existing species bar + type pie + deployment bar + KPI cards be reproduced cleanly, without more code than today? |
| **C3** | **Bundle size impact** | ×2 | What does `vite build --analyze` show for the chunk containing this library? Recharts is the baseline (~50 KB). |
| **C4** | **TypeScript quality** | ×1 | Are types first-class (published by the library itself) or community `@types/*`? Are generics usable? |
| **C5** | **Maintenance health** | ×1 | npm weekly downloads, last release date, open issues trend, GitHub stars trajectory. |
| **C6** | **Learning curve / team familiarity** | ×1 | How long does it take a developer who hasn't used it to produce a working chart from the live data model? |
| **C7** | **Single-system convergence** | ×2 | Does adopting this library allow us to *eventually* remove Recharts entirely (one system), or does it sit alongside it permanently (two systems = the debt we're trying to avoid)? |

**Weighted scoring sheet** (fill in during spike):

|  | C1 ×3 | C2 ×2 | C3 ×2 | C4 ×1 | C5 ×1 | C6 ×1 | C7 ×2 | **Total /36** |
|---|---|---|---|---|---|---|---|---|
| A — Recharts | | | | | | | | |
| B — Vega-Lite | | | | | | | | |
| C — Plotly | | | | | | | | |
| D — Observable Plot | | | | | | | | |

---

## 5. Key questions to answer for each candidate

### C1 — Serialisable specs
- Can I represent "a bar chart of observation count by species, filtered to deployment X" as a
  plain JS object with no function values?
- Can that object be round-tripped through `JSON.stringify` / `JSON.parse` without loss?
- Is there a documented schema or type for the spec? (Vega-Lite has a full JSON Schema at
  `https://vega.github.io/schema/vega-lite/v5.json`.)
- What would the database column look like? (`JSONB` in Postgres / Supabase is ideal.)

### C2 — Default dashboard parity
- Reproduce `ObservationReports.tsx` using this library. How many lines of code vs. today?
- Does the library support horizontal bar charts, pie/donut charts, and vertical bar charts?
- Are tooltips, colour palettes, and responsive containers easy to configure?

### C3 — Bundle size
```bash
# In the prototype branch:
cd frontend
npm run build -- --mode analyze   # or use vite-bundle-analyzer
# Record: total JS size before vs. after adding the library
# Record: the specific chunk(s) the library lands in
```

### C4 — TypeScript
- Install and try: does `import { ... } from 'library'` give you autocomplete on chart config?
- Are there any `any` casts required to get a basic chart working?
- Check: is the library's own `tsconfig` strict? (`"strict": true` in its source repo.)

### C5 — Maintenance health
Check on **npm** and **GitHub**:
- Weekly download count (npm trends: `https://npmtrends.com/`)
- Date of last publish to npm
- Number of open vs. closed issues (ratio matters more than raw count)
- Any known breaking-change history or abandoned major versions

### C6 — Learning curve
Time yourself (or a teammate unfamiliar with the library) from `npm install` to a working
bar chart of `observations.scientific_name` counts. Record elapsed time and any blockers.

### C7 — Convergence path
- If we adopt this library for WS6-T3 (user charts), can the existing Recharts default dashboard
  be migrated to it in a future pass without rewriting the entire page?
- Or does the paradigm difference mean both libraries would coexist indefinitely?

---

## 6. Prototype specification

Build on a dedicated branch: `spike/viz-package-<library-name>` (one branch per serious candidate,
or one branch with multiple sub-folders if you prefer).

**The prototype must:**

1. **Render the existing default dashboard** — species bar, observation-type pie, per-deployment
   bar, KPI row — using the candidate library. Source data: the same `observations` array that
   `ObservationReports` receives today.

2. **Demonstrate a user-defined chart** — a minimal "add chart" form with:
   - Chart type selector (bar / pie / line at minimum).
   - X-axis field selector (e.g. `scientific_name`, `deployment_id`, `observation_type`).
   - Y-axis aggregation selector (`count`, `sum`).
   - On submit: renders the chart below the form.
   - The chart's config is represented as a plain JS object (log it to the console or
     display it as JSON beneath the chart).

3. **Not be merged** — this is throwaway prototype code. Create the branch, link it in the
   decision memo, then it can be deleted.

---

## 7. What the output should look like

### Decision memo (`docs/viz-package-decision.md`)

A short document (suggest 1–2 pages) covering:

1. **Recommendation** — one sentence: which library, and why.
2. **Scoring table** — the filled-in §4 table.
3. **Ruled-out candidates** — one paragraph each on why B/C/D were not chosen (or why A was kept).
4. **Migration stance** — one of:
   - *"Adopt X for user charts now; migrate Recharts defaults to X in a future pass (one system long-term)."*
   - *"Keep Recharts for defaults; use X only for user charts (two systems, accepted trade-off)."*
   - *"Stay on Recharts; implement user charts as pre-coded options (no spec model)."*
5. **Risks and open questions** — anything the team should know before WS6-T3 starts.
6. **Prototype branch link.**

### Sign-off

The memo needs sign-off from at least one other team member before WS6-T3 is started.
Record sign-off in the memo itself (name + date).

---

## 8. Task breakdown and time-box

| Task | Who | Time-box | Done when |
|---|---|---|---|
| **WS-R-T1** — Evaluate all four candidates against the criteria in §4–§5. Fill in the scoring table. | Researcher | 1 day | Scoring table complete with notes. |
| **WS-R-T2** — Build the prototype for the leading candidate(s) (usually B vs. A is enough). | Researcher | 1–2 days | Prototype branch exists; default dashboard + "add chart" form both work. |
| **WS-R-T3** — Write and get sign-off on `docs/viz-package-decision.md`. | Researcher + reviewer | 0.5 day | Decision memo merged; WS6-T3 unblocked. |

Total: **≤ 4 days**. If it takes longer, stop and discuss — the spike has gone out of scope.

---

## 9. Useful starting points

| Resource | URL |
|---|---|
| Vega-Lite documentation | https://vega.github.io/vega-lite/ |
| Vega-Lite JSON Schema explorer | https://vega.github.io/schema/vega-lite/v5.json |
| `react-vega` (Vega-Lite React wrapper) | https://github.com/vega/react-vega |
| Recharts documentation | https://recharts.org |
| Plotly React documentation | https://plotly.com/javascript/react/ |
| Observable Plot documentation | https://observablehq.com/plot/ |
| npm trends (compare all four) | https://npmtrends.com/recharts-vs-vega-lite-vs-plotly.js-vs-@observablehq/plot |
| Bundle size checker | https://bundlephobia.com |
| Our current `ObservationReports.tsx` | `frontend/src/components/data/ObservationReports.tsx` |
| Our current `package.json` | `frontend/package.json` |

---

## 10. Context for the researcher

**What we have today:**

`ObservationReports` is a fixed Recharts dashboard. Every chart is JSX — adding a new chart type
means a developer writes new code. The component receives an `observations` array and two
`deployments` arrays and does all aggregation client-side with `useMemo`.

**What the data model looks like:**

```ts
// The core data shape passed to the reports component
interface Observation {
  id: string
  deployment_id: string
  scientific_name: string | null   // e.g. "Felis catus"
  observation_type: string | null  // "animal" | "human" | "vehicle" | "blank"
  created_at: string               // ISO timestamp
}

interface Deployment {
  id: string
  location_name: string | null
  deployment_start: string | null
  deployment_end: string | null
}
```

**What a "user-defined chart" needs to express at minimum:**

```
{
  type: "bar" | "pie" | "line" | "scatter",
  x: "scientific_name" | "deployment_id" | "observation_type" | "date",
  y: "count" | "observation_type_count",
  filter: { deployment_id?: string; species?: string },
  title: string
}
```

The question is whether the candidate library's native spec language can express this *directly*
(so we just pass the spec to the renderer), or whether we'd need a translation layer between our
domain object and the library's config (more code, harder to persist cleanly).

**The Recharts default dashboard should be preserved** regardless of the decision — if a new
library is adopted for user charts, the fixed dashboard either stays as Recharts temporarily or
gets ported, depending on the migration stance chosen.

---

## 11. Definition of done for the spike

- [ ] Scoring table (§4) filled in for all four candidates.
- [ ] At least one prototype branch exists with default dashboard + "add chart" form.
- [ ] `docs/viz-package-decision.md` written and reviewed.
- [ ] Decision memo signed off by at least one team member.
- [ ] WS6-T3 ticket updated with a link to the decision memo.
