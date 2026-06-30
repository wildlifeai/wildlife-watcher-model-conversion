// Copyright (c) 2026
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * LiveInsightsBanner — shown on the Insights page while a just-started upload is still being
 * classified by the AI. It makes clear that the reports below are based on a *partial* set of
 * automatic predictions (and how far along), and points the user to Annotations to review /
 * correct them. Reads the global upload store, so it appears regardless of where the upload
 * was kicked off — the user can upload, jump to Insights, and watch results fill in live.
 */
import { Link } from 'react-router-dom'
import { useUploadStore } from '../../contexts/UploadContext'
import { aiAnalysisStatus } from '../toolkit/pipelineProgress'

export function LiveInsightsBanner() {
  const { uploadedDeploymentIds, phase, pipelineState } = useUploadStore()

  // Nothing uploaded this session, or the dock was dismissed → no banner.
  if (uploadedDeploymentIds.length === 0 || phase === 'idle') return null

  const ai = aiAnalysisStatus(pipelineState)
  const done = phase === 'completed'
  const failed = phase === 'failed'

  // % of images classified by the AI: the analysis job's aggregate progress once it has
  // started. Before that (still uploading / queued) there's no AI job yet → "queued" state.
  const aiStarted = !!ai || done
  const pct = done ? 100 : ai ? Math.round(ai.progress * 100) : 0

  const annotationsLink = uploadedDeploymentIds.length === 1
    ? `/annotations?deployment=${uploadedDeploymentIds[0]}`
    : '/annotations'

  const accent = failed
    ? 'var(--error, #f44336)'
    : done
      ? 'var(--success, #4CAF50)'
      : 'var(--primary, #3b82f6)'

  const headline = failed
    ? '⚠ AI analysis failed for this upload — see the upload logs'
    : done
      ? '✅ AI analysis complete — all images classified'
      : aiStarted
        ? `🤖 Live results — based on ${pct}% of images classified by AI`
        : '🤖 AI analysis queued — results will appear here as images are classified'

  return (
    <div
      role="status"
      style={{
        marginBottom: '1rem',
        padding: '0.75rem 0.9rem',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--radius)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: accent }}>{headline}</span>
        <Link
          to={annotationsLink}
          style={{
            marginLeft: 'auto', fontSize: '0.82rem', fontWeight: 600,
            color: 'var(--primary)', textDecoration: 'none', whiteSpace: 'nowrap',
          }}
          title="Open the Annotations grid to review and correct the AI's automatic identifications"
        >
          🏷️ Review automatic identifications in Annotations →
        </Link>
      </div>

      {/* Thin progress track — only once the AI phase is under way. */}
      {!failed && aiStarted && (
        <div style={{ marginTop: '0.55rem', height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%', width: `${pct}%`, background: accent,
              borderRadius: 3, transition: 'width 0.4s ease',
            }}
          />
        </div>
      )}

      {!done && !failed && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', opacity: 0.65 }}>
          These reports update live as images are classified. Numbers are AI predictions — confirm or correct them in Annotations.
        </div>
      )}
    </div>
  )
}
