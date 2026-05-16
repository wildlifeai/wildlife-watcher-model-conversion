import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

interface Observation {
  id: string
  deployment_id: string
  scientific_name: string | null
  observation_type: string | null
  created_at: string
}

interface Deployment {
  id: string
  location_name: string | null
  deployment_start: string | null
  deployment_end: string | null
}

interface ObservationReportsProps {
  observations: Observation[]
  deployments: Deployment[]
  loading?: boolean
}

const TYPE_COLOURS: Record<string, string> = {
  animal:  '#4caf50',
  human:   '#2196f3',
  vehicle: '#ff9800',
  blank:   '#9e9e9e',
  unknown: '#607d8b',
}

const CHART_COLOURS = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63',
  '#9c27b0', '#00bcd4', '#ff5722', '#795548',
  '#607d8b', '#cddc39',
]

export function ObservationReports({ observations, deployments, loading }: ObservationReportsProps) {
  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5, fontSize: '0.875rem' }}>
        Loading observations…
      </div>
    )
  }

  if (observations.length === 0) {
    return (
      <div style={{
        padding: '3rem',
        textAlign: 'center',
        opacity: 0.5,
        fontSize: '0.875rem',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        backgroundColor: 'var(--surface)',
      }}>
        No observations found. Add observations to your deployments to see reports here.
      </div>
    )
  }

  // ── Species breakdown (top 15) ─────────────────────────────────────────────
  const speciesCounts: Record<string, number> = {}
  for (const o of observations) {
    const name = o.scientific_name?.trim() || '(unidentified)'
    speciesCounts[name] = (speciesCounts[name] ?? 0) + 1
  }
  const speciesData = Object.entries(speciesCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }))

  // ── Observation type distribution ──────────────────────────────────────────
  const typeCounts: Record<string, number> = {}
  for (const o of observations) {
    const t = o.observation_type ?? 'unknown'
    typeCounts[t] = (typeCounts[t] ?? 0) + 1
  }
  const typeData = Object.entries(typeCounts).map(([name, value]) => ({ name, value }))

  // ── Activity per deployment (sorted by count) ──────────────────────────────
  const depCounts: Record<string, number> = {}
  for (const o of observations) {
    depCounts[o.deployment_id] = (depCounts[o.deployment_id] ?? 0) + 1
  }
  const depMap = Object.fromEntries(deployments.map(d => [d.id, d]))
  const depData = Object.entries(depCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id, count]) => ({
      name: depMap[id]?.location_name ?? id.slice(0, 8),
      count,
    }))

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '1.25rem',
  }

  const headingStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    fontWeight: 600,
    marginBottom: '1rem',
    opacity: 0.85,
  }

  const summaryCards = [
    { label: 'Total Observations', value: observations.length },
    { label: 'Unique Species', value: Object.keys(speciesCounts).filter(k => k !== '(unidentified)').length },
    { label: 'Active Deployments', value: new Set(observations.map(o => o.deployment_id)).size },
    { label: 'Animal Records', value: observations.filter(o => o.observation_type === 'animal').length },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Summary KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        {summaryCards.map(card => (
          <div key={card.label} style={{
            ...panelStyle,
            textAlign: 'center',
            padding: '1rem',
          }}>
            <div style={{ fontSize: '1.875rem', fontWeight: 700, color: 'var(--primary)' }}>
              {card.value.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Species breakdown + type pie */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem' }}>

        {/* Species bar chart */}
        <div style={panelStyle}>
          <div style={headingStyle}>Top Species by Observation Count</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={speciesData} layout="vertical" margin={{ left: 8, right: 24, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fontStyle: 'italic' }}
                width={140}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.8125rem' }}
                formatter={(v: unknown) => [typeof v === 'number' ? v : 0, 'observations']}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {speciesData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Observation type pie */}
        <div style={panelStyle}>
          <div style={headingStyle}>Observation Types</div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={typeData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="45%"
                outerRadius={90}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {typeData.map((entry, i) => (
                  <Cell key={i} fill={TYPE_COLOURS[entry.name] ?? CHART_COLOURS[i % CHART_COLOURS.length]} />
                ))}
              </Pie>
              <Legend iconSize={10} wrapperStyle={{ fontSize: '0.75rem' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.8125rem' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Activity by deployment */}
      {depData.length > 0 && (
        <div style={panelStyle}>
          <div style={headingStyle}>Observations per Deployment Location</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={depData} margin={{ left: 0, right: 16, top: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.8125rem' }}
                formatter={(v: unknown) => [typeof v === 'number' ? v : 0, 'observations']}
              />
              <Bar dataKey="count" fill="var(--primary)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
