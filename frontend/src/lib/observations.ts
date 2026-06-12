/**
 * observations.ts — single source of truth for observation provenance + status.
 *
 * Milestone A (annotation-pipeline-review.md):
 *   AN-1  Every human create/edit records review provenance (review_status,
 *         reviewer_id, annotator_id) via the builders below — no surface writes
 *         these fields ad-hoc anymore.
 *   AN-2  `review_status` (then `source_type`) is the authoritative signal for the
 *         annotation badge. `isHumanReviewed` / `isAiLabel` encode that contract so
 *         MediaBrowser and MediaDetail all agree.
 *
 * Data model (ww-backend observations table):
 *   source_type            ai | human | imported | consensus   — who ORIGINATED the row
 *   review_status          unreviewed | ai_reviewed | human_reviewed
 *                          | expert_reviewed | consensus_approved — validation lifecycle
 *   classification_method  human | machine                     — who AUTHORED the label
 *   annotator_id           user FK — who first labelled
 *   reviewer_id            user FK — who verified
 */

// ── Status contract ──────────────────────────────────────────────────────────

/** Review states that mean "a human (or consensus) has validated this label". */
export const HUMAN_REVIEWED_STATES: ReadonlySet<string> = new Set([
  'human_reviewed',
  'expert_reviewed',
  'consensus_approved',
])

/** Minimal shape the status predicates need — every surface's row type satisfies it. */
export interface ObservationStatusFields {
  review_status?: string | null
  source_type?: string | null
  classification_method?: string | null
}

/**
 * True when a human has reviewed/validated this observation.
 * Primary signal: `review_status`. Legacy fallback (rows written before AN-1 that
 * lack a review_status): treat human-authored labels as reviewed.
 */
export function isHumanReviewed(o: ObservationStatusFields): boolean {
  if (o.review_status && HUMAN_REVIEWED_STATES.has(o.review_status)) return true
  if (!o.review_status && (o.classification_method === 'human' || o.source_type === 'human')) return true
  return false
}

/** True when this observation carries an AI-produced label (machine origin). */
export function isAiLabel(o: ObservationStatusFields): boolean {
  return (
    o.source_type === 'ai' ||
    o.classification_method === 'machine' ||
    o.review_status === 'ai_reviewed'
  )
}

// ── Provenance builders ──────────────────────────────────────────────────────

export interface Actor {
  /** Supabase auth uid — equals public.users.id (used for annotator_id / reviewer_id). */
  userId?: string | null
  /** Email, stored in the denormalised `classified_by` text column. */
  userEmail?: string | null
}

/**
 * Fields written when a human CREATES a brand-new observation (manual annotation).
 * Stamps full human provenance: origin, author, reviewer, and lifecycle state.
 */
export function humanCreateFields(actor: Actor) {
  const now = new Date().toISOString()
  const by = actor.userEmail ?? actor.userId ?? 'unknown'
  return {
    source_type: 'human',
    review_status: 'human_reviewed',
    classification_method: 'human',
    classified_by: by,
    classification_timestamp: now,
    annotator_id: actor.userId ?? null,
    reviewer_id: actor.userId ?? null,
  } as const
}

/**
 * Fields merged into an EXISTING observation when a human edits / confirms it.
 * Advances the validation lifecycle and records the reviewer, without clobbering
 * the original `source_type` (an AI-originated row stays source_type='ai', now
 * human_reviewed — meaningful "AI proposed, human verified" provenance).
 */
export function humanReviewFields(actor: Actor) {
  return {
    review_status: 'human_reviewed',
    classification_method: 'human',
    classified_by: actor.userEmail ?? actor.userId ?? 'unknown',
    classification_timestamp: new Date().toISOString(),
    reviewer_id: actor.userId ?? null,
  } as const
}
