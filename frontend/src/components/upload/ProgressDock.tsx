/**
 * ProgressDock — fixed bottom-right upload progress indicator.
 *
 * Three visual states driven by `dockState` from UploadContext:
 *
 *   hidden     Nothing rendered.
 *   minimised  Compact pill: semaphore dot + label + expand button.
 *   medium     Card with full PipelineStatusBox + controls.
 *
 * "Full logs" navigates to /upload/logs (a dedicated page).
 *
 * Completion behaviour:
 *   success → automatically shows a "View Annotations" link in the dock.
 *   failure → shows a "View Logs" link.
 *   The user dismisses the dock manually via the × button.
 */
import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useUploadStore } from '../../contexts/UploadContext'
import { PipelineStatusBox } from '../toolkit/PipelineStatusBox'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function semaphoreColor(phase: string): string {
  switch (phase) {
    case 'completed': return 'var(--success, #4CAF50)'
    case 'failed':    return 'var(--error, #f44336)'
    case 'stalled':   return 'var(--warning, #FF9800)'
    default:          return 'var(--primary, #3b82f6)'
  }
}

function dockLabel(phase: string, totalFiles: number, activeJobPhase?: string | null): string {
  switch (phase) {
    case 'uploading':  return `Uploading ${totalFiles} image${totalFiles !== 1 ? 's' : ''}…`
    case 'processing':
      if (activeJobPhase === 'ai_pipeline') return 'Running AI analysis…'
      if (activeJobPhase === 'cleanup')     return 'Cleaning up…'
      return `Syncing ${totalFiles} image${totalFiles !== 1 ? 's' : ''} to Drive…`
    case 'stalled':    return 'Still working…'
    case 'completed':  return 'Upload & analysis complete'
    case 'failed':     return 'Upload failed'
    default:           return 'Upload'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ProgressDock() {
  const { pipelineState, phase, dockState, setDockState, clearUpload, uploadedDeploymentIds } = useUploadStore()
  const navigate = useNavigate()
  const prevPhaseRef = useRef<string>('')

  // Auto-expand from minimised to medium when upload starts
  useEffect(() => {
    if (
      dockState === 'minimised' &&
      (phase === 'uploading' || phase === 'processing')
    ) {
      // Keep minimised if user explicitly minimised
    }
  }, [phase, dockState])

  // When phase transitions to completed/failed, auto-expand if still minimised
  useEffect(() => {
    const prev = prevPhaseRef.current
    prevPhaseRef.current = phase

    if (
      (phase === 'completed' || phase === 'failed') &&
      prev !== 'completed' &&
      prev !== 'failed' &&
      dockState === 'minimised'
    ) {
      setDockState('medium')
    }

    // Auto-navigate to annotations on clean success (no failed jobs)
    if (
      phase === 'completed' &&
      prev !== 'completed' &&
      !pipelineState.jobs.some((j) => j.status === 'failed' || j.status === 'completed_with_errors')
    ) {
      // Don't force-navigate — show the link. Less disruptive.
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  if (dockState === 'hidden') return null

  const color = semaphoreColor(phase)
  // Active job's current backend phase — used to distinguish Drive sync vs AI analysis
  const activeJobPhase = pipelineState.jobs.find(
    (j) => j.status === 'processing' || j.status === 'in_progress',
  )?.currentPhase
  const label = dockLabel(phase, pipelineState.totalFiles, activeJobPhase)
  const isActive = phase === 'uploading' || phase === 'processing' || phase === 'stalled'
  const isDone = phase === 'completed' || phase === 'failed'
  const hasErrors = pipelineState.jobs.some(
    (j) => j.status === 'failed' || j.status === 'completed_with_errors',
  )

  // WS5-T6: smart link — deep-link to the exact deployment when only one was uploaded
  const annotationsLink = uploadedDeploymentIds.length === 1
    ? `/annotations?deployment=${uploadedDeploymentIds[0]}`
    : '/annotations'

  // ── Shared styles ──────────────────────────────────────────────────────────
  const DOCK_BASE: React.CSSProperties = {
    position: 'fixed',
    bottom: '1.25rem',
    right: '1.25rem',
    zIndex: 300,
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
    borderRadius: 'var(--radius)',
  }

  const BTN_ICON: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.2rem 0.35rem',
    borderRadius: '4px',
    color: 'var(--text-color)',
    fontSize: '0.875rem',
    opacity: 0.65,
    lineHeight: 1,
    flexShrink: 0,
  }

  // ── Minimised pill ─────────────────────────────────────────────────────────
  if (dockState === 'minimised') {
    return (
      <div
        style={{
          ...DOCK_BASE,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 0.875rem',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setDockState('medium')}
        title="Expand upload progress"
      >
        {/* Semaphore dot */}
        <span
          style={{
            display: 'inline-block',
            width: 9,
            height: 9,
            borderRadius: '50%',
            backgroundColor: color,
            flexShrink: 0,
            animation: isActive ? 'dock-pulse 1.5s ease-in-out infinite' : undefined,
          }}
        />
        <span style={{ fontSize: '0.8125rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <button
          style={BTN_ICON}
          onClick={(e) => { e.stopPropagation(); clearUpload() }}
          title="Dismiss"
        >
          ✕
        </button>
        <style>{`
          @keyframes dock-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%       { opacity: 0.4; transform: scale(0.75); }
          }
        `}</style>
      </div>
    )
  }

  // ── Medium card ────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        ...DOCK_BASE,
        width: '360px',
        backgroundColor: 'var(--bg-color)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* Card header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.625rem 0.875rem',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              display: 'inline-block',
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: color, flexShrink: 0,
              animation: isActive ? 'dock-pulse 1.5s ease-in-out infinite' : undefined,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <button
            style={BTN_ICON}
            onClick={() => navigate('/upload/logs')}
            title="View full logs"
          >
            ⤢
          </button>
          <button
            style={BTN_ICON}
            onClick={() => setDockState('minimised')}
            title="Minimise"
          >
            −
          </button>
          {isDone && (
            <button
              style={BTN_ICON}
              onClick={clearUpload}
              title="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Pipeline status box */}
      <div style={{ padding: '0.75rem' }}>
        <PipelineStatusBox state={pipelineState} phase={phase} />
      </div>

      {/* Completion CTA */}
      {isDone && (
        <div style={{
          padding: '0.625rem 0.875rem',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: '0.75rem', alignItems: 'center',
          backgroundColor: 'var(--surface)',
          fontSize: '0.8125rem',
        }}>
          {phase === 'completed' && !hasErrors && (
            <Link
              to={annotationsLink}
              style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}
              // Keep the upload state + logs around (minimised) instead of clearing,
              // so the user can still see what happened after navigating to Annotations.
              onClick={() => setDockState('minimised')}
            >
              🏷️ View Annotations →
            </Link>
          )}
          {(phase === 'failed' || hasErrors) && (
            <Link
              to="/upload/logs"
              style={{ color: 'var(--error, #f44336)', fontWeight: 600, textDecoration: 'none' }}
            >
              View full logs →
            </Link>
          )}
          <button
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: '0.8125rem',
              color: 'var(--text-color)', opacity: 0.6,
            }}
            onClick={clearUpload}
          >
            Dismiss
          </button>
        </div>
      )}

      <style>{`
        @keyframes dock-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </div>
  )
}
