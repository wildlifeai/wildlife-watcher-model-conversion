import { useState, useRef, useEffect } from 'react'

export interface ControlBarProps {
  /** Left slot — filters, selects, search inputs */
  filters?: React.ReactNode
  /** Right slot — action buttons (export, create, etc.) */
  actions?: React.ReactNode
  /**
   * When provided an "Advanced" button appears in the actions slot.
   * The callback receives the current open state so the caller can
   * open whatever modal it owns.
   */
  onAdvanced?: () => void
  advancedLabel?: string
  /** Stack filters + actions vertically on narrow containers */
  wrap?: boolean
}

export function ControlBar({
  filters,
  actions,
  onAdvanced,
  advancedLabel = 'Advanced',
  wrap = true,
}: ControlBarProps) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: wrap ? 'wrap' : 'nowrap',
      gap: '0.625rem',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.625rem 0',
      marginBottom: '1rem',
    }}>
      {/* Filters — left-aligned, can wrap */}
      {filters && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
        }}>
          {filters}
        </div>
      )}

      {/* Actions — right-aligned, no wrap */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {actions}
        {onAdvanced && (
          <button
            onClick={onAdvanced}
            style={{
              padding: '0.375rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              backgroundColor: 'transparent',
              color: 'var(--text-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            ⚙ {advancedLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterSelect — a styled <select> sized for use inside a ControlBar
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterSelectOption {
  value: string
  label: string
}

export interface FilterSelectProps {
  value: string
  onChange: (value: string) => void
  options: FilterSelectOption[]
  placeholder?: string
  style?: React.CSSProperties
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder = 'All',
  style,
}: FilterSelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '0.375rem 0.5rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--text-color)',
        fontSize: '0.8125rem',
        cursor: 'pointer',
        ...style,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchInput — a styled text input sized for use inside a ControlBar
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  style,
}: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: '0.375rem 0.625rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--text-color)',
        fontSize: '0.8125rem',
        minWidth: '160px',
        ...style,
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ColumnToggle — a dropdown for showing/hiding columns, used inside DataTable
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnToggleProps {
  columns: { key: string; label: string }[]
  hidden: Set<string>
  onToggle: (key: string) => void
}

export function ColumnToggle({ columns, hidden, onToggle }: ColumnToggleProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Show/hide columns"
        style={{
          padding: '0.375rem 0.625rem',
          fontSize: '0.8125rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          backgroundColor: 'transparent',
          color: 'var(--text-color)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        ☰ Columns
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 4px)',
          zIndex: 100,
          backgroundColor: 'var(--bg-color)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          padding: '0.375rem 0',
          minWidth: '160px',
        }}>
          {columns.map(col => {
            const isVisible = !hidden.has(col.key)
            return (
              <label
                key={col.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.35rem 0.75rem',
                  cursor: 'pointer',
                  fontSize: '0.8125rem',
                  userSelect: 'none',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(76,175,80,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => onToggle(col.key)}
                  style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                {col.label}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
