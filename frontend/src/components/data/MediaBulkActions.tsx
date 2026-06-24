// Copyright (c) 2026
// SPDX-License-Identifier: GPL-3.0-or-later
//
// MediaBulkActions — selection action bar for the Annotations grid, rendered
// inline at the left of the KPI row once at least one image is selected.
// Supports:
//  - Upload to iNaturalist (with connect/progress modals)
//  - Sync community IDs from iNaturalist
//  - Batch delete (with confirmation modal)
//  - Run AI models (with model picker + pipeline log modal)

import { useState, useRef, useEffect } from 'react'

export type BulkAction = 'inat' | 'delete' | 'ai' | 'similar' | 'label'

interface Props {
  selectedCount: number
  onSelectAll: () => void
  onClearSelection: () => void
  onAction: (action: BulkAction) => void
  inatConnected: boolean
}

export function MediaBulkActions({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onAction,
  inatConnected,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const none = selectedCount === 0

  const item: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    width: '100%', textAlign: 'left', padding: '0.5rem 0.875rem',
    fontSize: '0.8125rem', border: 'none', background: 'transparent',
    color: 'var(--text-color)', cursor: 'pointer',
  }
  const itemHover = 'rgba(76,175,80,0.08)'
  const run = (action: BulkAction) => { setOpen(false); onAction(action) }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.25rem 0.625rem', borderRadius: 'var(--radius)',
      background: none ? 'transparent' : 'rgba(76,175,80,0.08)',
      border: `1px solid ${none ? 'var(--border)' : 'rgba(76,175,80,0.3)'}`,
    }}>
      {/* Selection count — always shown (defaults to 0) */}
      <span style={{ fontSize: '0.82rem', fontWeight: 600, opacity: none ? 0.6 : 1 }}>
        ☑ {selectedCount} selected
      </span>

      {/* Select all / Clear */}
      <button
        onClick={onSelectAll}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '0.78rem', color: 'var(--primary)', padding: '0.2rem 0.4rem',
        }}
      >
        All
      </button>
      <button
        onClick={onClearSelection}
        disabled={none}
        style={{
          background: 'transparent', border: 'none', cursor: none ? 'default' : 'pointer',
          fontSize: '0.78rem', color: 'var(--primary)', padding: '0.2rem 0.4rem', opacity: none ? 0.4 : 1,
        }}
      >
        None
      </button>

      {/* Actions dropdown — disabled until something is selected */}
      <div ref={ref} style={{ position: 'relative', marginLeft: '0.5rem' }}>
        <button
          className="btn"
          style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem', opacity: none ? 0.5 : 1, cursor: none ? 'default' : 'pointer' }}
          disabled={none}
          onClick={() => setOpen(v => !v)}
        >
          Actions ▾
        </button>
        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
            minWidth: 220,
            background: 'var(--bg-color)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: '0.25rem 0',
          }}>
            {/* Label every selected image as one species (or blank). */}
            <button
              style={item}
              onMouseEnter={e => (e.currentTarget.style.background = itemHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => run('label')}
              title="Annotate all selected images with the same species (or 'nothing')"
            >
              <span>🏷️</span>
              <span>Label as…</span>
            </button>

            {selectedCount === 1 && (
              <button
                style={item}
                onMouseEnter={e => (e.currentTarget.style.background = itemHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => run('similar')}
                title="Show the images most visually similar to this one"
              >
                <span>🔎</span>
                <span>Find similar images</span>
              </button>
            )}

            <div style={{ height: 1, background: 'var(--border)', margin: '0.25rem 0' }} />

            <button
              style={item}
              onMouseEnter={e => (e.currentTarget.style.background = itemHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => run('inat')}
            >
              <span>🌿</span>
              <span>Upload to iNaturalist</span>
              {!inatConnected && <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>(connect first)</span>}
            </button>

            <button
              style={item}
              onMouseEnter={e => (e.currentTarget.style.background = itemHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => run('delete')}
            >
              <span>🗑</span>
              <span>Remove images</span>
            </button>

            <div style={{ height: 1, background: 'var(--border)', margin: '0.25rem 0' }} />

            <button
              style={item}
              onMouseEnter={e => (e.currentTarget.style.background = itemHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => run('ai')}
            >
              <span>🧠</span>
              <span>Run AI (re-classify)</span>
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
