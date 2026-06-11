// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
/* eslint-disable react-hooks/set-state-in-effect */
/**
 * InsightsPage — /insights
 *
 * Two sub-tabs via ?tab=reports|deployments (default reports).
 * Reports = ObservationReports + ChartBuilder. Deployments = table with a Table/Map
 * view toggle (the standalone Map gets its own home — the Field page — in P3; until
 * then it lives here as a view so nothing disappears).
 * Projects & members moved to Settings (P2).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProjectSelection } from '../hooks/useProjectSelection'
import { supabase } from '../config/supabase'
import { DataTable, type Column } from '../components/ui/DataTable'
import { FilterSelect } from '../components/ui/ControlBar'
import { Ribbon, type RibbonGroupDef } from '../components/ui/Ribbon'
import { DeploymentMap } from '../components/data/DeploymentMap'
import { ObservationReports } from '../components/data/ObservationReports'
import { ChartBuilder } from '../components/data/ChartBuilder'
import { DeploymentBulkActions } from '../components/data/DeploymentBulkActions'
import { type DeploymentRow } from '../components/data/DeploymentActionRow'

interface Observation {
  id: string
  deployment_id: string
  scientific_name: string | null
  observation_type: string | null
  created_at: string
}

type InsightsTab = 'reports' | 'deployments'
type DepView = 'table' | 'map'

const TABS: { id: InsightsTab; label: string }[] = [
  { id: 'reports',     label: '📊 Reports' },
  { id: 'deployments', label: '📍 Deployments' },
]

function formatDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : '—'
}

const VIEW_BTN = (active: boolean): React.CSSProperties => ({
  padding: '0.3rem 0.7rem', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--primary)' : 'transparent',
  color: active ? '#fff' : 'var(--text-color)', fontWeight: active ? 600 : 400,
})

export function InsightsPage() {
  const { user } = useAuth()
  const { selectedProjectIds } = useProjectSelection()
  const [searchParams, setSearchParams] = useSearchParams()

  const tab: InsightsTab = (searchParams.get('tab') as InsightsTab) === 'deployments' ? 'deployments' : 'reports'
  const setTab = (t: InsightsTab) => setSearchParams({ tab: t }, { replace: true })

  const [deployments,  setDeployments]  = useState<DeploymentRow[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [depLoading,   setDepLoading]   = useState(false)
  const [obsLoading,   setObsLoading]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [selectedDepId, setSelectedDepId] = useState<string | null>(null)
  const [depView, setDepView] = useState<DepView>('table')
  const [selectedDeps, setSelectedDeps] = useState<Set<string>>(new Set())

  const [reportFilterDep, setReportFilterDep]         = useState('')
  const [reportFilterSpecies, setReportFilterSpecies] = useState('')
  const [mapFilterSpecies, setMapFilterSpecies]       = useState('')

  // Load deployments (both tabs use them) ──────────────────────────────────
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setDepLoading(true)
    setError(null)

    let query = supabase
      .from('deployments')
      .select('id, project_id, location_name, latitude, longitude, deployment_start, deployment_end, created_at, projects(name), devices(name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (selectedProjectIds.length > 0) query = query.in('project_id', selectedProjectIds)

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
  }, [user, selectedProjectIds])

  // Load observations (reports always; map view when shown) ─────────────────
  useEffect(() => {
    if (!user) return
    if (tab !== 'reports' && !(tab === 'deployments' && depView === 'map')) return
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
  }, [user, tab, depView, deployments])

  const deploymentsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const o of observations) counts[o.deployment_id] = (counts[o.deployment_id] ?? 0) + 1
    return deployments.map(d => ({ ...d, observation_count: counts[d.id] ?? 0 }))
  }, [deployments, observations])

  const mapDeployments = useMemo(() => {
    if (!mapFilterSpecies) return deploymentsWithCounts
    const depIds = new Set(observations.filter(o => o.scientific_name === mapFilterSpecies).map(o => o.deployment_id))
    return deploymentsWithCounts.filter(d => depIds.has(d.id))
  }, [deploymentsWithCounts, observations, mapFilterSpecies])

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

  const deploymentColumns = useMemo<Column<DeploymentRow>[]>(() => [
    { key: 'project_name', label: 'Project', cellStyle: { fontWeight: 500 } },
    { key: 'device_name',  label: 'Device' },
    {
      key: 'location_name', label: 'Location',
      render: r => r.location_name || <span style={{ opacity: 0.4 }}>—</span>,
      getValue: r => r.location_name ?? '',
    },
    {
      key: 'gps', label: 'GPS', sortable: false,
      cellStyle: { fontFamily: 'monospace', fontSize: '0.75rem' },
      render: r => r.latitude && r.longitude
        ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}`
        : <span style={{ opacity: 0.4 }}>—</span>,
    },
    { key: 'deployment_start', label: 'Start', cellStyle: { fontSize: '0.75rem' }, render: r => formatDate(r.deployment_start) },
    { key: 'deployment_end',   label: 'End',   cellStyle: { fontSize: '0.75rem' }, render: r => formatDate(r.deployment_end) },
  ], [])

  const ribbonGroupsFor = (id: InsightsTab): RibbonGroupDef[] => {
    if (id === 'reports') {
      return [
        { id: 'deployment', title: 'Deployment', content: (
          <FilterSelect value={reportFilterDep} onChange={setReportFilterDep} options={depFilterOptions} placeholder="All deployments" />
        ) },
        { id: 'species', title: 'Species', content: (
          <FilterSelect value={reportFilterSpecies} onChange={setReportFilterSpecies} options={speciesOptions} placeholder="All species" />
        ) },
      ]
    }
    // deployments
    const groups: RibbonGroupDef[] = [{
      id: 'view', title: 'View', content: (
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <button style={VIEW_BTN(depView === 'table')} onClick={() => setDepView('table')}>📋 Table</button>
          <button style={VIEW_BTN(depView === 'map')}   onClick={() => setDepView('map')}>🗺 Map</button>
        </div>
      ),
    }]
    if (depView === 'map') {
      groups.push({ id: 'species', title: 'Species', content: (
        <FilterSelect value={mapFilterSpecies} onChange={setMapFilterSpecies} options={speciesOptions} placeholder="All species" />
      ) })
    } else {
      groups.push({ id: 'shown', title: 'Deployments', content: (
        <span style={{ fontSize: '0.8125rem', opacity: 0.7 }}><strong>{deployments.length}</strong> shown</span>
      ) })
    }
    return groups
  }

  return (
    <div>
      <Ribbon
        activeTabId={tab}
        onTabChange={id => setTab(id as InsightsTab)}
        tabs={TABS.map(t => ({ id: t.id, label: t.label, groups: ribbonGroupsFor(t.id) }))}
      />

      {error && <p style={{ color: 'var(--error)', marginBottom: '1rem' }}>⚠ {error}</p>}

      {/* ── Reports ──────────────────────────────────────────────────── */}
      {tab === 'reports' && (
        <>
          {reportFilterSpecies && (
            <div style={{ marginBottom: '0.75rem' }}>
              <Link
                to={`/annotations?species=${encodeURIComponent(reportFilterSpecies)}`}
                style={{ fontSize: '0.82rem', color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}
                title="Open the Annotations grid pre-filtered to this species to review/correct labels"
              >
                🏷️ Review “{reportFilterSpecies}” in Annotations →
              </Link>
            </div>
          )}
          <ObservationReports observations={filteredObservations} deployments={deployments} loading={obsLoading} />
          {!obsLoading && <ChartBuilder observations={filteredObservations} deployments={deployments} />}
        </>
      )}

      {/* ── Deployments (table or map) ───────────────────────────────── */}
      {tab === 'deployments' && (
        depLoading ? (
          <p style={{ opacity: 0.5 }}>Loading deployments…</p>
        ) : depView === 'map' ? (
          <DeploymentMap
            deployments={mapDeployments}
            selectedDeploymentId={selectedDepId}
            onSelectDeployment={setSelectedDepId}
          />
        ) : (
          <>
            <DeploymentBulkActions
              selected={selectedDeps}
              rows={deployments}
              onClear={() => setSelectedDeps(new Set())}
              onShowMap={() => setDepView('map')}
            />
            <DataTable<DeploymentRow>
              columns={deploymentColumns}
              rows={deployments}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search deployments…"
              exportFilename="deployments"
              emptyMessage="No deployments found for the selected project(s)."
              selectedKeys={selectedDeps}
              onSelectionChange={setSelectedDeps}
              pageSize={50}
            />
          </>
        )
      )}
    </div>
  )
}
