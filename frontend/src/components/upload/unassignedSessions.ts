/**
 * Capture-session grouping for photos that arrive without a deployment.
 *
 * Kept apart from the component so both the modal (which needs to know whether
 * triage is required) and the triage screen itself can use it without breaking
 * fast refresh.
 */

/** A gap longer than this starts a new capture session. */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000

export interface TriageDeployment {
  id: string
  project_id: string
  location_name: string | null
}

export interface TriageSession {
  key: string
  /** Indices into the original files array. */
  indices: number[]
  firstMs: number
  lastMs: number
  /** MEDIA/<prefix> folder on the card, when the path carries one. */
  cardFolder: string | null
  /** Chosen deployment id, or null while unresolved. */
  deploymentId: string | null
  skipped: boolean
}

export function fmt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function span(a: number, b: number): string {
  const mins = Math.max(1, Math.round((b - a) / 60000))
  if (mins < 60) return `${mins} m`
  const h = Math.floor(mins / 60)
  return `${h} h ${mins % 60} m`
}

/** Group unresolved files into capture sessions by card folder + time gaps. */
export function buildSessions(
  files: File[],
  filePaths: string[],
  unresolved: number[],
): TriageSession[] {
  const rows = unresolved.map((i) => {
    const path = filePaths[i] ?? files[i].name
    const m = path.match(/MEDIA[/\\]([A-Fa-f0-9]{8})[/\\]/i)
    return { i, ms: files[i].lastModified || 0, folder: m ? m[1].toUpperCase() : null }
  })

  const byFolder = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.folder ?? '—'
    if (!byFolder.has(k)) byFolder.set(k, [])
    byFolder.get(k)!.push(r)
  }

  const out: TriageSession[] = []
  for (const [folder, list] of byFolder) {
    list.sort((a, b) => a.ms - b.ms)
    let cur: typeof list = []
    const flush = () => {
      if (!cur.length) return
      out.push({
        key: `${folder}-${out.length}`,
        indices: cur.map((r) => r.i),
        firstMs: cur[0].ms,
        lastMs: cur[cur.length - 1].ms,
        cardFolder: folder === '—' ? null : folder,
        deploymentId: null,
        skipped: false,
      })
      cur = []
    }
    for (const r of list) {
      if (cur.length && r.ms - cur[cur.length - 1].ms > SESSION_GAP_MS) flush()
      cur.push(r)
    }
    flush()
  }
  return out.sort((a, b) => a.firstMs - b.firstMs)
}
