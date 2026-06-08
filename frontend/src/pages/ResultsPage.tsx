/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/preserve-manual-memoization */
/**
 * ResultsPage — /results
 *
 * Four sub-tabs selectable via ?tab=reports|map|deployments|projects.
 *
 * WS6-T3 (user-created visualisations) — ChartBuilder is rendered below
 * ObservationReports in the Reports tab.
 * WS6-T7 (create project form) and WS6-T8 (member management) are stubs
 * that display a clear call-to-action until those tasks land.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProjectSelection } from '../hooks/useProjectSelection'
import { supabase } from '../config/supabase'
import { DataTable, type Column } from '../components/ui/DataTable'
import { FilterSelect } from '../components/ui/ControlBar'
import { Ribbon, type RibbonGroupDef } from '../components/ui/Ribbon'
import { DeploymentMap } from '../components/data/DeploymentMap'
import { ObservationReports } from '../components/data/ObservationReports'
import { ChartBuilder } from '../components/data/ChartBuilder'
import { DeploymentActionRow, NAV_BTN, type DeploymentRow } from '../components/data/DeploymentActionRow'
import { CreateProjectModal, type CreatedProject } from '../components/data/CreateProjectModal'
import { ProjectMembersPanel } from '../components/data/ProjectMembersPanel'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string
  name: string
  description: string | null
  created_at: string
  deployment_count: number
  organisation_id: string
}

interface Observation {
  id: string
  deployment_id: string
  scientific_name: string | null
  observation_type: string | null
  created_at: string
}

type ResultsTab = 'projects' | 'deployments' | 'map' | 'reports'

const TABS: { id: ResultsTab; label: string }[] = [
  { id: 'projects',    label: '📂 Projects' },
  { id: 'deployments', label: '📍 Deployments' },
  { id: 'map',         label: '🗺 Map' },
  { id: 'reports',     label: '📊 Reports' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : '—'
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function ResultsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { selectedProjectIds, clearAll, toggleProject } = useProjectSelection()
  const [searchParams, setSearchParams] = useSearchParams()

  const tab: ResultsTab = (searchParams.get('tab') as ResultsTab) || 'projects'
  const setTab = (t: ResultsTab) => setSearchParams({ tab: t }, { replace: true })

  // ── Data ──────────────────────────────────────────────────────────────────

  const [projects,     setProjects]     = useState<ProjectRow[]>([])
  const [deployments,  setDeployments]  = useState<DeploymentRow[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [projLoading,  setProjLoading]  = useState(true)
  const [depLoading,   setDepLoading]   = useState(false)
  const [obsLoading,   setObsLoading]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [selectedDepId, setSelectedDepId] = useState<string | null>(null)

  // WS6-T7 / WS3-T2: Create Project modal
  // Auto-open when navigated here with ?create=true (e.g. from the zero-project empty state)
  const [createProjectOpen, setCreateProjectOpen] = useState(
    () => searchParams.get('create') === 'true'
  )
  // WS6-T8: Members drawer — stores { id, name, org_id } of the selected project
  const [membersProject, setMembersProject] = useState<{ id: string; name: string; org_id: string } | null>(null)

  // Report filter (local to tab)
  const [reportFilterDep, setReportFilterDep]     = useState('')
  const [reportFilterSpecies, setReportFilterSpecies] = useState('')

  // Map filter (WS6-T4)
  const [mapFilterSpecies, setMapFilterSpecies] = useState('')

  // Load projects
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setProjLoading(true)
    supabase
      .from('projects')
      .select('id, name, description, organisation_id, created_at, deployments(id)')
      .is('deployments.deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err.message); setProjLoading(false); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: ProjectRow[] = (data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          organisation_id: p.organisation_id,
          created_at: p.created_at,
          deployment_count: Array.isArray(p.deployments) ? p.deployments.length : 0,
        }))
        setProjects(rows)
        setProjLoading(false)
      })
    return () => { cancelled = true }
  }, [user])

  // Load deployments (non-projects tabs)
  useEffect(() => {
    if (!user || tab === 'projects') return
    let cancelled = false
    setDepLoading(true)
    setError(null)

    let query = supabase
      .from('deployments')
      .select('id, project_id, location_name, latitude, longitude, deployment_start, deployment_end, created_at, projects(name), devices(name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (selectedProjectIds.length > 0) {
      query = query.in('project_id', selectedProjectIds)
    }

    query.then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); setDepLoading(false); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data || []).map((d: any) => ({
        ...d,
        project_name: d.projects?.name ?? '—',
        device_name:  d.devices?.name  ?? '—',
        projects: undefined,
        devices:  undefined,
      })) as DeploymentRow[]
      setDeployments(rows)
      setDepLoading(false)
    })
    return () => { cancelled = true }
  }, [user, tab, selectedProjectIds])

  // Load observations for map + reports
  useEffect(() => {
    if (!user || (tab !== 'map' && tab !== 'reports')) return
    if (deployments.length === 0) return
    let cancelled = false
    setObsLoading(true)
    supabase
      .from('observations')
      .select('id, deployment_id, scientific_name, observation_type, created_at')
      .in('deployment_id', deployments.map(d => d.id))
      .is('deleted_at', null)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (!err) setObservations(data || [])
        setObsLoading(false)
      })
    return () => { cancelled = true }
  }, [user, tab, deployments])

  // Enrich deployments with observation counts (for map markers)
  const deploymentsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const o of observations) counts[o.deployment_id] = (counts[o.deployment_id] ?? 0) + 1
    return deployments.map(d => ({ ...d, observation_count: counts[d.id] ?? 0 }))
  }, [deployments, observations])

  // Map: optionally narrow to deployments where a species was observed (WS6-T4)
  const mapDeployments = useMemo(() => {
    if (!mapFilterSpecies) return deploymentsWithCounts
    const depIds = new Set(
      observations
        .filter(o => o.scientific_name === mapFilterSpecies)
        .map(o => o.deployment_id)
    )
    return deploymentsWithCounts.filter(d => depIds.has(d.id))
  }, [deploymentsWithCounts, observations, mapFilterSpecies])

  // Filtered observations for reports tab
  const filteredObservations = useMemo(() => {
    let obs = observations
    if (reportFilterDep)     obs = obs.filter(o => o.deployment_id === reportFilterDep)
    if (reportFilterSpecies) obs = obs.filter(o => o.scientific_name === reportFilterSpecies)
    return obs
  }, [observations, reportFilterDep, reportFilterSpecies])

  const speciesOptions = useMemo(() => {
    const names = new Set<string>()
    observations.forEach(o => { if (o.scientific_name) names.add(o.scientific_name) })
    return Array.from(names).sort().map(n => ({ value: n, label: n }))
  }, [observations])

  const depFilterOptions = useMemo(() =>
    deployments.map(d => ({ value: d.id, label: d.location_name || d.id.slice(0, 8) }))
  , [deployments])

  // ── Column definitions ───────────────────────────────────────────────────

  const projectColumns = useMemo<Column<ProjectRow>[]>(() => [
    {
      key: 'name',
      label: 'Name',
      cellStyle: { fontWeight: 500 },
    },
    {
      key: 'description',
      label: 'Description',
      render: r => r.description || <span style={{ opacity: 0.4 }}>—</span>,
      getValue: r => r.description ?? '',
    },
    {
      key: 'deployment_count',
      label: 'Deployments',
      cellStyle: { width: '100px' },
      getValue: r => String(r.deployment_count),
      render: r => r.deployment_count,
    },
    {
      key: 'created_at',
      label: 'Created',
      cellStyle: { width: '110px', fontSize: '0.75rem' },
      render: r => formatDate(r.created_at),
    },
    {
      key: '_actions',
      label: 'Actions',
      sortable: false,
      hideable: false,
      cellStyle: { width: '230px' },
      render: r => (
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          <button
            style={NAV_BTN}
            onClick={e => { e.stopPropagation(); clearAll(); toggleProject(r.id); setTab('deployments') }}
          >
            📍 Deployments
          </button>
          <button
            style={NAV_BTN}
            onClick={e => { e.stopPropagation(); clearAll(); toggleProject(r.id); setTab('map') }}
          >
            🗺 Map
          </button>
          <button
            style={NAV_BTN}
            onClick={e => { e.stopPropagation(); navigate(`/intelligence/${r.id}`) }}
            title="Dataset health dashboard"
          >
            📊 Health
          </button>
          <button
            style={{ ...NAV_BTN, color: 'var(--text-color)' }}
            onClick={e => { e.stopPropagation(); setMembersProject({ id: r.id, name: r.name, org_id: r.organisation_id }) }}
            title="Manage project members"
          >
            👥 Members
          </button>
        </div>
      ),
    },
  ], [clearAll, toggleProject, navigate, setMembersProject]) // eslint-disable-line react-hooks/exhaustive-deps

  const deploymentColumns = useMemo<Column<DeploymentRow>[]>(() => [
    { key: 'project_name', label: 'Project', cellStyle: { fontWeight: 500 } },
    { key: 'device_name',  label: 'Device' },
    {
      key: 'location_name',
      label: 'Location',
      render: r => r.location_name || <span style={{ opacity: 0.4 }}>—</span>,
      getValue: r => r.location_name ?? '',
    },
    {
      key: 'gps',
      label: 'GPS',
      sortable: false,
      cellStyle: { fontFamily: 'monospace', fontSize: '0.75rem' },
      render: r => r.latitude && r.longitude
        ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}`
        : <span style={{ opacity: 0.4 }}>—</span>,
    },
    {
      key: 'deployment_start',
      label: 'Start',
      cellStyle: { fontSize: '0.75rem' },
      render: r => formatDate(r.deployment_start),
    },
    {
      key: 'deployment_end',
      label: 'End',
      cellStyle: { fontSize: '0.75rem' },
      render: r => formatDate(r.deployment_end),
    },
    {
      key: '_actions',
      label: 'Actions',
      sortable: false,
      hideable: false,
      render: r => <DeploymentActionRow d={r} />,
    },
  ], [])

  // ── Render ───────────────────────────────────────────────────────────────

  // ── Ribbon: each Results sub-tab is a ribbon tab carrying its own controls ──
  const ribbonGroupsFor = (id: ResultsTab): RibbonGroupDef[] => {
    switch (id) {
      case 'projects':
        return [{
          id: 'create', title: 'Project',
          content: (
            <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => setCreateProjectOpen(true)} title="Create a new project">
              + New Project
            </button>
          ),
        }]
      case 'deployments':
        return [{
          id: 'view', title: 'Deployments',
          content: <span style={{ fontSize: '0.8125rem', opacity: 0.7 }}><strong>{deployments.length}</strong> shown</span>,
        }]
      case 'map':
        return [
          { id: 'species', title: 'Species', content: (
            <FilterSelect value={mapFilterSpecies} onChange={setMapFilterSpecies} options={speciesOptions} placeholder="All species" />
          ) },
          { id: 'shown', title: 'Shown', content: (
            <span style={{ fontSize: '0.8125rem', opacity: 0.65 }}>
              {mapFilterSpecies
                ? `${mapDeployments.length} / ${deploymentsWithCounts.length}`
                : deploymentsWithCounts.length} deployment{deploymentsWithCounts.length !== 1 ? 's' : ''}
            </span>
          ) },
        ]
      case 'reports':
        return [
          { id: 'deployment', title: 'Deployment', content: (
            <FilterSelect value={reportFilterDep} onChange={setReportFilterDep} options={depFilterOptions} placeholder="All deployments" />
          ) },
          { id: 'species', title: 'Species', content: (
            <FilterSelect value={reportFilterSpecies} onChange={setReportFilterSpecies} options={speciesOptions} placeholder="All species" />
          ) },
        ]
    }
  }

  return (
    <div>
      {/* ── Ribbon command bar (the sub-tab menu lives here) ──────── */}
      <Ribbon
        activeTabId={tab}
        onTabChange={id => setTab(id as ResultsTab)}
        tabs={TABS.map(t => ({ id: t.id, label: t.label, groups: ribbonGroupsFor(t.id) }))}
      />

      {error && <p style={{ color: 'var(--error)', marginBottom: '1rem' }}>⚠ {error}</p>}

      {/* ── Projects ──────────────────────────────────────────────────────── */}
      {tab === 'projects' && (
        <>
          {projLoading ? (
            <p style={{ opacity: 0.5 }}>Loading projects…</p>
          ) : (
            <DataTable<ProjectRow>
              columns={projectColumns}
              rows={projects}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search projects…"
              exportFilename="projects"
              emptyMessage="No projects found. Create a project in the Wildlife Watcher mobile app to get started."
              onRowClick={r => { clearAll(); toggleProject(r.id); setTab('deployments') }}
              selectedKeys={new Set(selectedProjectIds)}
              pageSize={50}
            />
          )}
        </>
      )}

      {/* ── Deployments ───────────────────────────────────────────────────── */}
      {tab === 'deployments' && (
        <>
          {depLoading ? (
            <p style={{ opacity: 0.5 }}>Loading deployments…</p>
          ) : (
            <DataTable<DeploymentRow>
              columns={deploymentColumns}
              rows={deployments}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search deployments…"
              exportFilename="deployments"
              emptyMessage="No deployments found for the selected project(s)."
              onRowClick={r => setSelectedDepId(prev => prev === r.id ? null : r.id)}
              selectedKeys={selectedDepId ? new Set([selectedDepId]) : undefined}
              pageSize={50}
            />
          )}
        </>
      )}

      {/* ── Map ───────────────────────────────────────────────────────────── */}
      {tab === 'map' && (
        <>
          {depLoading ? (
            <p style={{ opacity: 0.5 }}>Loading deployments…</p>
          ) : (
            <DeploymentMap
              deployments={mapDeployments}
              selectedDeploymentId={selectedDepId}
              onSelectDeployment={setSelectedDepId}
            />
          )}
        </>
      )}

      {/* ── Reports ───────────────────────────────────────────────────────── */}
      {tab === 'reports' && (
        <>
          <ObservationReports
            observations={filteredObservations}
            deployments={deployments}
            loading={obsLoading}
          />
          {!obsLoading && (
            <ChartBuilder
              observations={filteredObservations}
              deployments={deployments}
            />
          )}
        </>
      )}

      {/* ── WS6-T7: Create Project modal ──────────────────────────────────── */}
      <CreateProjectModal
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={(p: CreatedProject) => {
          // Prepend new project optimistically; a full reload isn't needed
          setProjects(prev => [{
            id:              p.id,
            name:            p.name,
            description:     null,
            organisation_id: '',
            created_at:      new Date().toISOString(),
            deployment_count: 0,
          }, ...prev])
          setCreateProjectOpen(false)
        }}
      />

      {/* ── WS6-T8: Project Members panel ─────────────────────────────────── */}
      {membersProject && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
        }}>
          {/* Scrim */}
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }}
            onClick={() => setMembersProject(null)}
          />
          {/* Drawer */}
          <div style={{
            position: 'relative', zIndex: 1,
            width: 'min(520px, 100vw)', height: '100%',
            backgroundColor: 'var(--surface)',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
            overflowY: 'auto',
            padding: '1.5rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: '1.0625rem' }}>Project Members</span>
              <button
                onClick={() => setMembersProject(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1, color: 'var(--text-color)', opacity: 0.6 }}
                title="Close"
              >✕</button>
            </div>
            <ProjectMembersPanel
              projectId={membersProject.id}
              projectName={membersProject.name}
              organisationId={membersProject.org_id}
            />
          </div>
        </div>
      )}
    </div>
  )
}

