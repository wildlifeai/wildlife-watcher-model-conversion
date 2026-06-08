/* eslint-disable react-refresh/only-export-components */
/**
 * DeploymentActionRow
 * Lifecycle-nav buttons for a single deployment row.
 * Extracted from MyDataPage so ResultsPage can reuse it.
 */
import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useClusters } from '../../hooks/useBrain'
import { useRunPipeline } from '../../hooks/usePipeline'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeploymentRow {
  id: string
  project_id: string
  project_name?: string
  device_name?: string
  location_name: string | null
  latitude: number | null
  longitude: number | null
  deployment_start: string | null
  deployment_end: string | null
  created_at: string
  observation_count?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared button style
// ─────────────────────────────────────────────────────────────────────────────

export const NAV_BTN: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  fontSize: '0.75rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  backgroundColor: 'transparent',
  color: 'var(--primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

// ─────────────────────────────────────────────────────────────────────────────
// OverflowMenu — secondary actions behind a "⋯" button
// ─────────────────────────────────────────────────────────────────────────────

interface OverflowItem { label: string; onClick: () => void; title?: string }

export function OverflowMenu({ items }: { items: OverflowItem[] }) {
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
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ ...NAV_BTN, letterSpacing: '0.05em' }}
        title="More actions"
      >
        ⋯
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 40,
          backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          minWidth: '140px', padding: '0.25rem 0',
        }}>
          {items.map(item => (
            <button
              key={item.label}
              title={item.title}
              onClick={e => { e.stopPropagation(); setOpen(false); item.onClick() }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.4rem 0.75rem', fontSize: '0.8125rem',
                border: 'none', backgroundColor: 'transparent',
                color: 'var(--text-color)', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(76,175,80,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DeploymentActionRow
// ─────────────────────────────────────────────────────────────────────────────

export function DeploymentActionRow({ d }: { d: DeploymentRow }) {
  const navigate = useNavigate()
  const { data: brainData } = useClusters(d.id)
  const runPipeline = useRunPipeline()
  const [runMsg, setRunMsg] = useState<string | null>(null)

  const clusters  = brainData?.clusters ?? []
  const total     = clusters.length
  const confirmed = clusters.filter(c => c.review_state === 'confirmed').length
  const openCount = clusters.filter(c => c.review_state === 'open').length
  const hasRun    = !!brainData?.embedding_run_id

  // AN-10: run SpeciesNet inference on this deployment (synchronous backend call).
  const handleRunAi = () => {
    if (runPipeline.isPending) return
    if (!confirm('Run AI analysis (SpeciesNet) on this deployment? New AI observations will be created.')) return
    setRunMsg('🤖 Running AI analysis…')
    runPipeline.mutate(
      { deploymentId: d.id },
      {
        onSuccess: r => setRunMsg(`✓ AI done — ${r.total_observations} observations from ${r.total_media} media`),
        onError: e => setRunMsg(`⚠ AI run failed: ${(e as Error).message}`),
      },
    )
  }

  return (
    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
      {/* WS5-T6: deep-link into Annotations pre-filtered to this deployment */}
      <Link
        to={`/annotations?deployment=${d.id}`}
        onClick={e => e.stopPropagation()}
        style={{
          ...NAV_BTN,
          display: 'inline-flex',
          alignItems: 'center',
          textDecoration: 'none',
          fontWeight: 600,
        }}
        title="Browse & annotate images for this deployment"
      >
        🏷️ Annotate
      </Link>

      <button
        style={NAV_BTN}
        title="Browse images in this deployment"
        onClick={e => { e.stopPropagation(); navigate(`/explore/${d.id}`) }}
      >
        🖼 Explore
      </button>

      <button
        style={{ ...NAV_BTN, ...(hasRun && confirmed < total ? { fontWeight: 600 } : {}) }}
        title={hasRun ? `${confirmed} of ${total} clusters confirmed` : 'Run Wildlife Brain to generate clusters'}
        onClick={e => { e.stopPropagation(); navigate(`/clusters/${d.id}`) }}
      >
        ◧ Clusters{hasRun ? ` (${confirmed}/${total})` : ''}
      </button>

      <button
        style={{
          ...NAV_BTN,
          ...(openCount > 0 ? { color: 'var(--warning, #f59e0b)', borderColor: 'var(--warning, #f59e0b)' } : {}),
        }}
        title={openCount > 0 ? `${openCount} items pending review` : 'Active-learning review queue'}
        onClick={e => { e.stopPropagation(); navigate(`/review/${d.id}`) }}
      >
        ▶ Review{openCount > 0 ? ` (${openCount})` : ''}
      </button>

      <button
        style={NAV_BTN}
        title="Visualise embedding space"
        onClick={e => { e.stopPropagation(); navigate(`/umap/${d.id}`) }}
      >
        ✦ UMAP
      </button>

      <OverflowMenu items={[
        { label: runPipeline.isPending ? '🤖 Running AI…' : '🤖 Run AI analysis', title: 'Run SpeciesNet inference on this deployment', onClick: handleRunAi },
        { label: '📂 Events',   title: 'Group observation events', onClick: () => navigate(`/events/${d.id}`) },
        { label: '📊 Analyse',  title: 'Analyse science data',     onClick: () => navigate(`/analysis/${d.id}`) },
        { label: '📦 Report',   title: 'Generate reports',         onClick: () => navigate(`/reporting/${d.id}`) },
      ]} />

      {/* AN-10: inline run status */}
      {runMsg && (
        <span
          style={{
            fontSize: '0.75rem', whiteSpace: 'nowrap',
            color: runMsg.startsWith('⚠') ? 'var(--error, #f44336)' : 'var(--primary)',
            opacity: 0.9,
          }}
        >
          {runMsg}
        </span>
      )}
    </div>
  )
}

