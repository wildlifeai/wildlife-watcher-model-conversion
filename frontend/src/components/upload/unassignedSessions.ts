/**
 * Capture-session grouping for photos that arrive without a deployment.
 *
 * Kept apart from the component so both UploadFlow (which needs to know whether
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
  /**
   * The deployment UUID the camera stamped into these frames' EXIF (0xF200),
   * when present. Authoritative over the folder: it names the deployment the
   * device was configured with, and the folder can lag it (ww-website#140).
   */
  exifDeploymentId: string | null
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

/** The MEDIA/<8-hex>/ folder in a card path, upper-cased, or null. */
export function cardFolderOf(path: string): string | null {
  const m = path.match(/MEDIA[/\\]([A-Fa-f0-9]{8})[/\\]/i)
  return m ? m[1].toUpperCase() : null
}

/**
 * Group unresolved files into capture sessions, by the EXIF deployment id when
 * the frames carry one, else by card folder, then by time gaps within a group.
 *
 * Grouping by the EXIF id first is what puts a frame that landed in the wrong
 * folder (MEDIA/00000000/, created before the id was set) back with its run.
 */
export function buildSessions(
  files: File[],
  filePaths: string[],
  unresolved: number[],
  exifIds: (string | null)[] = [],
): TriageSession[] {
  const rows = unresolved.map((i) => {
    const path = filePaths[i] ?? files[i].name
    return { i, ms: files[i].lastModified || 0, folder: cardFolderOf(path), exifId: exifIds[i] ?? null }
  })

  const byGroup = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.exifId ? `exif:${r.exifId}` : r.folder ? `folder:${r.folder}` : '—'
    if (!byGroup.has(k)) byGroup.set(k, [])
    byGroup.get(k)!.push(r)
  }

  const out: TriageSession[] = []
  for (const [group, list] of byGroup) {
    list.sort((a, b) => a.ms - b.ms)
    let cur: typeof list = []
    const flush = () => {
      if (!cur.length) return
      const exifDeploymentId = group.startsWith('exif:') ? group.slice(5) : null
      // With an EXIF id the folder is informational and may be mixed; show the
      // first one the run was written to.
      const cardFolder = cur.find((r) => r.folder)?.folder ?? null
      out.push({
        key: `${group}-${out.length}`,
        indices: cur.map((r) => r.i),
        firstMs: cur[0].ms,
        lastMs: cur[cur.length - 1].ms,
        cardFolder,
        exifDeploymentId,
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
