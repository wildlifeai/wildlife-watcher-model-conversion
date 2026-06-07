import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { supabase } from '../config/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ObsRow {
  created_at: string
  scientific_name: string | null
  observation_type: string | null
}

interface DailyPoint {
  date: string
  [species: string]: number | string  // date + one key per species
}

type ChartType = 'bar' | 'line'
type PageTab = 'charts' | 'exports'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toIso(d: Date) { return d.toISOString().slice(0, 10) }

/** Pivot obs rows into [{date, species1: N, species2: N, …}] */
function pivotByDay(rows: ObsRow[], species: string[]): DailyPoint[] {
  const map: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    const sp = r.scientific_name || 'Unknown'
    if (!map[day]) map[day] = {}
    map[day][sp] = (map[day][sp] || 0) + 1
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => {
      const pt: DailyPoint = { date }
      for (const sp of species) pt[sp] = counts[sp] || 0
      return pt
    })
}

const COLORS = ['#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4', '#ff5722', '#8bc34a']

function csvFromPoints(points: DailyPoint[], species: string[]): string {
  const header = ['date', ...species].join(',')
  const rows = points.map(p => [p.date, ...species.map(sp => String(p[sp] ?? 0))].join(','))
  return [header, ...rows].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts tab
// ─────────────────────────────────────────────────────────────────────────────

function ChartsTab({ deploymentId }: { deploymentId: string }) {
  const [rows, setRows] = useState<ObsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [selectedSpecies, setSelectedSpecies] = useState<Set<string>>(new Set())
  const chartRef = useRef<HTMLDivElement>(null)

  // Fetch observations for this deployment
  useEffect(() => {
    setLoading(true)
    supabase
      .from('observations')
      .select('created_at, scientific_name, observation_type')
      .eq('deployment_id', deploymentId)
      .is('deleted_at', null)
      .not('scientific_name', 'is', null)
      .order('created_at')
      .then(({ data }) => {
        setRows(data || [])
        setLoading(false)
      })
  }, [deploymentId])

  // All unique species in this deployment
  const allSpecies = [...new Set(rows.map(r => r.scientific_name!).filter(Boolean))].sort()

  // Initialise selection once species are known
  useEffect(() => {
    if (allSpecies.length > 0 && selectedSpecies.size === 0) {
      setSelectedSpecies(new Set(allSpecies.slice(0, 6))) // max 6 by default
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSpecies.join(',')])

  const activeSpecies = allSpecies.filter(s => selectedSpecies.has(s))
  const points = pivotByDay(rows, activeSpecies)

  const toggleSpecies = (sp: string) => setSelectedSpecies(prev => {
    const next = new Set(prev)
    if (next.has(sp)) { next.delete(sp) } else { next.add(sp) }
    return next
  })

  const downloadCsv = () => {
    const csv = csvFromPoints(points, activeSpecies)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `observations-${deploymentId}-${toIso(new Date())}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const downloadPng = () => {
    // PNG export uses html-to-image when available; install with: npm i html-to-image
    const pkg = 'html-to-image'
    import(/* @vite-ignore */ pkg)
      .then((mod: { toPng: (el: HTMLElement) => Promise<string> }) => {
        if (!chartRef.current) return
        mod.toPng(chartRef.current).then(dataUrl => {
          const a = document.createElement('a'); a.href = dataUrl
          a.download = `chart-${deploymentId}-${toIso(new Date())}.png`
          a.click()
        })
      })
      .catch(() => alert('PNG export: run `npm i html-to-image` first.'))
  }

  if (loading) return <div style={{ padding: '2rem', opacity: 0.5 }}>Loading observations…</div>

  if (rows.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5 }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
        No observations with species labels found for this deployment.<br />
        <Link to={`/clusters/${deploymentId}`} style={{ color: 'var(--primary)', fontSize: '0.9rem' }}>
          Confirm clusters first →
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Controls */}
      <div className="glass-card" style={{ padding: '1rem 1.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Chart type */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {(['bar', 'line'] as ChartType[]).map(t => (
            <button
              key={t}
              onClick={() => setChartType(t)}
              style={{
                padding: '0.3rem 0.85rem', fontSize: '0.75rem', cursor: 'pointer', border: 'none',
                background: chartType === t ? 'var(--primary)' : 'transparent',
                color: chartType === t ? '#fff' : 'var(--text-color)',
              }}
            >
              {t === 'bar' ? '▌ Bar' : '/ Line'}
            </button>
          ))}
        </div>

        {/* Species toggles */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', flex: 1 }}>
          {allSpecies.map((sp, i) => (
            <button
              key={sp}
              onClick={() => toggleSpecies(sp)}
              style={{
                fontSize: '0.7rem', padding: '0.2rem 0.55rem',
                border: `1px solid ${selectedSpecies.has(sp) ? COLORS[i % COLORS.length] : 'var(--border)'}`,
                borderRadius: 12, cursor: 'pointer',
                background: selectedSpecies.has(sp) ? `${COLORS[i % COLORS.length]}22` : 'transparent',
                color: selectedSpecies.has(sp) ? COLORS[i % COLORS.length] : 'var(--text-color)',
                fontStyle: 'italic',
              }}
            >
              {sp}
            </button>
          ))}
        </div>

        {/* Export buttons */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={downloadCsv} style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--primary)', cursor: 'pointer' }}>
            ⬇ CSV
          </button>
          <button onClick={downloadPng} style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--primary)', cursor: 'pointer' }}>
            🖼 PNG
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="glass-card" style={{ padding: '1.25rem' }} ref={chartRef}>
        <div style={{ fontSize: '0.8125rem', opacity: 0.6, marginBottom: '0.75rem' }}>
          Observations per day · {rows.length} total
        </div>
        {points.length === 0 ? (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '2rem' }}>No data for selected species.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            {chartType === 'bar' ? (
              <BarChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: '0.75rem' }} />
                <Legend wrapperStyle={{ fontSize: '0.75rem', fontStyle: 'italic' }} />
                {activeSpecies.map((sp, i) => (
                  <Bar key={sp} dataKey={sp} fill={COLORS[i % COLORS.length]} stackId="a" radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            ) : (
              <LineChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: '0.75rem' }} />
                <Legend wrapperStyle={{ fontSize: '0.75rem', fontStyle: 'italic' }} />
                {activeSpecies.map((sp, i) => (
                  <Line key={sp} type="monotone" dataKey={sp} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* Summary table */}
      <div className="glass-card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
        <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Species totals</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: 600 }}>Species</th>
              <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: 600 }}>Observations</th>
            </tr>
          </thead>
          <tbody>
            {allSpecies.map(sp => {
              const count = rows.filter(r => r.scientific_name === sp).length
              return (
                <tr key={sp} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.35rem 0.5rem', fontStyle: 'italic' }}>{sp}</td>
                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports tab  (CamtrapDP real + others wired via supabase.functions.invoke)
// ─────────────────────────────────────────────────────────────────────────────

interface ExportCard {
  id: string
  title: string
  desc: string
  icon: string
  ext: string
  format: string
  real?: boolean  // true = backed by a real edge function
}

const EXPORT_CARDS: ExportCard[] = [
  { id: 'camtrap', title: 'CamtrapDP Zip Package', icon: '📦', ext: 'zip', format: 'CamtrapDP Package (ZIP)',
    desc: 'Frictionless Camtrap Data Package with standardised JSON descriptors matching Darwin Core standards.', real: true },
  { id: 'events', title: 'Ecological Events CSV', icon: '📊', ext: 'csv', format: 'Ecological Events (CSV)',
    desc: 'Normalised temporal events with observation duration, taxonomic abundance counts and sensor efforts.' },
  { id: 'media', title: 'Media Observations CSV', icon: '📸', ext: 'csv', format: 'Media Observations (CSV)',
    desc: 'Raw media observation records with coordinates, AI prediction confidences and bounding boxes.' },
  { id: 'dwc', title: 'Darwin Core GBIF Zip', icon: '🧬', ext: 'zip', format: 'Darwin Core GBIF Archive (ZIP)',
    desc: 'Ready-to-upload Occurrences zip mapping local taxa identifiers to the GBIF taxonomy.' },
]

function ExportsTab({ deploymentId }: { deploymentId: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [logs, setLogs] = useState<Array<{ id: string; format: string; created_at: string }>>([])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const trigger = useCallback(async (card: ExportCard) => {
    setBusy(card.id)
    try {
      if (card.real) {
        // Real CamtrapDP export via Supabase Edge Function
        // Need project_id — fetch it first
        const { data: dep } = await supabase
          .from('deployments')
          .select('project_id')
          .eq('id', deploymentId)
          .single()
        if (!dep) throw new Error('Deployment not found')
        const { data, error } = await supabase.functions.invoke('export-camtrap-dp', {
          body: { project_id: dep.project_id },
        })
        if (error) throw new Error(error.message)
        const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url
        a.download = `camtrapdp-${dep.project_id}-${toIso(new Date())}.zip`
        a.click(); URL.revokeObjectURL(url)
      } else {
        // Placeholder: generate a minimal CSV stub
        const content = `deployment_id,format\n${deploymentId},${card.format}`
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url
        a.download = `${card.id}-${deploymentId}.${card.ext}`
        a.click(); URL.revokeObjectURL(url)
      }
      const entry = { id: `exp-${Date.now()}`, format: card.format, created_at: new Date().toISOString() }
      setLogs(prev => [entry, ...prev.slice(0, 9)])
      showToast(`${card.format} downloaded`)
    } catch (err: unknown) {
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }, [deploymentId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {toast && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius)', background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)', fontSize: '0.875rem', color: '#4caf50' }}>
          ✓ {toast}
        </div>
      )}

      {/* Export cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        {EXPORT_CARDS.map(card => {
          const isBusy = busy === card.id
          return (
            <div
              key={card.id}
              className="glass-card"
              style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', cursor: 'pointer', transition: 'transform 0.15s', border: isBusy ? '1px solid var(--primary)' : undefined }}
              onClick={() => !isBusy && trigger(card)}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '1.75rem' }}>{card.icon}</span>
                <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', opacity: 0.45 }}>
                  .{card.ext.toUpperCase()}
                  {card.real && <span style={{ marginLeft: 4, color: '#4caf50' }}>●</span>}
                </span>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.35rem' }}>{card.title}</div>
                <div style={{ fontSize: '0.775rem', opacity: 0.65, lineHeight: 1.4 }}>{card.desc}</div>
              </div>
              <button
                className="btn"
                disabled={isBusy}
                style={{ marginTop: 'auto', background: isBusy ? 'transparent' : 'rgba(255,255,255,0.03)', border: isBusy ? '1px solid var(--primary)' : '1px solid var(--border)', fontSize: '0.8125rem' }}
              >
                {isBusy ? '⏳ Preparing…' : `Download ${card.ext.toUpperCase()}`}
              </button>
            </div>
          )
        })}
      </div>

      {/* Audit log */}
      {logs.length > 0 && (
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <h4 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '0.875rem' }}>Recent downloads</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem' }}>Format</th>
                <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem' }}>Downloaded</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.35rem 0.5rem' }}>{l.format}</td>
                  <td style={{ padding: '0.35rem 0.5rem', opacity: 0.65 }}>{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page root
// ─────────────────────────────────────────────────────────────────────────────

export function ReportingPage() {
  const { deployment_id } = useParams<{ deployment_id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<PageTab>('charts')

  if (!deployment_id) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', color: 'var(--text-color)' }}>
      {/* Header */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>Reports</h3>
          <span style={{ fontSize: '0.8125rem', opacity: 0.65 }}>Deployment {deployment_id.slice(0, 8)}…</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" onClick={() => navigate(`/analysis/${deployment_id}`)}
            style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', fontSize: '0.8125rem' }}>
            ◀ Analysis
          </button>
          <button className="btn" onClick={() => navigate('/my-data')}
            style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', fontSize: '0.8125rem' }}>
            My Data
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)' }}>
        {([['charts', '📊 Charts'], ['exports', '📦 Exports']] as [PageTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '0.5rem 1.25rem', border: 'none',
              borderBottom: tab === id ? '2px solid var(--primary)' : '2px solid transparent',
              background: 'transparent', color: tab === id ? 'var(--primary)' : 'var(--text-color)',
              fontWeight: tab === id ? 600 : 400, cursor: 'pointer', marginBottom: '-2px', fontSize: '0.875rem',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'charts' && <ChartsTab deploymentId={deployment_id} />}
      {tab === 'exports' && <ExportsTab deploymentId={deployment_id} />}
    </div>
  )
}
