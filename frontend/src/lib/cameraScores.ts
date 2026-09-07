/**
 * The camera's own verdict on a frame, read from its EXIF.
 *
 * The WW500 scores every class of its on-device model and writes the result
 * into the frame's EXIF UserComment ("no person: 62%; person: 38%; "); ingest
 * parses that into media.exif_metadata.user_comment_fields. Only a target score
 * at or above the model's threshold becomes a 📟 Camera AI observation row, so a
 * frame the camera judged "no person" carries no observation at all and the
 * annotation panel showed no trace of the device's decision. These helpers
 * expose the raw scores for every frame, before and regardless of reflection.
 */

export interface CameraScore {
  label: string
  pct: number
}

/** UserComment keys that are device telemetry, not class scores. */
const TELEMETRY = /^(temp|batt|volt|rssi|snr)/i
const PERCENT = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/

/** Class scores from a media row's EXIF metadata, highest first; empty when there are none. */
export function cameraScores(exif: Record<string, unknown> | null | undefined): CameraScore[] {
  const fields = exif && typeof exif === 'object' ? (exif as { user_comment_fields?: unknown }).user_comment_fields : null
  if (!fields || typeof fields !== 'object') return []
  const out: CameraScore[] = []
  for (const [label, raw] of Object.entries(fields as Record<string, unknown>)) {
    if (TELEMETRY.test(label)) continue
    const m = PERCENT.exec(String(raw))
    if (!m) continue
    out.push({ label, pct: Math.round(parseFloat(m[1])) })
  }
  return out.sort((a, b) => b.pct - a.pct || a.label.localeCompare(b.label))
}

/** The camera model that scored the frame, when EXIF names it ("WW500 HM0360"). */
export function cameraModel(exif: Record<string, unknown> | null | undefined): string | null {
  const model = exif && typeof exif === 'object' ? (exif as { Model?: unknown }).Model : null
  return typeof model === 'string' && model.trim() ? model.trim() : null
}
