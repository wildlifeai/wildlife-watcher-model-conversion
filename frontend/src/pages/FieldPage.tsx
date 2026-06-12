// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// FieldPage — /field
// Shows the cameras currently out in the field: every ACTIVE deployment (no end date,
// or an end date in the future) on a map + a status table. LoRaWAN heartbeat freshness
// (🟢 fresh · 🟠 stale · 🔴 silent) isn't wired yet — until the pipeline is live, cameras
// are simply shown as "Active — awaiting check-in". See ui-navigation-roadmap.md §Phase 3.
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProjectSelection } from '../hooks/useProjectSelection'
import { supabase } from '../config/supabase'
import { DataTable, type Column } from '../components/ui/DataTable'
import { DeploymentMap } from '../components/data/DeploymentMap'

interface ActiveDeployment {
  id: string
  project_id: string
  location_name: string | null
  latitude: number | null
  longitude: number | null
  deployment_start: string | null
  deployment_end: string | null
  project_name: string
  device_name: string
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0
}

export function FieldPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { selectedProjectIds } = useProjectSelection()
  const [rows, setRows] = useState<ActiveDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const nowIso = new Date().toISOString()

    let query = supabase
      .from('deployments')
      .select('id, project_id, location_name, latitude, longitude, deployment_start, deployment_end, projects(name), devices(name)')
      .is('deleted_at', null)
      .or(`deployment_end.is.null,deployment_end.gt.${nowIso}`)
      .order('deployment_start', { ascending: true })

    if (selectedProjectIds.length > 0) query = query.in('project_id', selectedProjectIds)

    query.then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = (data || []).map((d: any) => ({
        id: d.id,
        project_id: d.project_id,
        location_name: d.location_name,
        latitude: d.latitude,
        longitude: d.longitude,
        deployment_start: d.deployment_start,
        deployment_end: d.deployment_end,
        project_name: d.projects?.name ?? '—',
        device_name: d.devices?.name ?? '—',
      })) as ActiveDeployment[]
      setRows(mapped)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user, selectedProjectIds])

  // Longest-deployed first — those have been out the longest without a check-in, so
  // they're the most worth a look (this is where silent-first ordering plugs in later).
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (daysSince(b.deployment_start) ?? 0) - (daysSince(a.deployment_start) ?? 0)),
    [rows],
  )

  const withGps = rows.filter(d => d.latitude != null && d.longitude != null).length

  const columns = useMemo<Column<ActiveDeployment>[]>(() => [
    { key: 'project_name', label: 'Project', cellStyle: { fontWeight: 500 } },
    { key: 'device_name', label: 'Camera' },
    {
      key: 'location_name', label: 'Location',
      render: r => r.location_name || <span style={{ opacity: 0.4 }}>—</span>,
      getValue: r => r.location_name ?? '',
    },
    {
      key: 'deployment_start', label: 'Out for',
      getValue: r => String(daysSince(r.deployment_start) ?? -1),
      render: r => {
        const d = daysSince(r.deployment_start)
        return d == null ? <span style={{ opacity: 0.4 }}>—</span> : `${d} day${d !== 1 ? 's' : ''}`
      },
    },
    {
      key: '_checkin', label: 'Last check-in', sortable: false,
      render: () => (
        <span style={{ fontSize: '0.75rem', opacity: 0.55, fontStyle: 'italic' }}>Awaiting LoRaWAN</span>
      ),
    },
    {
      key: '_status', label: 'Status', sortable: false,
      render: () => (
        <span style={{
          fontSize: '0.72rem', fontWeight: 600, color: '#2563eb',
          background: 'rgba(37,99,235,0.1)', padding: '0.15rem 0.5rem', borderRadius: 12, whiteSpace: 'nowrap',
        }}>
          📡 Active
        </span>
      ),
    },
  ], [])

  return (
    <div>
      <h2 style={{ margin: '0 0 0.375rem 0' }}>📡 Field</h2>
      <p style={{ opacity: 0.65, fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
        Cameras currently out in the field — <strong>{rows.length}</strong> active deployment{rows.length !== 1 ? 's' : ''}.
      </p>

      {/* Honest banner: locations are real; heartbeat freshness isn't wired yet. */}
      <div style={{
        display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
        padding: '0.7rem 0.9rem', marginBottom: '1.25rem',
        background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: 'var(--radius)', fontSize: '0.8rem',
      }}>
        <span style={{ fontSize: '1rem' }}>ℹ️</span>
        <span style={{ opacity: 0.85, lineHeight: 1.5 }}>
          Cameras are shown as <strong>active</strong> based on their deployment dates. Daily
          LoRaWAN check-ins aren't flowing yet — once they are, each camera will show how recently
          it reported in (🟢 fresh · 🟠 stale · 🔴 silent) and silent cameras will be listed first.
        </span>
      </div>

      {error && <p style={{ color: 'var(--error)', marginBottom: '1rem' }}>⚠ {error}</p>}

      {loading ? (
        <p style={{ opacity: 0.5 }}>Loading field deployments…</p>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', opacity: 0.7 }}>
          <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>🏕️</div>
          <div style={{ fontWeight: 600 }}>No active deployments</div>
          <div style={{ fontSize: '0.85rem', opacity: 0.65, marginTop: '0.35rem' }}>
            Cameras appear here while they're deployed in the field (no end date, or an end date in
            the future).
          </div>
        </div>
      ) : (
        <>
          {withGps > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <DeploymentMap deployments={sorted} onSelectDeployment={() => {}} />
            </div>
          )}
          <DataTable<ActiveDeployment>
            columns={columns}
            rows={sorted}
            rowKey={r => r.id}
            searchable
            searchPlaceholder="Search cameras…"
            exportFilename="field-deployments"
            emptyMessage="No active deployments."
            onRowClick={r => navigate(`/explore/${r.id}`)}
            pageSize={50}
          />
        </>
      )}
    </div>
  )
}
