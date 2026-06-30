// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Time formatting helpers for rendering capture times in the *deployment's* local
// timezone rather than the viewer's browser timezone.
//
// media.timestamp is stored as a UTC instant. Each deployment carries an IANA
// timezone (deployments.timezone, e.g. "Pacific/Auckland"), resolved from its GPS
// coordinates. To show "the time where the photo was taken", we format that UTC
// instant in the deployment's zone. When the timezone is unknown (null, or not yet
// backfilled), we fall back to the browser's local zone — the previous behaviour.

/** A deployment timezone, or null/undefined when unknown (→ browser-local fallback). */
export type DeploymentTimezone = string | null | undefined

/** True if `tz` is a usable IANA zone the runtime's Intl supports. */
function isValidTz(tz: DeploymentTimezone): tz is string {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Format a UTC timestamp as a full date+time in the deployment's local zone,
 * with a short zone label (e.g. "9 Jun 2026, 10:44 NZST"). Falls back to the
 * browser zone when `tz` is unknown.
 */
export function formatCaptureTime(iso: string | null, tz: DeploymentTimezone): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  }
  if (isValidTz(tz)) opts.timeZone = tz
  try {
    return new Intl.DateTimeFormat(undefined, opts).format(d)
  } catch {
    return d.toLocaleString()
  }
}

/**
 * The hour-of-day (0–23) of a UTC instant *as seen in* the deployment's zone.
 * Used for day/night classification and activity-by-hour analyses so they reflect
 * the animal's local time, not the viewer's.
 */
export function hourInTimezone(iso: string | null, tz: DeploymentTimezone): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  if (!isValidTz(tz)) return d.getHours()
  try {
    const h = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: tz,
    }).format(d)
    // "24" can appear for midnight in some runtimes → normalise to 0.
    const n = parseInt(h, 10)
    return Number.isNaN(n) ? d.getHours() : n % 24
  } catch {
    return d.getHours()
  }
}

/** Hour-based day/night split in the deployment's local time: day = 06:00–18:00. */
export function getTimeOfDay(iso: string | null, tz: DeploymentTimezone): 'day' | 'night' {
  const h = hourInTimezone(iso, tz)
  if (h === null) return 'day'   // unknown → treat as day (no false exclusions)
  return h >= 6 && h < 18 ? 'day' : 'night'
}
