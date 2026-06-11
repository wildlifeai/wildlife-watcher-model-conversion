// Copyright (c) 2026
// SPDX-License-Identifier: GPL-3.0-or-later
//
// MediaBulkActions — unified floating selection toolbar for the Annotations grid.
// Replaces the old iNat-only selection mode. Supports:
//  - Upload to iNaturalist (with connect/progress modals)
//  - Batch delete (with confirmation modal)
//  - Run AI models (with model picker + pipeline log modal)

import { useState, useRef, useEffect } from 'react'

export type BulkAction = 'inat' | 'delete' | 'ai'

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

  if (selectedCount === 0) return null

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
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
      background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.3)',
      marginBottom: '0.75rem',
    }}>
      {/* Selection count */}
      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
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
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '0.78rem', color: 'var(--primary)', padding: '0.2rem 0.4rem',
        }}
      >
        None
      </button>

      {/* Actions dropdown */}
      <div ref={ref} style={{ position: 'relative', marginLeft: '0.5rem' }}>
        <button
          className="btn"
          style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}
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

      {/* Close selection mode */}
      <button
        onClick={onClearSelection}
        style={{
          marginLeft: 'auto', background: 'transparent', border: 'none',
          cursor: 'pointer', fontSize: '0.78rem', opacity: 0.65,
        }}
      >
        ✕ Clear
      </button>
    </div>
  )
}
