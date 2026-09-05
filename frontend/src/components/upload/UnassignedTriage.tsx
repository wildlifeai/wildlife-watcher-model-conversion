/**
 * UnassignedTriage — resolve photos that arrive without a deployment.
 *
 * Why this exists: media rows are only created for files that reach Google
 * Drive, and `candidates` in the drive-upload job requires a deployment_id
 * (backend/app/jobs/definitions.py). A photo with no deployment is therefore
 * never stored and never appears anywhere — while the dock still reports the
 * run as complete. Silently dropping a card's photos is the failure this
 * screen prevents.
 *
 * Photos are grouped into capture sessions (same card folder, gaps under
 * SESSION_GAP_MS) so the operator decides per shoot rather than per photo,
 * and each session can be bound to an existing deployment or turned into a
 * new one pre-filled from the photos themselves.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { buildSessions, deploymentLabel, fmt, span } from './unassignedSessions'
import type { TriageDeployment, TriageSession } from './unassignedSessions'

interface Props {
  files: File[]
  filePaths: string[]
  /** Deployment UUID each file carries in EXIF (0xF200), aligned to `files`; null where absent. */
  exifIds?: (string | null)[]
  /** Indices of files that resolve to no deployment from their EXIF id or the card's folder structure. */
  unresolved: number[]
  /**
   * Photos that already resolved to a deployment, grouped by it. They are not
   * triaged, but the screen names them so the user knows the rest of the card
   * is accounted for and the footer's "ready to upload" count is honest.
   */
  matched?: { label: string; count: number }[]
  deployments: TriageDeployment[]
  projects: { id: string; name: string }[]
  onCancel: () => void
  /** Sessions the user resolved; skipped ones are excluded. */
  onDone: (assignments: { deploymentId: string; indices: number[] }[], skipped: number) => void
}

/** A few representative frames from the session (first, last, and between). */
function useSamplePicks(indices: number[]): number[] {
  return useMemo(() => {
    if (indices.length <= 4) return indices
    const step = (indices.length - 1) / 3
    return [0, 1, 2, 3].map((n) => indices[Math.round(n * step)])
  }, [indices])
}

/**
 * One thumbnail that owns its object URL. The URL is created inside the
 * effect and written straight to the element, and revoked in the cleanup, so
 * the pair always runs together. An earlier version created the URL in a
 * useState initialiser and only revoked it in the cleanup; React StrictMode
 * runs the cleanup and re-runs the effect on mount without re-running the
 * initialiser, so in development every thumbnail pointed at a revoked URL and
 * rendered as a broken image. Nothing leaks when the list changes because
 * React unmounts the old <Thumb>.
 */
function Thumb({ file, alt }: { file: File; alt: string }) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = ref.current
    if (img) img.src = url
    return () => {
      if (img) img.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [file])
  return <img ref={ref} alt={alt} loading="lazy" />
}

function SessionCard({
  session, files, filePaths, deployments, projects, onAssign, onSkip,
}: {
  session: TriageSession
  files: File[]
  filePaths: string[]
  deployments: TriageDeployment[]
  projects: { id: string; name: string }[]
  onAssign: (deploymentId: string) => void
  onSkip: () => void
}) {
  const picks = useSamplePicks(session.indices)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(
    session.exifDeploymentId
      ? `Camera deployment ${session.exifDeploymentId.slice(0, 8)}`
      : session.cardFolder
        ? `Card ${session.cardFolder}`
        : `Photos from ${fmt(session.firstMs)}`,
  )
  // Projects can still be loading when this card first renders, so the initial
  // value would stick at '' while the <select> visually shows the first option
  // - "Create & assign" then failed with "pick a project" on an apparently
  // picked project. Derive the effective value instead of syncing state in an
  // effect (which this repo's lint rejects).
  const [pickedProjectId, setPickedProjectId] = useState('')
  const projectId = pickedProjectId || projects[0]?.id || ''

  const resolved = session.deploymentId !== null
  const samplePath = filePaths[session.indices[0]] ?? files[session.indices[0]]?.name ?? ''

  const create = async () => {
    if (!name.trim() || !projectId) {
      setError('Give the deployment a name and pick a project.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // When the camera stamped a deployment id, create the row under that id: the
      // phone that configured the device holds the same id locally, so its later
      // sync converges on this row instead of producing a second deployment.
      const dep = await apiClient.post('/api/deployments', {
        project_id: projectId,
        name: name.trim(),
        ...(session.exifDeploymentId ? { id: session.exifDeploymentId } : {}),
      })
      onAssign(dep.id)
      setCreating(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the deployment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`triage-card${resolved ? ' is-resolved' : ''}${session.skipped ? ' is-skipped' : ''}`}>
      <div className="triage-shots">
        {picks.map((i, n) => (
          <Thumb key={i} file={files[i]} alt={`Frame ${n + 1} of this session`} />
        ))}
        {session.indices.length > picks.length && (
          <span className="triage-more">+{session.indices.length - picks.length}</span>
        )}
      </div>

      <dl className="triage-facts">
        <div><dt>Photos</dt><dd>{session.indices.length}</dd></div>
        <div><dt>First → last</dt><dd>{fmt(session.firstMs)} → {fmt(session.lastMs)}</dd></div>
        <div><dt>Duration</dt><dd>{span(session.firstMs, session.lastMs)}</dd></div>
        <div>
          <dt>On the card</dt>
          <dd className="triage-path">
            {session.cardFolder
              ? `MEDIA/${session.cardFolder}${session.folderCount > 1 ? ` (+${session.folderCount - 1} other folder${session.folderCount > 2 ? 's' : ''})` : ''}`
              : samplePath || 'loose files'}
          </dd>
        </div>
        {session.exifDeploymentId && (
          <div>
            <dt>Camera says</dt>
            <dd className="triage-path" title={session.exifDeploymentId}>
              deployment {session.exifDeploymentId.slice(0, 8)}… (not in the database)
            </dd>
          </div>
        )}
      </dl>

      {resolved ? (
        <p className="triage-state ok">
          Assigned to {(() => {
            const d = deployments.find((x) => x.id === session.deploymentId)
            return d ? deploymentLabel(d) : 'a new deployment'
          })()}
        </p>
      ) : session.skipped ? (
        <p className="triage-state warn">
          Left unassigned — these {session.indices.length} photos will not be uploaded.
        </p>
      ) : (
        <>
          <div className="triage-actions">
            <select
              className="triage-select"
              defaultValue=""
              aria-label="Assign these photos to a deployment"
              onChange={(e) => e.target.value && onAssign(e.target.value)}
            >
              <option value="">Assign to an existing deployment…</option>
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>{deploymentLabel(d)}</option>
              ))}
            </select>
            <button type="button" className="triage-btn" onClick={() => setCreating((v) => !v)}>
              Create deployment from these photos
            </button>
            <button type="button" className="triage-btn ghost" onClick={onSkip}>
              Skip
            </button>
          </div>

          {creating && (
            <div className="triage-create">
              <label>
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                <span>Project</span>
                <select value={projectId} onChange={(e) => setPickedProjectId(e.target.value)}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <p className="triage-hint">
                Covers {fmt(session.firstMs)} → {fmt(session.lastMs)}, taken from the photos.
              </p>
              {error && <p className="triage-state warn">{error}</p>}
              <button type="button" className="triage-btn primary" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create & assign'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function UnassignedTriage({
  files, filePaths, exifIds, unresolved, matched = [], deployments, projects, onCancel, onDone,
}: Props) {
  const [sessions, setSessions] = useState<TriageSession[]>(
    () => buildSessions(files, filePaths, unresolved, exifIds),
  )

  const update = (key: string, patch: Partial<TriageSession>) =>
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const matchedCount = matched.reduce((n, m) => n + m.count, 0)
  const assignedCount = sessions.filter((s) => s.deploymentId).reduce((n, s) => n + s.indices.length, 0)
  const skippedCount = sessions.filter((s) => s.skipped).reduce((n, s) => n + s.indices.length, 0)
  const pending = sessions.filter((s) => !s.deploymentId && !s.skipped)
  // What will actually be sent: the photos that matched on their own plus the
  // ones resolved here. Counting only the latter read "0 photos ready" while
  // ten matched photos were about to upload.
  const readyCount = matchedCount + assignedCount

  const finish = () => {
    const assignments = sessions
      .filter((s): s is TriageSession & { deploymentId: string } => !!s.deploymentId)
      .map((s) => ({ deploymentId: s.deploymentId, indices: s.indices }))
    onDone(assignments, skippedCount)
  }

  return (
    <div className="triage">
      <header className="triage-head">
        <div>
          <h3>Some photos aren&apos;t linked to a deployment</h3>
          <p>
            We grouped them into capture sessions by the deployment id the camera wrote into
            each photo, else by card folder, and by gaps between photos. Photos left unassigned
            are <strong>not uploaded</strong> — they would not appear in Annotations afterwards.
          </p>
        </div>
        <div className="triage-tally">
          <strong>{sessions.length - pending.length} of {sessions.length}</strong>
          <span>sessions resolved</span>
        </div>
      </header>

      {matched.length > 0 && (
        <p className="triage-matched">
          <strong>{matchedCount} photo{matchedCount === 1 ? '' : 's'} already matched</strong> a deployment
          and will upload as they are: {matched.map((m) => `${m.label} (${m.count})`).join(', ')}.
          Only the sessions below still need a decision.
        </p>
      )}

      <div className="triage-list">
        {sessions.map((s) => (
          <SessionCard
            key={s.key}
            session={s}
            files={files}
            filePaths={filePaths}
            deployments={deployments}
            projects={projects}
            onAssign={(deploymentId) => update(s.key, { deploymentId, skipped: false })}
            onSkip={() => update(s.key, { skipped: true, deploymentId: null })}
          />
        ))}
      </div>

      <footer className="triage-foot">
        <span className="triage-hint">
          {skippedCount > 0
            ? `${readyCount} photo${readyCount === 1 ? '' : 's'} will upload · ${skippedCount} will be left out`
            : `${readyCount} photo${readyCount === 1 ? '' : 's'} ready to upload`}
        </span>
        <div className="triage-actions">
          <button type="button" className="triage-btn ghost" onClick={onCancel}>Back</button>
          <button
            type="button"
            className="triage-btn primary"
            disabled={pending.length > 0}
            onClick={finish}
          >
            {pending.length > 0
              ? `${pending.length} session${pending.length === 1 ? '' : 's'} still to decide`
              : 'Continue upload'}
          </button>
        </div>
      </footer>
    </div>
  )
}
