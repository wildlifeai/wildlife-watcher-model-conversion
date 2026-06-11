import { useState, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// MediaGroup — collapsible section that wraps a group of thumbnail cards.
//
// Used by MediaBrowser when a "group by" mode is active. Each group gets a
// header with the group name, item count, and a collapse toggle.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Display label for the group (e.g. species name, deployment name). */
  label: string
  /** Number of items in this group. */
  count: number
  /** Whether the group starts expanded (default true). */
  defaultOpen?: boolean
  /** Optional badge/icon rendered after the label. */
  badge?: ReactNode
  /** The thumbnail grid or content to render inside the group. */
  children: ReactNode
}

export function MediaGroup({ label, count, defaultOpen = true, badge, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      {/* Header row */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '100%',
          padding: '0.5rem 0.75rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          backgroundColor: 'rgba(255,255,255,0.03)',
          color: 'var(--text-color)',
          cursor: 'pointer',
          fontSize: '0.8125rem',
          fontWeight: 600,
          textAlign: 'left',
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)')}
      >
        {/* Collapse indicator */}
        <span style={{
          display: 'inline-block',
          width: '0.75rem',
          textAlign: 'center',
          fontSize: '0.6875rem',
          opacity: 0.6,
          transition: 'transform 0.2s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>
          ▶
        </span>

        {/* Label */}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>

        {/* Badge */}
        {badge}

        {/* Count */}
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 400,
          opacity: 0.55,
          flexShrink: 0,
        }}>
          {count} {count === 1 ? 'image' : 'images'}
        </span>
      </button>

      {/* Content (thumbnail grid) */}
      {open && (
        <div style={{ marginTop: '0.5rem', paddingLeft: '0.25rem' }}>
          {children}
        </div>
      )}
    </div>
  )
}
