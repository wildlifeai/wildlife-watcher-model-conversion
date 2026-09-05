/**
 * Which optimistic "Uploading" cards are still worth showing.
 *
 * The Annotations grid shows a local preview for every file the user just
 * uploaded until its media row exists. Matching a ghost to its row by file name
 * never fires: the server renames frames on the way in (A9BC8A30.JPG becomes
 * 20260905194608_01.jpg), so on the 2026-09-05 bench run seven real rows sat
 * beside ten ghosts of the same photos until the run ended. Instead, every real
 * row that landed for a deployment since the upload started retires one ghost
 * of that deployment.
 */

export interface PendingItem {
  fileName: string
  deploymentId: string
}

export interface LandedRow {
  deployment_id: string
  file_name?: string | null
  created_at?: string | null
}

/** Rows created a little before `since` still count: clocks and job timing are not exact. */
export const LANDED_SLACK_MS = 60_000

export function survivingPending(
  pending: PendingItem[],
  rows: LandedRow[],
  since: number | null,
  viewIds: Set<string>,
): PendingItem[] {
  if (pending.length === 0) return []

  const haveNames = new Set<string>()
  const landed = new Map<string, number>()
  for (const r of rows) {
    if (r.file_name) haveNames.add(r.file_name.toLowerCase())
    if (since === null || !r.created_at) continue
    const t = Date.parse(r.created_at)
    if (!Number.isNaN(t) && t >= since - LANDED_SLACK_MS) {
      landed.set(r.deployment_id, (landed.get(r.deployment_id) ?? 0) + 1)
    }
  }

  const seen = new Set<string>()
  const out: PendingItem[] = []
  for (const p of pending) {
    const key = p.fileName.toLowerCase()
    if (!viewIds.has(p.deploymentId) || haveNames.has(key) || seen.has(key)) continue
    seen.add(key)
    const left = landed.get(p.deploymentId) ?? 0
    if (left > 0) {
      landed.set(p.deploymentId, left - 1)
      continue
    }
    out.push(p)
  }
  return out
}
