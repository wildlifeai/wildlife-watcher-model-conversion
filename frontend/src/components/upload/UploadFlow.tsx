/**
 * UploadFlow, the upload surface rendered by /upload-data.
 *
 * Step 1 (idle):       Folder picker / drag-drop zone.
 * Step 2 (images):     Summary tiles, deployment resolution, optional
 *                      assignment panel, optional per-session triage, Upload.
 * Step 2b (camtrapdp): ZIP package summary + inline import progress.
 *
 * Clicking "Upload" hands the files to UploadContext.startUpload, which owns
 * the batch loop and the ProgressDock, then lands the user on Annotations
 * filtered to the uploaded deployment. Everything before that moment lives in
 * this component's state, so leaving the page (or reloading it) drops the
 * staged selection; a beforeunload guard warns before that happens.
 *
 * CamtrapDP import is a single synchronous API call; its progress is shown
 * inline and the selection stays until the result is confirmed.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDragAndDrop } from '../../hooks/useDragAndDrop'
import { apiClient } from '../../lib/apiClient'
import { UnassignedTriage } from './UnassignedTriage'
import { buildSessions, cardFolderOf } from './unassignedSessions'
import { readDeploymentIds } from '../../lib/exifDeploymentId'
import { supabase } from '../../config/supabase'
import { useUploadStore, type UploadDeployment, type PendingUpload } from '../../contexts/UploadContext'
import { useProjectSelection } from '../../hooks/useProjectSelection'
import './upload.css'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CamtrapImportResult {
  project_id: string
  deployments_imported: number
  media_imported: number
  observations_imported: number
  warnings: string[]
  /** Set when run_ai enqueued a SpeciesNet + Wildlife Brain job for the bundled images. */
  ai_job_id?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// CamtrapDP staged-progress labels
// ─────────────────────────────────────────────────────────────────────────────

const CAMTRAP_STAGES: { label: string; pct: number; after: number }[] = [
  { label: 'Uploading package…', pct: 10, after: 500 },
  { label: 'Parsing deployments…', pct: 25, after: 3000 },
  { label: 'Registering taxa via iNat…', pct: 45, after: 8000 },
  { label: 'Importing media records…', pct: 65, after: 15000 },
  { label: 'Importing observations…', pct: 80, after: 22000 },
  { label: 'Finalising import…', pct: 92, after: 30000 },
]

/**
 * Files the image path accepts. Folder drops often leave `type` empty, so the
 * extensions are matched explicitly. Raw .bmp frames are admitted because the
 * backend re-compresses them to JPEG when FF_BMP_INGEST_ENABLED (and ignores
 * them otherwise); they carry no EXIF, so they bind via the card folder.
 */
function isUploadableImage(f: File): boolean {
  const name = f.name.toLowerCase()
  return (
    f.type.startsWith('image/') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.bmp')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function UploadFlow() {
  const { startUpload, phase } = useUploadStore()
  const navigate = useNavigate()

  // ── File selection state (lives for as long as the page is mounted) ────────
  const [files, setFiles] = useState<File[]>([])
  const [filePaths, setFilePaths] = useState<string[]>([])
  // The deployment UUID each frame carries in EXIF (0xF200), aligned to `files`.
  // Authoritative over the card folder, which only holds a prefix and can lag the
  // configured id (ww-website#140). Filled asynchronously after selection.
  const [exifIds, setExifIds] = useState<(string | null)[]>([])
  // Progress of that read, or null once it has landed (or nothing is staged).
  const [exifRead, setExifRead] = useState<{ done: number; total: number } | null>(null)
  // Bumped on every new selection so a read still running for the previous
  // selection cannot write its ids over the new one.
  const selectionRef = useRef(0)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [showTriage, setShowTriage] = useState(false)
  // Whether to run SpeciesNet + Wildlife Brain after upload (server default: on).
  const [runAi, setRunAi] = useState(true)

  // Deployment data (fetched once for stats + validation)
  const [deployments, setDeployments] = useState<UploadDeployment[]>([])
  const [invalidDeployments, setInvalidDeployments] = useState<
    Record<string, 'no_access' | 'not_found'>
  >({})

  // ── Manual deployment assignment (for photos with no / unknown deployment) ──
  const { projects } = useProjectSelection()
  const [assignProjectId, setAssignProjectId] = useState('')       // '' | project id | '__new__'
  const [newProjectName, setNewProjectName] = useState('')
  const [assignDeploymentId, setAssignDeploymentId] = useState('') // '' | deployment id | '__new__'
  const [newDepName, setNewDepName] = useState('')
  const [newDepLat, setNewDepLat] = useState('')
  const [newDepLng, setNewDepLng] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const resetAssignment = () => {
    setAssignProjectId(''); setNewProjectName('')
    setAssignDeploymentId(''); setNewDepName(''); setNewDepLat(''); setNewDepLng('')
    setAssigning(false); setAssignError(null)
  }

  // CamtrapDP import state
  const [camtrapImporting, setCamtrapImporting] = useState(false)
  const [camtrapResult, setCamtrapResult] = useState<CamtrapImportResult | null>(null)
  const [camtrapError, setCamtrapError] = useState<string | null>(null)
  const [camtrapElapsed, setCamtrapElapsed] = useState(0)
  const [camtrapStage, setCamtrapStage] = useState(0)
  const [showAllWarnings, setShowAllWarnings] = useState(false)
  // CamtrapDP data usually arrives labelled, so AI is opt-in there.
  const [camtrapRunAi, setCamtrapRunAi] = useState(false)

  const folderInputRef = useRef<HTMLInputElement>(null)

  // ── Guard the staged selection against an accidental reload / tab close ───
  // Only while something would actually be lost: staged images not yet handed
  // to startUpload, or a ZIP whose import has not finished.
  const staged = files.length > 0 || camtrapImporting || (zipFile !== null && camtrapResult === null)
  useEffect(() => {
    if (!staged) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [staged])

  // ── CamtrapDP stage timer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!camtrapImporting) { setCamtrapStage(0); setCamtrapElapsed(0); return }
    const start = Date.now()
    const ticker = setInterval(
      () => setCamtrapElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    )
    const timers = CAMTRAP_STAGES.map((s, i) => setTimeout(() => setCamtrapStage(i), s.after))
    return () => { clearInterval(ticker); timers.forEach(clearTimeout) }
  }, [camtrapImporting])

  // ── Fetch deployments once on mount (for stats + validation) ──────────────
  useEffect(() => {
    supabase
      .from('deployments')
      .select('id, project_id, location_name, latitude, longitude, deployment_start')
      .is('deleted_at', null)
      .then(({ data }) => { if (data) setDeployments(data) })
  }, [])

  const clearSelection = () => {
    selectionRef.current += 1
    setFiles([])
    setFilePaths([])
    setExifIds([])
    setExifRead(null)
    setZipFile(null)
    setSelectionError(null)
    setInvalidDeployments({})
    setCamtrapResult(null)
    setCamtrapError(null)
    setShowTriage(false)
    resetAssignment()
  }

  // ── File processing (routing image vs ZIP) ─────────────────────────────────
  const processFiles = async (incoming: File[]) => {
    clearSelection()
    const token = selectionRef.current
    const zips = incoming.filter((f) => f.name.toLowerCase().endsWith('.zip'))
    const images = incoming.filter(isUploadableImage)

    if (incoming.length > 0 && zips.length === 0 && images.length === 0) {
      setSelectionError('No images or zip files found in the selected folder.')
      return
    }

    if (zips.length > 0 && images.length === 0) {
      setZipFile(zips[0])
      return
    }

    const paths = images.map(
      (f) => (f as File & { entryPath?: string }).entryPath || f.webkitRelativePath || f.name,
    )
    setFiles(images)
    setFilePaths(paths)

    // Read the deployment id the camera stamped into each frame. Reads only the
    // file heads, but a card of a few thousand frames still takes a moment, so
    // the page shows progress and resolves by folder alone until this lands.
    setExifRead({ done: 0, total: images.length })
    const ids = await readDeploymentIds(images, 8, (done, total) => {
      if (selectionRef.current !== token) return
      if (done === total || done % 25 === 0) setExifRead({ done, total })
    })
    if (selectionRef.current !== token) return
    setExifIds(ids)
    setExifRead(null)

    // Validate what the files claim: full EXIF ids and card-folder prefixes that
    // match none of the user's deployments. /validate accepts both forms.
    const known = new Set(deployments.map((d) => d.id.toLowerCase()))
    const unknownExifIds = Array.from(new Set(ids.filter((id): id is string => !!id && !known.has(id))))
    const folderPrefixes = Array.from(new Set(paths.map(cardFolderOf).filter(Boolean) as string[]))
    const unknownPrefixes = folderPrefixes.filter(
      (id) => !deployments.some((d) => d.id.toUpperCase().startsWith(id)),
    )
    const unknown = [...unknownExifIds, ...unknownPrefixes]

    if (unknown.length > 0) {
      try {
        const res = await apiClient.post('/api/deployments/validate', {
          deployment_ids: unknown,
        })
        if (selectionRef.current !== token) return
        // /validate returns the {prefix: status} map inside the standard {data,...}
        // envelope; tolerate a bare map too (defensive across the split frontend/backend
        // deploy, an old backend still returns it bare).
        const validation: Record<string, 'valid' | 'no_access' | 'not_found'> = res?.data ?? res ?? {}
        const invalid: Record<string, 'no_access' | 'not_found'> = {}
        for (const [id, status] of Object.entries(validation)) {
          if (status === 'no_access' || status === 'not_found') invalid[id] = status
        }
        setInvalidDeployments(invalid)
      } catch {
        // Non-fatal: proceed without validation feedback
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files))
    // Let the same folder be picked again after "Change selection".
    e.target.value = ''
  }

  const handleCamtrapImport = async () => {
    if (!zipFile) return
    setCamtrapImporting(true)
    setCamtrapError(null)
    setCamtrapResult(null)
    try {
      const form = new FormData()
      form.append('file', zipFile)
      form.append('run_ai', String(camtrapRunAi))
      const res = await apiClient.upload('/api/camtrapdp/import', form) as {
        data: CamtrapImportResult
      }
      setCamtrapResult(res.data)
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any
      const msg =
        e?.response?.data?.detail ??
        e?.response?.data?.error?.message ??
        (e instanceof Error ? e.message : String(e))
      setCamtrapError(msg)
    } finally {
      setCamtrapImporting(false)
    }
  }

  const handleUpload = async (
    sessionAssignments?: { deploymentId: string; indices: number[] }[],
  ) => {
    if (files.length === 0) return
    setAssignError(null)

    // Photos with no resolvable deployment are dropped server-side (the drive
    // job only stores files that have one), so resolve them before uploading.
    if (!sessionAssignments && triageSessions.length > 0) {
      setShowTriage(true)
      return
    }

    // Resolve a manual deployment assignment (create project/deployment as needed) for photos
    // that have no recognised deployment. Photos that already resolve to a valid deployment keep
    // it; no-access ones are excluded server-side.
    let assignedDeploymentId: string | undefined
    if (needsAssignment) {
      setAssigning(true)
      try {
        let projectId = assignProjectId
        if (projectId === '__new__') {
          const proj = await apiClient.post('/api/projects', { name: newProjectName.trim() })
          projectId = proj.id
        }
        if (assignDeploymentId === '__new__') {
          // Validate coords client-side so an out-of-range value doesn't hit the DB CHECK
          // constraint as a confusing 500.
          let latitude: number | undefined
          let longitude: number | undefined
          if (newDepLat.trim()) {
            latitude = Number(newDepLat)
            if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
              throw new Error('Latitude must be a number between -90 and 90.')
            }
          }
          if (newDepLng.trim()) {
            longitude = Number(newDepLng)
            if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
              throw new Error('Longitude must be a number between -180 and 180.')
            }
          }
          const dep = await apiClient.post('/api/deployments', {
            project_id: projectId,
            name: newDepName.trim(),
            latitude,
            longitude,
          })
          assignedDeploymentId = dep.id
        } else {
          assignedDeploymentId = assignDeploymentId
        }
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : 'Could not create the deployment.')
        setAssigning(false)
        return
      }
      setAssigning(false)
    }

    // Resolve which deployment each file belongs to: the EXIF id, else the folder prefix,
    // else the manual assignment. Powers the annotations redirect + optimistic grid.
    const pending: PendingUpload[] = files
      .map((f, i) => {
        const deploymentId = resolveDeploymentId(i) || assignedDeploymentId
        return deploymentId ? { fileName: f.name, deploymentId } : null
      })
      .filter((p): p is PendingUpload => p !== null)

    // Triaged photos resolve through their session, not the folder prefix, so
    // fold them in too, otherwise they'd be missing from the optimistic grid
    // and the post-upload redirect would filter to the wrong deployments.
    const triaged: PendingUpload[] = []
    if (sessionAssignments?.length) {
      const byIndex = new Map<number, string>()
      for (const g of sessionAssignments) for (const i of g.indices) byIndex.set(i, g.deploymentId)
      files.forEach((f, i) => {
        const deploymentId = byIndex.get(i)
        if (deploymentId) triaged.push({ fileName: f.name, deploymentId })
      })
    }
    const allPending = [...pending, ...triaged]
    const resolvedDeploymentIds = [...new Set(allPending.map((p) => p.deploymentId))]

    // Images always sync to Google Drive (long-term storage is the default).
    // startUpload copies what it needs before its first await, so the page can
    // drop its staged selection straight away (and with it the unload guard).
    startUpload(
      files, filePaths, true, deployments,
      assignedDeploymentId, resolvedDeploymentIds, allPending, sessionAssignments, runAi,
    )
    clearSelection()

    // Land the user on Annotations, filtered to the just-uploaded deployment, so they watch their
    // images + AI progress fill in live (banner + optimistic cards). One deployment is the common
    // case; for several, focus the first, the banner/refetch cover the rest.
    if (resolvedDeploymentIds.length > 0) {
      navigate(`/annotations?deployment=${resolvedDeploymentIds[0]}`)
    }
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const { isDragging, bind } = useDragAndDrop(processFiles)

  const uploadMode: 'idle' | 'images' | 'camtrapdp' =
    zipFile ? 'camtrapdp' : files.length > 0 ? 'images' : 'idle'

  // Per-file deployment resolution, EXIF first (exact id), folder prefix second.
  // Returns undefined when neither names a deployment the user can see.
  const resolveDeploymentId = (i: number): string | undefined => {
    const exifId = exifIds[i]
    if (exifId) {
      const hit = deployments.find((d) => d.id.toLowerCase() === exifId)
      if (hit) return hit.id
    }
    const pfx = cardFolderOf(filePaths[i] ?? files[i]?.name ?? '')
    if (pfx) {
      const hit = deployments.find((d) => d.id.toUpperCase().startsWith(pfx))
      if (hit) return hit.id
    }
    return undefined
  }

  // What the selection claims to belong to, for the summary tile and the assignment
  // panel's wording: every distinct EXIF id, plus the folder prefix of frames that carry none.
  const claimedDeployments = new Set<string>()
  files.forEach((f, i) => {
    const claim = exifIds[i] ?? cardFolderOf(filePaths[i] ?? f.name)
    if (claim) claimedDeployments.add(claim.toUpperCase().slice(0, 8))
  })
  const deploymentCount = claimedDeployments.size
  const totalMB = (files.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(1)

  const notFound = Object.entries(invalidDeployments)
    .filter(([, s]) => s === 'not_found')
    .map(([id]) => id)
  const noAccess = Object.entries(invalidDeployments)
    .filter(([, s]) => s === 'no_access')
    .map(([id]) => id)

  // Manual assignment is required when photos carry no deployment prefix at all, or when some
  // prefixes aren't in the DB. (no_access photos are excluded server-side and don't gate upload.)
  const needsAssignment = uploadMode === 'images' && (deploymentCount === 0 || notFound.length > 0)

  // Files whose deployment cannot be resolved from their EXIF id or the card's
  // folder structure. These are the ones the backend would silently drop (no
  // deployment_id -> not stored -> no media row), so they go through triage instead.
  const unresolvedIndices = useMemo(() => {
    if (uploadMode !== 'images') return []
    const knownFull = new Set(deployments.map((d) => d.id.toLowerCase()))
    const knownPrefix = new Set(deployments.map((d) => d.id.slice(0, 8).toUpperCase()))
    return files
      .map((f, i) => {
        const exifId = exifIds[i]
        if (exifId && knownFull.has(exifId)) return -1
        const pfx = cardFolderOf(filePaths[i] ?? f.name)
        return pfx && knownPrefix.has(pfx) ? -1 : i
      })
      .filter((i) => i >= 0)
  }, [files, filePaths, exifIds, deployments, uploadMode])

  const triageSessions = useMemo(
    () => (unresolvedIndices.length ? buildSessions(files, filePaths, unresolvedIndices, exifIds) : []),
    [files, filePaths, unresolvedIndices, exifIds],
  )
  const depsInProject = deployments.filter((d) => d.project_id === assignProjectId)
  const projectReady = !!assignProjectId && (assignProjectId !== '__new__' || !!newProjectName.trim())
  const deploymentReady = !!assignDeploymentId && (assignDeploymentId !== '__new__' || !!newDepName.trim())
  // When triage will run it collects the deployment per capture session, so the
  // single blanket assignment form is redundant: showing both asked the user
  // the same question twice.
  const assignmentReady = !needsAssignment || triageSessions.length > 0 || (projectReady && deploymentReady)

  // startUpload refuses to start while a previous batch loop is still sending
  // (busyRef), so say so instead of letting the click do nothing.
  const sending = phase === 'uploading'
  const reading = exifRead !== null
  const uploadDisabled = assigning || !assignmentReady || reading || sending
  const uploadLabel = assigning
    ? 'Preparing…'
    : reading
      ? 'Reading photos…'
      : sending
        ? 'Previous upload still sending…'
        : `⬆ Upload ${files.length} image${files.length !== 1 ? 's' : ''}`

  // ─────────────────────────────────────────────────────────────────────────
  const BTN_SECONDARY: React.CSSProperties = {
    padding: '0.375rem 0.875rem',
    fontSize: '0.8125rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    cursor: 'pointer',
  }

  const FIELD: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.55rem', fontSize: '0.8125rem',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    background: 'var(--surface)', color: 'var(--text-color)',
  }
  const FIELD_LABEL: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', opacity: 0.85,
  }
  const CHECK_LABEL: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer',
  }

  // ── Deployment triage (photos the backend would otherwise drop) ──────────
  if (showTriage) {
    return (
      <div className="upload-flow">
        <UnassignedTriage
          files={files}
          filePaths={filePaths}
          exifIds={exifIds}
          unresolved={unresolvedIndices}
          deployments={deployments}
          projects={projects}
          onCancel={() => setShowTriage(false)}
          onDone={(assignments: { deploymentId: string; indices: number[] }[]) => {
            setShowTriage(false)
            handleUpload(assignments)
          }}
        />
      </div>
    )
  }

  return (
    <div className="upload-flow">
      {/* ── Drop zone (idle) ─────────────────────────────────────────────── */}
      {uploadMode === 'idle' && (
        <>
          <div
            {...bind}
            className={`upload-zone${isDragging ? ' is-dragging' : ''}`}
            onClick={() => folderInputRef.current?.click()}
          >
            <div style={{ pointerEvents: 'none' }}>
              <div className="upload-zone-icon">{isDragging ? '📥' : '📂'}</div>
              <p style={{ fontWeight: 500, marginBottom: '0.25rem', fontSize: '0.9375rem' }}>
                {isDragging ? 'Drop to select' : 'Click to select a folder or drag & drop it here'}
              </p>
              <p style={{ fontSize: '0.75rem', opacity: 0.55 }}>
                Wildlife Watcher SD card folder (MEDIA/…) or CamtrapDP .zip package
              </p>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
              style={{ display: 'none' }}
              onChange={handleInputChange}
            />
          </div>
          {selectionError && (
            <div style={{
              padding: '0.75rem',
              borderRadius: 'var(--radius)',
              backgroundColor: 'rgba(244,67,54,0.08)',
              color: 'var(--error, #f44336)',
              fontSize: '0.8125rem',
              textAlign: 'center'
            }}>
              ⚠ {selectionError}
            </div>
          )}
        </>
      )}

      {/* ── Image mode: stats + options ──────────────────────────────────── */}
      {uploadMode === 'images' && (
        <>
          {/* Summary tiles */}
          <div className="upload-tiles">
            {[
              ['🖼', files.length, 'images'],
              ['📍', deploymentCount || '?', 'deployments'],
              ['💾', `${totalMB} MB`, 'total size'],
            ].map(([icon, value, label]) => (
              <div key={label as string} className="upload-tile">
                <div style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{icon}</div>
                <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{value}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* EXIF read in progress: the deployment count above settles when it lands */}
          {exifRead && (
            <div className="upload-reading" role="status">
              Reading photos… {exifRead.done.toLocaleString()} of {exifRead.total.toLocaleString()}
              {' '}(the deployment count may change once every photo has been read)
            </div>
          )}

          {/* Drive storage note: images always sync to Google Drive by default */}
          <div style={{
            padding: '0.75rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: '0.8125rem',
            display: 'flex', alignItems: 'center', gap: '0.625rem',
          }}>
            <span style={{ fontSize: '1rem' }}>☁️</span>
            <span style={{ opacity: 0.75 }}>
              Images are saved to your connected Google Drive folder for long-term storage.
            </span>
          </div>

          {/* No-access notice: these photos are blocked server-side and excluded from the upload */}
          {noAccess.length > 0 && (
            <div style={{
              padding: '0.75rem',
              borderRadius: 'var(--radius)',
              backgroundColor: 'rgba(244,67,54,0.08)',
              border: '1px solid rgba(244,67,54,0.3)',
              fontSize: '0.8125rem',
            }}>
              <strong style={{ color: 'var(--error, #f44336)', display: 'block', marginBottom: '0.25rem' }}>
                🚫 Some photos will be skipped
              </strong>
              <p style={{ margin: 0 }}>
                <code style={{ fontFamily: 'monospace' }}>{noAccess.join(', ')}</code>{' '}
                belong to a project you don't have access to, so those photos won't be uploaded.
                Contact the project admin if you think this is wrong.
              </p>
            </div>
          )}

          {/* Assignment panel: for photos with no / unrecognised deployment */}
          {needsAssignment && triageSessions.length === 0 && (
            <div style={{
              padding: '0.85rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--primary)',
              backgroundColor: 'rgba(76,175,80,0.06)',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
            }}>
              <div>
                <strong style={{ fontSize: '0.875rem' }}>📍 Assign a deployment</strong>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', opacity: 0.75 }}>
                  {deploymentCount === 0
                    ? "These photos don't include deployment info. Choose which project and deployment they belong to."
                    : "Some photos have a deployment that isn't in the database. Choose where they belong."}
                </p>
              </div>

              <div className="upload-fields">
                <label style={FIELD_LABEL}>Project
                  <select
                    style={FIELD}
                    value={assignProjectId}
                    onChange={(e) => { setAssignProjectId(e.target.value); setAssignDeploymentId(''); setNewDepName('') }}
                  >
                    <option value="">Select project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="__new__">➕ Create new project…</option>
                  </select>
                </label>
                {assignProjectId === '__new__' && (
                  <label style={FIELD_LABEL}>New project name
                    <input
                      style={FIELD}
                      placeholder="New project name"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                    />
                  </label>
                )}
                {projectReady && (
                  <label style={FIELD_LABEL}>Deployment
                    <select style={FIELD} value={assignDeploymentId} onChange={(e) => setAssignDeploymentId(e.target.value)}>
                      <option value="">Select deployment…</option>
                      {assignProjectId !== '__new__' && depsInProject.map((d) => (
                        <option key={d.id} value={d.id}>{d.location_name || d.id.slice(0, 8)}</option>
                      ))}
                      <option value="__new__">➕ Create new deployment…</option>
                    </select>
                  </label>
                )}
              </div>
              {assignDeploymentId === '__new__' && (
                <div className="upload-fields">
                  <label style={FIELD_LABEL}>New deployment name
                    <input
                      style={FIELD}
                      placeholder="e.g. North Ridge, camera 1"
                      value={newDepName}
                      onChange={(e) => setNewDepName(e.target.value)}
                    />
                  </label>
                  <label style={FIELD_LABEL}>Latitude (optional)
                    <input style={FIELD} inputMode="decimal" value={newDepLat} onChange={(e) => setNewDepLat(e.target.value)} />
                  </label>
                  <label style={FIELD_LABEL}>Longitude (optional)
                    <input style={FIELD} inputMode="decimal" value={newDepLng} onChange={(e) => setNewDepLng(e.target.value)} />
                  </label>
                </div>
              )}

              {assignError && (
                <div style={{ color: 'var(--error, #f44336)', fontSize: '0.8rem' }}>⚠ {assignError}</div>
              )}
            </div>
          )}

          {/* AI opt-out: the server runs the pipeline unless told not to */}
          <label style={CHECK_LABEL}>
            <input type="checkbox" checked={runAi} onChange={(e) => setRunAi(e.target.checked)} style={{ marginTop: '0.15rem' }} />
            <span>
              <strong>Run AI analysis after upload</strong>
              <span style={{ opacity: 0.65 }}> (SpeciesNet detection, species ID and clustering)</span>
            </span>
          </label>

          {/* Action row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', paddingTop: '0.25rem' }}>
            <button style={BTN_SECONDARY} onClick={clearSelection} disabled={assigning}>
              ← Change selection
            </button>
            <button
              className="btn"
              onClick={() => handleUpload()}
              disabled={uploadDisabled}
              style={{ padding: '0.5rem 1.5rem', fontWeight: 600, opacity: uploadDisabled ? 0.6 : 1 }}
            >
              {uploadLabel}
            </button>
          </div>
        </>
      )}

      {/* ── CamtrapDP mode ───────────────────────────────────────────────── */}
      {uploadMode === 'camtrapdp' && zipFile && (
        <>
          {/* Package summary */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.875rem 1rem',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            backgroundColor: 'var(--surface)',
          }}>
            <div>
              <div style={{ fontWeight: 600 }}>📦 CamtrapDP Package</div>
              <div style={{ fontSize: '0.8125rem', opacity: 0.6, marginTop: '0.2rem' }}>
                {zipFile.name} · {(zipFile.size / 1024).toFixed(1)} KB
              </div>
            </div>
            {!camtrapImporting && !camtrapResult && (
              <button style={BTN_SECONDARY} onClick={clearSelection}>✕ Clear</button>
            )}
          </div>

          <p style={{ fontSize: '0.8125rem', opacity: 0.65, margin: 0 }}>
            This will create a new project and import all deployments, media records, and observations
            from the package. You can explore the results in the <strong>Annotations</strong> tab.
          </p>

          {/* Import button */}
          {!camtrapResult && !camtrapImporting && !camtrapError && (
            <>
              <label style={CHECK_LABEL}>
                <input type="checkbox" checked={camtrapRunAi} onChange={(e) => setCamtrapRunAi(e.target.checked)} style={{ marginTop: '0.15rem' }} />
                <span>
                  <strong>Run AI analysis after import</strong>
                  <span style={{ opacity: 0.65 }}> (off by default: CamtrapDP data usually arrives already labelled)</span>
                </span>
              </label>
              <button className="btn" onClick={handleCamtrapImport} style={{ alignSelf: 'flex-start', padding: '0.5rem 1.5rem' }}>
                ⬆ Import CamtrapDP Package
              </button>
            </>
          )}

          {/* In-progress */}
          {camtrapImporting && (
            <div style={{
              padding: '1rem', borderRadius: 'var(--radius)',
              backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                  {CAMTRAP_STAGES[camtrapStage]?.label ?? 'Importing…'}
                </span>
                <span style={{ fontSize: '0.75rem', opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>
                  {camtrapElapsed}s
                </span>
              </div>
              <div style={{ height: 6, backgroundColor: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${CAMTRAP_STAGES[camtrapStage]?.pct ?? 10}%`,
                  borderRadius: 3,
                  transition: 'width 1.2s ease',
                  backgroundImage: 'linear-gradient(90deg, var(--primary), #66bb6a)',
                }} />
              </div>
              <p style={{ fontSize: '0.75rem', opacity: 0.5, margin: '0.5rem 0 0 0' }}>
                Large packages can take 30 to 60 s. Please keep this tab open.
              </p>
            </div>
          )}

          {/* Error */}
          {camtrapError && (
            <>
              <div style={{
                padding: '0.75rem', borderRadius: 'var(--radius)',
                backgroundColor: 'rgba(244,67,54,0.08)',
                color: 'var(--error, #f44336)', fontSize: '0.8125rem',
              }}>
                ⚠ {camtrapError}
              </div>
              <button className="btn" onClick={handleCamtrapImport} style={{ alignSelf: 'flex-start', padding: '0.5rem 1.5rem' }}>
                ↺ Retry Import
              </button>
            </>
          )}

          {/* Success */}
          {camtrapResult && (
            <div style={{
              padding: '1rem', borderRadius: 'var(--radius)',
              backgroundColor: 'rgba(76,175,80,0.07)',
              border: '1px solid rgba(76,175,80,0.3)',
              fontSize: '0.8125rem',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.625rem', color: 'var(--primary)' }}>
                ✓ Import successful
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {([
                  ['Deployments', camtrapResult.deployments_imported],
                  ['Media records', camtrapResult.media_imported],
                  ['Observations', camtrapResult.observations_imported],
                ] as [string, number][]).map(([label, count]) => (
                  <div
                    key={label}
                    style={{ textAlign: 'center', padding: '0.375rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)' }}
                  >
                    <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>{count}</div>
                    <div style={{ opacity: 0.6, fontSize: '0.75rem' }}>{label}</div>
                  </div>
                ))}
              </div>
              {camtrapResult.warnings.length > 0 && (
                <div style={{ opacity: 0.75, marginBottom: '0.5rem' }}>
                  <strong>Warnings ({camtrapResult.warnings.length}):</strong>
                  <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                    {(showAllWarnings
                      ? camtrapResult.warnings
                      : camtrapResult.warnings.slice(0, 3)
                    ).map((w, i) => (
                      <li key={i} style={{ marginBottom: '0.2rem', wordBreak: 'break-word' }}>{w}</li>
                    ))}
                  </ul>
                  {camtrapResult.warnings.length > 3 && (
                    <button
                      onClick={() => setShowAllWarnings((v) => !v)}
                      style={{ marginTop: '0.35rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.75rem', padding: 0 }}
                    >
                      {showAllWarnings ? '▲ Show fewer' : `▼ Show all ${camtrapResult.warnings.length}`}
                    </button>
                  )}
                </div>
              )}
              {camtrapResult.ai_job_id && (
                <div style={{ marginBottom: '0.5rem', opacity: 0.85 }}>
                  🧠 AI analysis queued for the bundled images. Track it in{' '}
                  <Link to="/processing" style={{ color: 'var(--primary)' }}>Processing history</Link>.
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.25rem' }}>
                <Link
                  to="/annotations"
                  style={{ color: 'var(--primary)', fontWeight: 500, textDecoration: 'none' }}
                >
                  View in Annotations →
                </Link>
                <button style={BTN_SECONDARY} onClick={clearSelection}>Import another</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
