# BE-3 — Persist User-Created Chart Specs per Project

> **Status:** 🕰️ Historical snapshot — point-in-time design/roadmap; **not** kept current with the code.

**Raised by:** Web frontend team  
**Blocks:** `ChartBuilder` save/load in `ResultsPage` (WS6-T3)  
**Priority:** Medium — ChartBuilder is live and functional; specs are lost on page reload  
**Effort estimate (backend):** S (single table + 2 RLS policies + 1 index)

---

## Background

`ChartBuilder.tsx` (`src/components/data/ChartBuilder.tsx`) lets users define custom
Vega-Lite visualisations against their observation data. Each chart is represented as
a `UserChartDef` — a fully serialisable plain-JSON object:

```typescript
interface UserChartDef {
  id:      string          // client-generated UUID
  type:    'bar' | 'line' | 'scatter' | 'heatmap'
  groupBy: 'species' | 'deployment' | 'hour' | 'date'
  title:   string
}
```

Currently `charts: UserChartDef[]` lives in React `useState` — it is **lost on every
page reload**. The spec builder (`buildVegaSpec`) is already written and the JSON is
ready to persist; we just need somewhere to store it.

---

## Requested schema change

### New table: `project_chart_specs`

```sql
create table project_chart_specs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  chart_def    jsonb not null,          -- serialised UserChartDef
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Fast lookup by project
create index on project_chart_specs (project_id);

-- Auto-update updated_at
create trigger set_updated_at
  before update on project_chart_specs
  for each row execute procedure moddatetime(updated_at);
```

### RLS policies required

```sql
-- Users can read chart specs for projects they have a role in
create policy "read own project charts"
  on project_chart_specs for select
  using (
    exists (
      select 1 from user_roles
      where user_roles.user_id   = auth.uid()
        and user_roles.scope_type = 'project'
        and user_roles.scope_id   = project_chart_specs.project_id
        and user_roles.is_active  = true
    )
  );

-- Users can insert/update/delete their own chart specs
create policy "manage own chart specs"
  on project_chart_specs for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
```

---

## Web frontend integration plan (no backend work needed beyond the schema)

Once the table exists the web will:

1. **Load on mount** — `supabase.from('project_chart_specs').select('chart_def').eq('project_id', projectId)` → hydrate `charts` state.
2. **Save on add** — `supabase.from('project_chart_specs').insert({ project_id, user_id, chart_def: def })`.
3. **Delete on remove** — `supabase.from('project_chart_specs').delete().eq('id', specId)`.

No new RPC or Edge Function needed — plain table access via the Supabase JS client.

---

## Acceptance criteria

- [ ] `project_chart_specs` table created in production Supabase instance.
- [ ] RLS: project members can read all specs for that project; users can only mutate their own.
- [ ] `moddatetime` trigger fires on update.
- [ ] Table exposed via Supabase auto-generated REST (default — no extra config needed).
- [ ] `npx supabase db diff` (or equivalent migration file) committed to `ww-backend`.

---

## Out of scope

- Sharing chart specs across organisations.
- Chart spec versioning / history.
- Exporting chart specs as standalone files (the `UserChartDef` JSON can be copy-pasted if needed).
