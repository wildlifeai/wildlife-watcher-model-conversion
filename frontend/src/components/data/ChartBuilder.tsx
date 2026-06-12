/**
 * ChartBuilder — WS6-T3 user-defined visualisations.
 *
 * Each user chart is stored as a `UserChartDef` — a plain serialisable object
 * that fully describes the chart (type, groupBy, title). A `buildVegaSpec`
 * function converts it to a Vega-Lite spec for <VegaChart>.
 *
 * State is currently local (React useState). When BE-3 lands (a `saved_charts`
 * JSONB column in Supabase), replace the useState with a Supabase read/write
 * hook — the `UserChartDef[]` type is already JSON-safe.
 *
 * TODO(BE-3): persist charts to saved_charts column per project.
 */
import { useMemo, useState } from 'react'
import { VegaChart, VEGA_CONFIG } from '../ui/VegaChart'
import type { Observation, Deployment } from './ObservationReports'

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

export type ChartType = 'bar_h' | 'bar_v' | 'arc' | 'line'
export type GroupBy = 'scientific_name' | 'observation_type' | 'deployment' | 'month'

export interface UserChartDef {
  id: string
  title: string
  chartType: ChartType
  groupBy: GroupBy
}

// ─────────────────────────────────────────────────────────────────────────────
// Enriched observation (with location_name joined in)
// ─────────────────────────────────────────────────────────────────────────────

interface EnrichedObs extends Observation {
  location_name: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable labels
// ─────────────────────────────────────────────────────────────────────────────

const CHART_TYPE_OPTIONS: { value: ChartType; label: string }[] = [
  { value: 'bar_h', label: 'Horizontal bar' },
  { value: 'bar_v', label: 'Vertical bar' },
  { value: 'arc',   label: 'Pie / donut' },
  { value: 'line',  label: 'Line over time' },
]

const GROUP_BY_OPTIONS: { value: GroupBy; label: string; hint?: string }[] = [
  { value: 'scientific_name',  label: 'Species (scientific name)' },
  { value: 'observation_type', label: 'Observation type' },
  { value: 'deployment',       label: 'Deployment location' },
  { value: 'month',            label: 'Month (trend over time)', hint: 'Best with Line chart' },
]

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  scientific_name:  'Species',
  observation_type: 'Observation type',
  deployment:       'Deployment',
  month:            'Month',
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec builder
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildVegaSpec(chart: UserChartDef, data: EnrichedObs[]): Record<string, any> {
  const isMonth = chart.groupBy === 'month'
  const field = chart.groupBy === 'deployment'
    ? 'location_name'
    : chart.groupBy === 'month'
    ? 'created_at'
    : chart.groupBy

  // Vega-Lite field encoding for the group-by dimension
  const dimEncoding = isMonth
    ? { field, type: 'temporal', timeUnit: 'yearmonth', title: 'Month' }
    : {
        field,
        type: 'nominal',
        title: GROUP_BY_LABELS[chart.groupBy],
        ...(chart.groupBy === 'scientific_name' ? { axis: { labelFontStyle: 'italic', labelLimit: 160 } } : {}),
      }

  // Pre-filter transform (remove nulls for meaningful fields)
  const transforms = []
  if (chart.groupBy === 'scientific_name') {
    transforms.push({ filter: 'datum.scientific_name != null && datum.scientific_name !== ""' })
  }
  if (chart.groupBy === 'deployment') {
    transforms.push({ filter: 'datum.location_name != null && datum.location_name !== ""' })
  }

  const countEnc = { aggregate: 'count', type: 'quantitative', title: 'Count' }

  const tooltip = [
    isMonth
      ? { field, type: 'temporal', timeUnit: 'yearmonth', title: 'Month' }
      : { field, type: 'nominal', title: GROUP_BY_LABELS[chart.groupBy] },
    { aggregate: 'count', title: 'Count' },
  ]

  const colorEnc = isMonth
    ? { value: '#4caf50' }
    : {
        field,
        type: 'nominal',
        scale: { scheme: 'tableau10' },
        legend: chart.chartType === 'arc' ? { title: null } : null,
      }

  const base = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 'container',
    data: { values: data },
    transform: transforms,
    config: VEGA_CONFIG,
  }

  switch (chart.chartType) {
    case 'bar_h':
      return {
        ...base,
        height: 280,
        mark: { type: 'bar', cornerRadiusEnd: 3 },
        encoding: {
          y: { ...dimEncoding, sort: '-x', title: null },
          x: countEnc,
          color: colorEnc,
          tooltip,
        },
      }

    case 'bar_v':
      return {
        ...base,
        height: 280,
        mark: { type: 'bar', cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
        encoding: {
          x: { ...dimEncoding, sort: '-y', title: null, axis: { ...(dimEncoding as { axis?: object }).axis, labelAngle: -35 } },
          y: countEnc,
          color: colorEnc,
          tooltip,
        },
      }

    case 'arc':
      return {
        ...base,
        height: 260,
        mark: { type: 'arc', innerRadius: 50, outerRadius: 100 },
        encoding: {
          theta: countEnc,
          color: {
            field,
            type: 'nominal',
            scale: { scheme: 'tableau10' },
            legend: { title: null },
          },
          tooltip,
        },
      }

    case 'line':
      return {
        ...base,
        height: 260,
        mark: { type: 'line', point: true, strokeWidth: 2 },
        encoding: {
          x: { ...dimEncoding, axis: { labelAngle: -35 } },
          y: countEnc,
          color: isMonth ? undefined : {
            field,
            type: 'nominal',
            scale: { scheme: 'tableau10' },
            legend: { title: null },
          },
          tooltip,
        },
      }

    default:
      return base
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ChartBuilder component
// ─────────────────────────────────────────────────────────────────────────────

interface ChartBuilderProps {
  observations: Observation[]
  deployments: Deployment[]
}

// Form field state
interface FormState {
  title: string
  chartType: ChartType
  groupBy: GroupBy
}

const FORM_DEFAULT: FormState = {
  title: '',
  chartType: 'bar_h',
  groupBy: 'scientific_name',
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '0.375rem 0.625rem',
  fontSize: '0.8125rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  backgroundColor: 'var(--bg-color)',
  color: 'var(--text-color)',
  width: '100%',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  marginBottom: '0.25rem',
  opacity: 0.75,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}

export function ChartBuilder({ observations, deployments }: ChartBuilderProps) {
  const [charts, setCharts] = useState<UserChartDef[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(FORM_DEFAULT)

  // Enrich observations with deployment location_name (stable across renders)
  const enriched = useMemo<EnrichedObs[]>(() => {
    const depMap = Object.fromEntries(
      deployments.map((d) => [d.id, d.location_name ?? d.id.slice(0, 8)]),
    )
    return observations.map((o) => ({
      ...o,
      location_name: depMap[o.deployment_id] ?? o.deployment_id.slice(0, 8),
    }))
  }, [observations, deployments])

  const addChart = () => {
    const def: UserChartDef = {
      id: `chart-${Date.now()}`,
      title:
        form.title.trim() ||
        `${CHART_TYPE_OPTIONS.find((o) => o.value === form.chartType)?.label ?? form.chartType} by ${GROUP_BY_LABELS[form.groupBy]}`,
      chartType: form.chartType,
      groupBy: form.groupBy,
    }
    setCharts((prev) => [...prev, def])
    setForm(FORM_DEFAULT)
    setFormOpen(false)
  }

  const removeChart = (id: string) =>
    setCharts((prev) => prev.filter((c) => c.id !== id))

  const PANEL: React.CSSProperties = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '1.25rem',
  }

  return (
    <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '2px solid var(--border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>My Charts</h3>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8125rem', opacity: 0.6 }}>
            Add custom Vega-Lite charts. Specs are JSON-serialisable — ready to persist per project when BE-3 lands.
          </p>
        </div>
        <button
          className="btn"
          onClick={() => setFormOpen((v) => !v)}
          style={{ padding: '0.375rem 0.875rem', fontSize: '0.875rem', flexShrink: 0 }}
        >
          {formOpen ? '✕ Cancel' : '+ Add chart'}
        </button>
      </div>

      {/* Add chart form */}
      {formOpen && (
        <div style={{
          ...PANEL,
          marginBottom: '1.25rem',
          borderColor: 'var(--primary)',
          borderWidth: '1.5px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.875rem', alignItems: 'end' }}>
            {/* Title */}
            <div>
              <label style={LABEL_STYLE}>Title (optional)</label>
              <input
                style={INPUT_STYLE}
                type="text"
                placeholder="Auto-generated if blank"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            {/* Chart type */}
            <div>
              <label style={LABEL_STYLE}>Chart type</label>
              <select
                style={INPUT_STYLE}
                value={form.chartType}
                onChange={(e) => setForm((f) => ({ ...f, chartType: e.target.value as ChartType }))}
              >
                {CHART_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Group by */}
            <div>
              <label style={LABEL_STYLE}>Group by</label>
              <select
                style={INPUT_STYLE}
                value={form.groupBy}
                onChange={(e) => setForm((f) => ({ ...f, groupBy: e.target.value as GroupBy }))}
              >
                {GROUP_BY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}{o.hint ? ` (${o.hint})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Add button */}
            <button
              className="btn"
              onClick={addChart}
              style={{ padding: '0.375rem 1.25rem', fontSize: '0.875rem', alignSelf: 'end' }}
            >
              Add
            </button>
          </div>

          {/* Live preview hint */}
          <p style={{ margin: '0.625rem 0 0 0', fontSize: '0.75rem', opacity: 0.55 }}>
            Charts use your current observation data. Changing the Reports filters above will update them automatically.
          </p>
        </div>
      )}

      {/* Empty state */}
      {charts.length === 0 && !formOpen && (
        <div style={{
          ...PANEL,
          textAlign: 'center',
          padding: '2.5rem 1.5rem',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.35 }}>📈</div>
          <p style={{ opacity: 0.55, fontSize: '0.875rem', margin: 0 }}>
            No custom charts yet. Click <strong>+ Add chart</strong> to create one.
          </p>
        </div>
      )}

      {/* Chart grid */}
      {charts.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '1.25rem',
        }}>
          {charts.map((chart) => (
            <UserChartCard
              key={chart.id}
              chart={chart}
              data={enriched}
              onRemove={removeChart}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual chart card
// ─────────────────────────────────────────────────────────────────────────────

function UserChartCard({
  chart,
  data,
  onRemove,
}: {
  chart: UserChartDef
  data: EnrichedObs[]
  onRemove: (id: string) => void
}) {
  // Memoised spec — only re-builds when data or chart definition changes
  const spec = useMemo(() => buildVegaSpec(chart, data), [chart, data])

  return (
    <div style={{
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.875rem', opacity: 0.85 }}>
          {chart.title}
        </span>
        <button
          onClick={() => onRemove(chart.id)}
          title="Remove chart"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.875rem', color: 'var(--text-color)', opacity: 0.45,
            padding: '0.1rem 0.25rem', lineHeight: 1, flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Chart */}
      <VegaChart spec={spec} />

      {/* Spec badge (shows the definition is serialisable) */}
      <details style={{ marginTop: '0.25rem' }}>
        <summary style={{ fontSize: '0.7rem', opacity: 0.45, cursor: 'pointer', userSelect: 'none' }}>
          View chart spec (JSON)
        </summary>
        <pre style={{
          fontSize: '0.7rem',
          margin: '0.375rem 0 0 0',
          padding: '0.5rem',
          backgroundColor: 'var(--bg-color)',
          borderRadius: 4,
          overflowX: 'auto',
          maxHeight: '160px',
          opacity: 0.75,
        }}>
          {JSON.stringify({ chartType: chart.chartType, groupBy: chart.groupBy, title: chart.title }, null, 2)}
        </pre>
      </details>
    </div>
  )
}
