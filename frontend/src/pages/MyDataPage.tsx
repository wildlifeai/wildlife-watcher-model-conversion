import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../config/supabase'
import { useAuth } from '../hooks/useAuth'
import { DeploymentMap } from '../components/data/DeploymentMap'
import { ObservationReports } from '../components/data/ObservationReports'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
}

interface Deployment {
  id: string
  project_id: string
  project_name?: string
  device_name?: string
  location_name: string | null
  latitude: number | null
  longitude: number | null
  deployment_start: string | null
  deployment_end: string | null
  created_at: string
  observation_count?: number
}

interface Observation {
  id: string
  deployment_id: string
  scientific_name: string | null
  observation_type: string | null
  created_at: string
}

type Tab = 'projects' | 'deployments' | 'map' | 'reports'

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MyDataPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('projects')
  const [projects, setProjects] = useState<Project[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [loading, setLoading] = useState(true)
  const [obsLoading, setObsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<string>('')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // ── Fetch projects ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    setLoading(true)
    setError(null)
    supabase
      .from('projects')
      .select('id, name, description, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setProjects(data || [])
        setLoading(false)
      })
  }, [user])

  // ── Fetch deployments (with observation counts) ─────────────────────────────
  useEffect(() => {
    if (!user || tab === 'projects') return
    setLoading(true)
    setError(null)

    let query = supabase
      .from('deployments')
      .select('id, project_id, location_name, latitude, longitude, deployment_start, deployment_end, created_at, projects(name), devices(name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (selectedProject) query = query.eq('project_id', selectedProject)

    query.then(({ data, error: err }) => {
      if (err) { setError(err.message); setLoading(false); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data || []).map((d: any) => ({
        ...d,
        project_name: d.projects?.name ?? '—',
        device_name: d.devices?.name ?? '—',
        projects: undefined,
        devices: undefined,
      })) as Deployment[]
      setDeployments(rows)
      setLoading(false)
    })
  }, [user, tab, selectedProject])

  // ── Fetch observations for Map + Reports tabs ───────────────────────────────
  useEffect(() => {
    if (!user || (tab !== 'map' && tab !== 'reports')) return
    if (deployments.length === 0) return
    setObsLoading(true)

    const depIds = deployments.map(d => d.id)
    supabase
      .from('observations')
      .select('id, deployment_id, scientific_name, observation_type, created_at')
      .in('deployment_id', depIds)
      .is('deleted_at', null)
      .then(({ data, error: err }) => {
        if (!err) setObservations(data || [])
        setObsLoading(false)
      })
  }, [user, tab, deployments])

  // Enrich deployments with observation counts
  const deploymentsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const o of observations) counts[o.deployment_id] = (counts[o.deployment_id] ?? 0) + 1
    return deployments.map(d => ({ ...d, observation_count: counts[d.id] ?? 0 }))
  }, [deployments, observations])

  // ── Download CamtrapDP ZIP ──────────────────────────────────────────────────
  const downloadCamtrapDP = async () => {
    if (!selectedProject) {
      setExportError('Select a project first to download its CamtrapDP package.')
      return
    }
    setIsExporting(true)
    setExportError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('export-camtrap-dp', {
        body: { project_id: selectedProject },
      })
      if (fnErr) throw new Error(fnErr.message)

      // data is a Blob when the function returns binary
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `camtrapdp-${selectedProject}-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      setExportError(msg)
    } finally {
      setIsExporting(false)
    }
  }

  // ── Sorting / filtering ─────────────────────────────────────────────────────
  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const sortedProjects = useMemo(() => {
    const filtered = projects.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    if (sortCol) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filtered.sort((a: any, b: any) => {
        const va = a[sortCol] ?? ''; const vb = b[sortCol] ?? ''
        return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
      })
    }
    return filtered
  }, [projects, sortCol, sortAsc, search])

  const sortedDeployments = useMemo(() => {
    const filtered = deployments.filter(d =>
      !search ||
      (d.location_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.project_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.device_name || '').toLowerCase().includes(search.toLowerCase())
    )
    if (sortCol) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filtered.sort((a: any, b: any) => {
        const va = a[sortCol] ?? ''; const vb = b[sortCol] ?? ''
        return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
      })
    }
    return filtered
  }, [deployments, sortCol, sortAsc, search])

  // ── CSV download ────────────────────────────────────────────────────────────
  const downloadCsv = (filename: string, headers: string[], rows: (string | number | null)[][]) => {
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const exportProjectsCsv = () => downloadCsv('projects.csv',
    ['ID', 'Name', 'Description', 'Created'],
    sortedProjects.map(p => [p.id, p.name, p.description || '', p.created_at])
  )
  const exportDeploymentsCsv = () => downloadCsv('deployments.csv',
    ['ID', 'Project', 'Device', 'Location', 'Latitude', 'Longitude', 'Start', 'End', 'Created'],
    sortedDeployments.map(d => [d.id, d.project_name || '', d.device_name || '', d.location_name || '', d.latitude || '', d.longitude || '', d.deployment_start || '', d.deployment_end || '', d.created_at])
  )

  // ── Style helpers ────────────────────────────────────────────────────────────
  const renderSortIcon = (col: string) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: '4px', fontSize: '0.75rem' }}>
      {sortCol === col ? (sortAsc ? '▲' : '▼') : '⇅'}
    </span>
  )
  const thStyle: React.CSSProperties = {
    padding: '0.625rem 0.5rem', textAlign: 'left', cursor: 'pointer',
    userSelect: 'none', whiteSpace: 'nowrap', borderBottom: '2px solid var(--border)',
    fontSize: '0.8125rem', fontWeight: 600,
  }
  const tdStyle: React.CSSProperties = {
    padding: '0.5rem', borderBottom: '1px solid var(--border)', fontSize: '0.8125rem',
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'projects', label: '📂 Projects' },
    { id: 'deployments', label: '📍 Deployments' },
    { id: 'map', label: '🗺 Map' },
    { id: 'reports', label: '📊 Reports' },
  ]

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 style={{ marginBottom: '0.5rem' }}>My Wildlife Watcher Data</h2>
      <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
        Browse projects and deployments, explore observation maps and reports, download CamtrapDP packages, or import data from other tools.
      </p>



      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            onClick={() => { setTab(t.id); setSearch(''); setSortCol('') }}
            style={{
              padding: '0.625rem 1.25rem', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: tab === t.id ? 'var(--primary)' : 'var(--text-color)',
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer', marginBottom: '-2px',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Project filter (shared across non-projects tabs) */}
      {tab !== 'projects' && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            id="project-filter"
            value={selectedProject || ''}
            onChange={e => setSelectedProject(e.target.value || null)}
            style={{ padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-color)' }}
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {tab === 'deployments' && (
            <>
              <input
                type="text" placeholder="Search…" value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: '200px', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-color)' }}
              />
              <button className="btn" onClick={exportDeploymentsCsv} style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap' }}>
                ⬇ CSV
              </button>
              <button
                id="download-camtrapdp-btn"
                className="btn"
                onClick={downloadCamtrapDP}
                disabled={isExporting || !selectedProject}
                title={!selectedProject ? 'Select a project to download CamtrapDP' : 'Download CamtrapDP package (ZIP)'}
                style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap', opacity: !selectedProject ? 0.5 : 1 }}
              >
                {isExporting ? '⏳ Exporting…' : '📦 Download CamtrapDP'}
              </button>
            </>
          )}
        </div>
      )}

      {exportError && (
        <p style={{ color: 'var(--error, #f44336)', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>⚠ {exportError}</p>
      )}

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      {loading && tab !== 'map' && tab !== 'reports' && <p>Loading…</p>}

      {/* ── Projects tab ─────────────────────────────────────────────────── */}
      {tab === 'projects' && !loading && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text" placeholder="Search…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: '200px', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-color)' }}
            />
            <button className="btn" onClick={exportProjectsCsv} style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap' }}>
              ⬇ Download CSV
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle} onClick={() => handleSort('name')}>Name {renderSortIcon('name')}</th>
                  <th style={thStyle} onClick={() => handleSort('description')}>Description {renderSortIcon('description')}</th>
                  <th style={thStyle} onClick={() => handleSort('created_at')}>Created {renderSortIcon('created_at')}</th>
                  <th style={{ ...thStyle, cursor: 'default' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedProjects.length === 0 && (
                  <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', opacity: 0.5, padding: '2rem' }}>No projects found</td></tr>
                )}
                {sortedProjects.map(p => (
                  <tr key={p.id}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(76,175,80,0.04)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    style={{ transition: 'background-color 0.15s' }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{p.name}</td>
                    <td style={{ ...tdStyle, opacity: 0.7 }}>{p.description || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        <button onClick={() => { setSelectedProject(p.id); setTab('deployments') }}
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', backgroundColor: 'transparent', color: 'var(--primary)', cursor: 'pointer' }}>
                          Deployments →
                        </button>
                        <button onClick={() => { setSelectedProject(p.id); setTab('map') }}
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', backgroundColor: 'transparent', color: 'var(--primary)', cursor: 'pointer' }}>
                          Map →
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Deployments tab ──────────────────────────────────────────────── */}
      {tab === 'deployments' && !loading && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => handleSort('project_name')}>Project {renderSortIcon('project_name')}</th>
                <th style={thStyle} onClick={() => handleSort('device_name')}>Device {renderSortIcon('device_name')}</th>
                <th style={thStyle} onClick={() => handleSort('location_name')}>Location {renderSortIcon('location_name')}</th>
                <th style={thStyle} onClick={() => handleSort('latitude')}>GPS {renderSortIcon('latitude')}</th>
                <th style={thStyle} onClick={() => handleSort('deployment_start')}>Start {renderSortIcon('deployment_start')}</th>
                <th style={thStyle} onClick={() => handleSort('deployment_end')}>End {renderSortIcon('deployment_end')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedDeployments.length === 0 && (
                <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', opacity: 0.5, padding: '2rem' }}>No deployments found</td></tr>
              )}
              {sortedDeployments.map(d => (
                <tr key={d.id}
                  style={{ transition: 'background-color 0.15s', cursor: 'pointer' }}
                  onClick={() => setSelectedDeploymentId(d.id)}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(76,175,80,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{d.project_name}</td>
                  <td style={tdStyle}>{d.device_name}</td>
                  <td style={tdStyle}>{d.location_name || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                    {d.latitude && d.longitude ? `${Number(d.latitude).toFixed(4)}, ${Number(d.longitude).toFixed(4)}` : '—'}
                  </td>
                  <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{d.deployment_start ? new Date(d.deployment_start).toLocaleDateString() : '—'}</td>
                  <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{d.deployment_end ? new Date(d.deployment_end).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Map tab ──────────────────────────────────────────────────────── */}
      {tab === 'map' && (
        <>
          {loading ? <p>Loading deployments…</p> : (
            <DeploymentMap
              deployments={deploymentsWithCounts}
              selectedDeploymentId={selectedDeploymentId}
              onSelectDeployment={setSelectedDeploymentId}
            />
          )}
        </>
      )}

      {/* ── Reports tab ──────────────────────────────────────────────────── */}
      {tab === 'reports' && (
        <ObservationReports
          observations={observations}
          deployments={deployments}
          loading={obsLoading}
        />
      )}
    </div>
  )
}
