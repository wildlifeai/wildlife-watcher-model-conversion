// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// DeploymentBulkActions — selection toolbar for the Insights ▸ Deployments table.
// Replaces the per-row Actions column: the user ticks rows, then picks one action from
// this dropdown. Some actions only make sense for a single deployment (Results);
// those appear only when exactly one row is selected.
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectSelection } from '../../hooks/useProjectSelection'
import type { DeploymentRow } from './DeploymentActionRow'

interface Props {
  selected: Set<string>
  rows: DeploymentRow[]
  onClear: () => void
  onShowMap: () => void
}

function downloadCsv(rows: DeploymentRow[]) {
  const cols: (keyof DeploymentRow)[] = ['project_name', 'device_name', 'location_name', 'latitude', 'longitude', 'deployment_start', 'deployment_end']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc((r as any)[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = `deployments-selected-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export function DeploymentBulkActions({ selected, rows, onClear, onShowMap }: Props) {
  const navigate = useNavigate()
  const { clearAll, toggleProject } = useProjectSelection()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  if (selected.size === 0) return null

  const selectedRows = rows.filter(r => selected.has(r.id))
  const single = selectedRows.length === 1 ? selectedRows[0] : null

  const item: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '0.45rem 0.875rem',
    fontSize: '0.8125rem', border: 'none', background: 'transparent', color: 'var(--text-color)', cursor: 'pointer',
  }
  const run = (fn: () => void) => { setOpen(false); fn() }

  const openAnnotations = () => {
    if (single) { navigate(`/annotations?deployment=${single.id}`); return }
    clearAll()
    Array.from(new Set(selectedRows.map(r => r.project_id))).forEach(pid => toggleProject(pid))
    navigate('/annotations')
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem',
      padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
      background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.3)',
    }}>
      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{selected.size} selected</span>
      <div ref={ref} style={{ position: 'relative' }}>
        <button className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }} onClick={() => setOpen(v => !v)}>
          Actions ▾
        </button>
        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, minWidth: 200,
            background: 'var(--bg-color)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: '0.25rem 0',
          }}>
            <button style={item} onClick={() => run(openAnnotations)}>🏷️ Open in Annotations</button>
            <button style={item} onClick={() => run(onShowMap)}>🗺 Show on map</button>
            <button style={item} onClick={() => run(() => downloadCsv(selectedRows))}>📄 Export selected (CSV)</button>
            {single && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '0.25rem 0' }} />
                <button style={item} onClick={() => run(() => navigate(`/reporting/${single.id}`))}>📊 Results</button>
              </>
            )}
          </div>
        )}
      </div>
      <button onClick={onClear} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.78rem', opacity: 0.65 }}>
        Clear
      </button>
    </div>
  )
}
