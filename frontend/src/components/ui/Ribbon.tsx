/**
 * Ribbon — a branded, Microsoft-Word-style command surface.
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ 🌿  [ Tab ][ Tab ][ Tab ]                         status… │  ← menu bar
 *   ├───────────────────────────────────────────────────────────────┤
 *   │  ⌄group⌄ │ ⌄group⌄ │ ⌄group⌄                    ⤢          │  ← ribbon body
 *   │  controls  controls   controls                              │
 *   │  CAPTION    CAPTION     CAPTION                              │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * - **Menu bar**: a leaf brand mark + ribbon tabs (controlled or uncontrolled)
 *   + an optional right-aligned status slot.
 * - **Ribbon body**: the active tab's grouped categories. Each group has its
 *   controls on top and a small caption underneath, divided like Word's ribbon.
 * - **Advanced settings**: an optional per-group dialog launcher (the ⤢ arrow),
 *   mirroring Word's group dialog-launcher.
 *
 * Used by the Annotations and Results command bars.
 */
import { useState } from 'react'

export interface RibbonGroupDef {
  id: string
  /** Caption shown beneath the group. */
  title: string
  content: React.ReactNode
  /** Optional dialog launcher (advanced settings) — renders the ⤢ corner arrow. */
  launcher?: () => void
  launcherTitle?: string
  /** Show a dot on the launcher to signal active advanced settings. */
  launcherActive?: boolean
}

export interface RibbonTabDef {
  id: string
  label: string
  icon?: string
  groups: RibbonGroupDef[]
}

export interface RibbonProps {
  tabs: RibbonTabDef[]
  /** Controlled active tab (e.g. wired to the page's own tab state). */
  activeTabId?: string
  /** Uncontrolled initial tab. */
  defaultTabId?: string
  onTabChange?: (id: string) => void
  /** Optional short wordmark next to the leaf brand mark. */
  brandLabel?: string
  /** Right-aligned status content in the menu bar (e.g. result counts). */
  status?: React.ReactNode
}

// ── Styles ───────────────────────────────────────────────────────────────────

const CONTAINER: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  overflow: 'hidden',
  backgroundColor: 'var(--surface)',
  marginBottom: '1.25rem',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
}

const MENUBAR: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  borderBottom: '1px solid var(--border)',
  background: 'linear-gradient(180deg, rgba(76,175,80,0.07), rgba(76,175,80,0))',
  minHeight: 40,
}

const BRAND: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '0 0.875rem', borderRight: '1px solid var(--border)', flexShrink: 0,
}

const BRAND_CHIP: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 6,
  background: 'linear-gradient(135deg, var(--primary, #4caf50), #2e7d32)',
  color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13,
  boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
}

const BRAND_WORD: React.CSSProperties = {
  fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.02em', opacity: 0.85, whiteSpace: 'nowrap',
}

const STATUS: React.CSSProperties = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center',
  fontSize: '0.75rem', opacity: 0.65, padding: '0 0.875rem', whiteSpace: 'nowrap',
}

const BODY: React.CSSProperties = {
  display: 'flex', alignItems: 'stretch',
  padding: '0.4rem 0.25rem', overflowX: 'auto',
}

const GROUP: React.CSSProperties = {
  position: 'relative', display: 'flex', flexDirection: 'column',
  justifyContent: 'space-between', padding: '0.3rem 0.875rem 0.2rem', minHeight: 62,
}

const GROUP_CONTENT: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: 1,
}

const GROUP_CAPTION: React.CSSProperties = {
  textAlign: 'center', fontSize: '0.625rem', textTransform: 'uppercase',
  letterSpacing: '0.05em', opacity: 0.5, marginTop: 6, fontWeight: 600, whiteSpace: 'nowrap',
}

const LAUNCHER: React.CSSProperties = {
  position: 'absolute', top: 2, right: 2, width: 18, height: 18,
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontSize: '0.7rem', lineHeight: 1, color: 'var(--text-color)', opacity: 0.45, padding: 0,
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '0 1rem', minHeight: 40, border: 'none', background: active ? 'var(--surface)' : 'transparent',
    cursor: 'pointer', fontSize: '0.8125rem', whiteSpace: 'nowrap',
    color: active ? 'var(--primary)' : 'var(--text-color)',
    fontWeight: active ? 700 : 500, opacity: active ? 1 : 0.72,
    boxShadow: active ? 'inset 0 -3px 0 0 var(--primary)' : 'none',
    transition: 'background 0.12s, opacity 0.12s',
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function Ribbon({ tabs, activeTabId, defaultTabId, onTabChange, brandLabel, status }: RibbonProps) {
  const [internal, setInternal] = useState(defaultTabId ?? tabs[0]?.id)
  const active = activeTabId ?? internal
  const setActive = (id: string) => { onTabChange?.(id); if (activeTabId === undefined) setInternal(id) }
  const current = tabs.find(t => t.id === active) ?? tabs[0]

  return (
    <div style={CONTAINER}>
      {/* ── Menu bar ──────────────────────────────────────── */}
      <div style={MENUBAR}>
        <div style={BRAND}>
          <span style={BRAND_CHIP} aria-hidden>🌿</span>
          {brandLabel && <span style={BRAND_WORD}>{brandLabel}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {tabs.map(t => {
            const on = t.id === active
            return (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                style={tabStyle(on)}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
              >
                {t.icon && <span style={{ marginRight: 6 }}>{t.icon}</span>}{t.label}
              </button>
            )
          })}
        </div>
        {status != null && <div style={STATUS}>{status}</div>}
      </div>

      {/* ── Ribbon body ───────────────────────────────────── */}
      <div style={BODY}>
        {current?.groups.map((g, i) => (
          <div
            key={g.id}
            style={{ ...GROUP, borderRight: i < current.groups.length - 1 ? '1px solid var(--border)' : 'none' }}
          >
            {g.launcher && (
              <button
                onClick={g.launcher}
                title={g.launcherTitle ?? 'More options'}
                style={{ ...LAUNCHER, opacity: g.launcherActive ? 0.95 : 0.45, color: g.launcherActive ? 'var(--primary)' : 'var(--text-color)' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = g.launcherActive ? '0.95' : '0.45')}
              >
                {g.launcherActive ? '⤢●' : '⤢'}
              </button>
            )}
            <div style={GROUP_CONTENT}>{g.content}</div>
            <div style={GROUP_CAPTION}>{g.title}</div>
          </div>
        ))}
        {(!current || current.groups.length === 0) && (
          <div style={{ padding: '0.6rem 0.875rem', fontSize: '0.75rem', opacity: 0.45 }}>
            No options for this view.
          </div>
        )}
      </div>
    </div>
  )
}
