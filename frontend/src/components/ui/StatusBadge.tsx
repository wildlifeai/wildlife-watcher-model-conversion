/* eslint-disable react-refresh/only-export-components */
// ─────────────────────────────────────────────────────────────────────────────
// StatusBadge — annotation lifecycle state for a media item
//
// States
//   pending     grey  ⧗   No observations yet (unprocessed / pipeline running)
//   issue       red   ✕   Explicit pipeline error (reserved for BE-2)
//   ai          teal  AI  Identified by the ML model only
//   reviewed    green ✓   A human has reviewed / annotated this image
//
// Images with no observations show the colourless 'pending' badge so the grid
// reads as "still being processed" rather than alarming red errors. When BE-2
// lands (explicit per-media status field) genuine failures surface as 'issue'.
// ─────────────────────────────────────────────────────────────────────────────

export type AnnotationStatus = 'pending' | 'issue' | 'ai' | 'reviewed'

export interface StatusBadgeProps {
  status: AnnotationStatus
  /** 'sm' is the thumbnail overlay (compact), 'md' is inline in a list. */
  size?: 'sm' | 'md'
  /** Override the label. Useful for e.g. "AI 94%" */
  label?: string
}

interface BadgeStyle {
  bg: string
  border: string
  color: string
  icon: string
  defaultLabel: string
}

const STYLES: Record<AnnotationStatus, BadgeStyle> = {
  pending: {
    bg:           'rgba(107,114,128,0.55)',
    border:       'rgba(107,114,128,0.35)',
    color:        '#ffffff',
    icon:         '⧗',
    defaultLabel: 'Processing',
  },
  issue: {
    bg:           'rgba(239,68,68,0.88)',
    border:       'rgba(239,68,68,0.4)',
    color:        '#ffffff',
    icon:         '✕',
    defaultLabel: 'Error',
  },
  ai: {
    bg:           'rgba(20,184,166,0.88)',
    border:       'rgba(20,184,166,0.4)',
    color:        '#ffffff',
    icon:         '⚙',
    defaultLabel: 'AI',
  },
  reviewed: {
    bg:           'rgba(16,185,129,0.88)',
    border:       'rgba(16,185,129,0.4)',
    color:        '#ffffff',
    icon:         '✓',
    defaultLabel: 'Reviewed',
  },
}

export function StatusBadge({ status, size = 'sm', label }: StatusBadgeProps) {
  const s = STYLES[status]
  const isSm = size === 'sm'

  return (
    <span
      title={s.defaultLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSm ? '0.2rem' : '0.3rem',
        padding: isSm ? '1px 5px' : '2px 7px',
        borderRadius: '4px',
        border: `1px solid ${s.border}`,
        backgroundColor: s.bg,
        color: s.color,
        fontSize: isSm ? '0.625rem' : '0.75rem',
        fontWeight: 700,
        lineHeight: 1.4,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: isSm ? '0.6rem' : '0.7rem' }}>{s.icon}</span>
      {(!isSm || label) && (
        <span>{label ?? s.defaultLabel}</span>
      )}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — derive status from media/observation data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer an AnnotationStatus for a media item from its observations.
 *
 * AN-2 contract — `review_status` is authoritative (see lib/observations.ts):
 *   - `hasReviewed` — any observation a human has validated
 *                     (review_status human_reviewed / expert_reviewed / consensus_approved)
 *   - `hasAi`       — any observation carrying an AI-produced label
 *   - `hasError`    — an explicit pipeline error flag (reserved for BE-2)
 *
 * Precedence: error (✕) ▸ reviewed (✓) ▸ ai (teal) ▸ pending (⧗).
 * Fallback (no observations at all) → 'pending': the image is still working
 * its way through the pipeline, so show a neutral colourless badge instead of
 * a red error.
 *
 * Callers should derive `hasReviewed` / `hasAi` with `isHumanReviewed` /
 * `isAiLabel` from lib/observations.ts so every surface agrees.
 */
export function deriveAnnotationStatus({
  hasReviewed,
  hasAi,
  hasError = false,
}: {
  hasReviewed: boolean
  hasAi: boolean
  hasError?: boolean
}): AnnotationStatus {
  if (hasError)    return 'issue'
  if (hasReviewed) return 'reviewed'
  if (hasAi)       return 'ai'
  return 'pending' // no observations yet → still processing
}

