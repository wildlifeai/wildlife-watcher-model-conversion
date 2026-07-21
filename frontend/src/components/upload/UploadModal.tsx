/**
 * UploadModal — step-by-step upload flow rendered inside the Modal primitive.
 *
 * Step 1 (idle):       File-picker / drag-drop zone.
 * Step 2 (selected):   Summary stats + Drive toggle + "Upload" button.
 * Step 2b (camtrapdp): ZIP package summary + inline import progress.
 *
 * When the user clicks "Upload" (image mode) the modal closes immediately
 * and the ProgressDock takes over in the bottom-right corner.
 *
 * CamtrapDP import is a synchronous single-API-call; progress is shown
 * inline in the modal, which stays open until success/failure is confirmed.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { useDragAndDrop } from '../../hooks/useDragAndDrop'
import { apiClient } from '../../lib/apiClient'
import { supabase } from '../../config/supabase'
import { useNavigate } from 'react-router-dom'
import { useUploadStore, type UploadDeployment, type PendingUpload } from '../../contexts/UploadContext'
import { useProjectSelection } from '../../hooks/useProjectSelection'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CamtrapImportResult {
  project_id: string
  deployments_imported: number
  media_imported: number
  observations_imported: number
  warnings: string[]
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

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function UploadModal() {
  const { modalOpen, closeModal, startUpload, isActive } = useUploadStore()
  const navigate = useNavigate()

  // ── File selection state (local — lives only for modal lifetime) ───────────
  const [files, setFiles] = useState<File[]>([])
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)


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

  const folderInputRef = useRef<HTMLInputElement>(null)

  // ── Reset local state when modal opens / closes ────────────────────────────
  useEffect(() => {
    if (!modalOpen) {
      setFiles([])
      setFilePaths([])
      setZipFile(null)
      setSelectionError(null)
      setInvalidDeployments({})
      setCamtrapResult(null)
      setCamtrapError(null)
      setCamtrapImporting(false)
      setCamtrapStage(0)
      setCamtrapElapsed(0)
      setShowAllWarnings(false)
      resetAssignment()
    }
  }, [modalOpen])

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

  // ── File processing (routing image vs ZIP) ─────────────────────────────────
  const processFiles = async (incoming: File[]) => {
    setSelectionError(null)
    const zips = incoming.filter((f) => f.name.toLowerCase().endsWith('.zip'))
    const images = incoming.filter(
      (f) =>
        f.type.startsWith('image/') ||
        f.name.toLowerCase().endsWith('.jpg') ||
        f.name.toLowerCase().endsWith('.jpeg'),
    )

    if (incoming.length > 0 && zips.length === 0 && images.length === 0) {
      setSelectionError('No images or zip files found in the selected folder.')
      setFiles([])
      setFilePaths([])
      setZipFile(null)
      setInvalidDeployments({})
      setCamtrapResult(null)
      setCamtrapError(null)
      return
    }

    if (zips.length > 0 && images.length === 0) {
      setZipFile(zips[0])
      setFiles([])
      setFilePaths([])
      setInvalidDeployments({})
      setCamtrapResult(null)
      setCamtrapError(null)
      return
    }

    const paths = images.map(
      (f) => (f as File & { entryPath?: string }).entryPath || f.webkitRelativePath || f.name,
    )
    setFiles(images)
    setFilePaths(paths)
    setZipFile(null)
    setCamtrapResult(null)
    setCamtrapError(null)
    setInvalidDeployments({})

    // Validate unknown deployment prefixes from folder structure
    const folderPrefixes = Array.from(
      new Set(
        paths
          .map((p) => {
            const m = p.match(/MEDIA[/\\]([A-Fa-f0-9]{8})[/\\]/i)
            return m ? m[1].toUpperCase() : null
          })
          .filter(Boolean) as string[],
      ),
    )
    const unknownPrefixes = folderPrefixes.filter(
      (id) => !deployments.some((d) => d.id.toUpperCase().startsWith(id)),
    )

    if (unknownPrefixes.length > 0) {
      try {
        const res = await apiClient.post('/api/deployments/validate', {
          deployment_ids: unknownPrefixes,
        })
        // /validate returns the {prefix: status} map inside the standard {data,...}
        // envelope; tolerate a bare map too (defensive across the split frontend/backend
        // deploy — an old backend still returns it bare).
        const validation: Record<string, 'valid' | 'no_access' | 'not_found'> = res?.data ?? res ?? {}
        const invalid: Record<string, 'no_access' | 'not_found'> = {}
        for (const [id, status] of Object.entries(validation)) {
          if (status === 'no_access' || status === 'not_found') invalid[id] = status
        }
        setInvalidDeployments(invalid)
      } catch {
        // Non-fatal — proceed without validation feedback
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files))
  }

  const handleCamtrapImport = async () => {
    if (!zipFile) return
    setCamtrapImporting(true)
    setCamtrapError(null)
    setCamtrapResult(null)
    try {
      const form = new FormData()
      form.append('file', zipFile)
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

  const handleUpload = async () => {
    if (files.length === 0) return
    setAssignError(null)

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

    // Resolve which deployment each file belongs to: folder-prefix match against the fetched
    // deployments, else the manual assignment. Powers the annotations redirect + optimistic grid.
    const prefixToDep = new Map<string, string>()
    for (const pfx of detectedPrefixes) {
      const match = deployments.find((d) => d.id.toUpperCase().startsWith(pfx as string))
      if (match) prefixToDep.set(pfx as string, match.id)
    }
    const depForFile = (path: string): string | undefined => {
      const m = path.match(/MEDIA[/\\]([A-Fa-f0-9]{8})[/\\]/i)
      const pfx = m ? m[1].toUpperCase() : null
      return (pfx && prefixToDep.get(pfx)) || assignedDeploymentId
    }
    const pending: PendingUpload[] = files
      .map((f, i) => {
        const deploymentId = depForFile(filePaths[i] ?? f.name)
        return deploymentId ? { fileName: f.name, deploymentId } : null
      })
      .filter((p): p is PendingUpload => p !== null)
    const resolvedDeploymentIds = [...new Set(pending.map((p) => p.deploymentId))]

    // Images always sync to Google Drive (long-term storage is the default).
    startUpload(files, filePaths, true, deployments, assignedDeploymentId, resolvedDeploymentIds, pending)
    // Modal closes inside startUpload → no explicit closeModal needed

    // Land the user on Annotations, filtered to the just-uploaded deployment, so they watch their
    // images + AI progress fill in live (banner + optimistic cards). One deployment is the common
    // case; for several, focus the first — the banner/refetch cover the rest.
    if (resolvedDeploymentIds.length > 0) {
      navigate(`/annotations?deployment=${resolvedDeploymentIds[0]}`)
    }
  }

  const clearSelection = () => {
    setFiles([])
    setFilePaths([])
    setZipFile(null)
    setSelectionError(null)
    setInvalidDeployments({})
    setCamtrapResult(null)
    setCamtrapError(null)
    resetAssignment()
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const { isDragging, bind } = useDragAndDrop(processFiles)

  const uploadMode: 'idle' | 'images' | 'camtrapdp' =
    zipFile ? 'camtrapdp' : files.length > 0 ? 'images' : 'idle'

  const detectedPrefixes = Array.from(
    new Set(
      filePaths
        .map((p) => {
          const m = p.match(/MEDIA[/\\]([A-Fa-f0-9]{8})[/\\]/i)
          return m ? m[1].toUpperCase() : null
        })
        .filter(Boolean),
    ),
  )
  const deploymentCount = detectedPrefixes.length
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
  const depsInProject = deployments.filter((d) => d.project_id === assignProjectId)
  const projectReady = !!assignProjectId && (assignProjectId !== '__new__' || !!newProjectName.trim())
  const deploymentReady = !!assignDeploymentId && (assignDeploymentId !== '__new__' || !!newDepName.trim())
  const assignmentReady = !needsAssignment || (projectReady && deploymentReady)

  // ─────────────────────────────────────────────────────────────────────────
  const ZONE_STYLE: React.CSSProperties = {
    border: '2px dashed var(--border)',
    borderRadius: 'var(--radius)',
    padding: '2rem 1.5rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background-color 0.2s',
    borderColor: isDragging ? 'var(--primary)' : undefined,
    backgroundColor: isDragging ? 'rgba(59,130,246,0.05)' : undefined,
  }

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
    width: '100%', padding: '0.45rem 0.55rem', fontSize: '0.8125rem',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    background: 'var(--surface)', color: 'var(--text-color)',
  }
  const FIELD_LABEL: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', opacity: 0.85,
  }

  return (
    <Modal
      open={modalOpen}
      onClose={closeModal}
      title="Upload Data"
      size="md"
      persistent={isActive || camtrapImporting}
    >
      {/* ── Drop zone (idle) ─────────────────────────────────────────────── */}
      {uploadMode === 'idle' && (
        <>
          <div
            {...bind}
            style={ZONE_STYLE}
            onClick={() => folderInputRef.current?.click()}
          >
            <div style={{ pointerEvents: 'none' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.7 }}>
                {isDragging ? '📥' : '📂'}
              </div>
              <p style={{ fontWeight: 500, marginBottom: '0.25rem', fontSize: '0.9375rem' }}>
                {isDragging ? 'Drop to select' : 'Click to select folder or drag & drop here'}
              </p>
              <p style={{ fontSize: '0.75rem', opacity: 0.55, margin: 0 }}>
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
              marginTop: '1rem',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Summary card */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.75rem',
          }}>
            {[
              ['🖼', files.length, 'images'],
              ['📍', deploymentCount || '?', 'deployments'],
              ['💾', `${totalMB} MB`, 'total size'],
            ].map(([icon, value, label]) => (
              <div
                key={label as string}
                style={{
                  padding: '0.75rem',
                  textAlign: 'center',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                }}
              >
                <div style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{icon}</div>
                <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{value}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Drive storage note — images always sync to Google Drive by default */}
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

          {/* No-access notice — these photos are blocked server-side and excluded from the upload */}
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

          {/* Assignment panel — for photos with no / unrecognised deployment */}
          {needsAssignment && (
            <div style={{
              padding: '0.85rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--primary)',
              backgroundColor: 'rgba(59,130,246,0.05)',
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
                <input
                  style={FIELD}
                  placeholder="New project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
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
              {assignDeploymentId === '__new__' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <input
                    style={FIELD}
                    placeholder="New deployment name (e.g. North Ridge — Cam 1)"
                    value={newDepName}
                    onChange={(e) => setNewDepName(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input style={{ ...FIELD, flex: 1 }} placeholder="Latitude (optional)" inputMode="decimal" value={newDepLat} onChange={(e) => setNewDepLat(e.target.value)} />
                    <input style={{ ...FIELD, flex: 1 }} placeholder="Longitude (optional)" inputMode="decimal" value={newDepLng} onChange={(e) => setNewDepLng(e.target.value)} />
                  </div>
                </div>
              )}

              {assignError && (
                <div style={{ color: 'var(--error, #f44336)', fontSize: '0.8rem' }}>⚠ {assignError}</div>
              )}
            </div>
          )}

          {/* Action row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.25rem' }}>
            <button style={BTN_SECONDARY} onClick={clearSelection} disabled={assigning}>
              ← Change selection
            </button>
            <button
              className="btn"
              onClick={handleUpload}
              disabled={assigning || !assignmentReady}
              style={{ padding: '0.5rem 1.5rem', fontWeight: 600, opacity: assigning || !assignmentReady ? 0.6 : 1 }}
            >
              {assigning ? 'Preparing…' : `⬆ Upload ${files.length} image${files.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── CamtrapDP mode ───────────────────────────────────────────────── */}
      {uploadMode === 'camtrapdp' && zipFile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                {zipFile.name} — {(zipFile.size / 1024).toFixed(1)} KB
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
            <button className="btn" onClick={handleCamtrapImport} style={{ alignSelf: 'flex-start', padding: '0.5rem 1.5rem' }}>
              ⬆ Import CamtrapDP Package
            </button>
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
                Large packages can take 30–60 s. Please keep this tab open.
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
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.25rem' }}>
                <Link
                  to="/annotations"
                  onClick={closeModal}
                  style={{ color: 'var(--primary)', fontWeight: 500, textDecoration: 'none' }}
                >
                  View in Annotations →
                </Link>
                <button style={BTN_SECONDARY} onClick={closeModal}>Close</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
