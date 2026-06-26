/**
 * MultiSelect — a compact checklist dropdown for selecting several values.
 *
 * Mirrors FilterSelect's look but allows multiple choices. The trigger shows the
 * single label when one is picked, or "N <noun>s" for several, or `allLabel`
 * when nothing is selected (i.e. no filter).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Option { value: string; label: string }

interface Props {
  values: string[]
  onChange: (values: string[]) => void
  options: Option[]
  /** Shown on the trigger when nothing is selected. */
  allLabel?: string
  /** Singular noun for the "N nouns" summary (e.g. "deployment"). */
  noun?: string
}

export function MultiSelect({ values, onChange, options, allLabel = 'All', noun = 'item' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The menu renders in a portal (fixed position) so it overlays the grid
  // instead of being clipped by the ribbon's overflow:hidden.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Close on outside click (account for the portalled menu).
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Keep the menu anchored to the trigger while open (rAF-throttled). The first
  // position is computed synchronously in the trigger's onClick (so the menu
  // never flashes at stale coordinates); this only tracks scroll/resize.
  useEffect(() => {
    if (!open) return
    let frame = 0
    const place = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = ref.current?.getBoundingClientRect()
        if (r) setPos({ top: r.bottom + 4, left: r.left })
      })
    }
    // No initial place() — onClick already set the position synchronously.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])

  const summary = values.length === 0
    ? allLabel
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? `1 ${noun}`)
      : `${values.length} ${noun}s`

  const active = values.length > 0

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => {
          // Compute the position synchronously before opening so the portalled
          // menu renders at the right place on its very first frame.
          if (!open) {
            const r = ref.current?.getBoundingClientRect()
            if (r) setPos({ top: r.bottom + 4, left: r.left })
          }
          setOpen(o => !o)
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.35rem',
          padding: '0.375rem 0.5rem', borderRadius: 'var(--radius)',
          border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
          backgroundColor: active ? 'rgba(76,175,80,0.1)' : 'var(--surface)',
          color: active ? 'var(--primary)' : 'var(--text-color)',
          fontSize: '0.8125rem', cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 220,
        }}
        title={summary}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
        <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>▾</span>
      </button>

      {open && pos && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 400, minWidth: 220, maxWidth: 320,
          background: 'var(--bg-color)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border)', fontSize: '0.75rem' }}>
            <span style={{ opacity: 0.7 }}>{values.length} selected</span>
            {active && (
              <button onClick={() => onChange([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.75rem' }}>
                Clear
              </button>
            )}
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: '0.25rem 0' }}>
            {options.length === 0 && <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', opacity: 0.5 }}>No options</div>}
            {options.map(o => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={values.includes(o.value)} onChange={() => toggle(o.value)} style={{ accentColor: 'var(--primary)', cursor: 'pointer' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
