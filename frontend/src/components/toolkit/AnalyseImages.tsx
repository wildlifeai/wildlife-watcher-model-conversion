import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { supabase } from '../../config/supabase'
import { useDragAndDrop } from '../../hooks/useDragAndDrop'
import { PipelineStatusBox, type PipelineState, type LogEntry } from './PipelineStatusBox'
// Temporarily commented out — re-enable when these features are restored
// import { INaturalistPanel } from './INaturalistPanel'
// import { ImageClustering } from './ImageClustering'

interface CamtrapImportResult {
  project_id: string
  deployments_imported: number
  media_imported: number
  observations_imported: number
  warnings: string[]
  ai_job_id?: string | null
}

interface Deployment {
  id: string
  project_id: string
  location_name: string | null
  latitude: number | null
  longitude: number | null
  deployment_start: string | null
}

interface ExifResult {
  filename: string
  deployment_id: string | null
  gps_lat: number | null
  gps_lon: number | null
  datetime: string | null
  detection: string | null
  matched_deployment: string | null
}

function derivePhase(state: PipelineState): 'idle' | 'uploading' | 'processing' | 'completed' | 'failed' | 'stalled' {
  // Staging/enqueue failed before any job was created (e.g. Azure buffer down) —
  // must beat the "0 jobs → completed" edge case below, or a failed upload would
  // be reported as "✅ Complete".
  if (state.uploadError) return 'failed'

  if (state.jobs.some(j => j.status === 'failed')) return 'failed'

  if (state.jobs.length > 0 && state.jobs.every(j =>
    ['completed', 'completed_with_errors', 'failed', 'skipped'].includes(j.status)
  )) return 'completed'

  // Edge Case: 0 jobs generated (all files were skipped as duplicates)
  if (state.totalFiles > 0 && state.uploadedFiles === state.totalFiles && state.jobs.length === 0) return 'completed'

  if (state.uploadedFiles < state.totalFiles) return 'uploading'

  const lastUpdateAge = Date.now() - state.lastUpdateTs
  if (lastUpdateAge > 15000 && state.jobs.some(j => j.status === 'processing')) return 'stalled'

  if (state.jobs.length > 0) return 'processing'
  return 'idle'
}

const FIELD: React.CSSProperties = {
  padding: '0.4rem 0.6rem', fontSize: '0.8125rem', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text-color)', width: '100%',
}

export function AnalyseImages() {
  const [files, setFiles] = useState<File[]>([])
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [results, setResults] = useState<ExifResult[]>([])
  
  // Progress states
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    totalFiles: 0,
    uploadedFiles: 0,
    jobs: [],
    logs: [],
    lastUpdateTs: 0
  })
  
  const [deployments, setDeployments] = useState<Deployment[]>([])
  
  // Track detailed validation state of unknown deployments
  // Key: deployment ID, Value: 'no_access' | 'not_found'
  const [invalidDeployments, setInvalidDeployments] = useState<Record<string, 'no_access' | 'not_found'>>({})
  
  const folderInputRef = useRef<HTMLInputElement>(null)
  // const zipInputRef = useRef<HTMLInputElement>(null) // Temporarily disabled — ZIP picker commented out
  const lastSeenSeqRef = useRef<Record<string, number>>({})

  // CamtrapDP import state
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [camtrapImporting, setCamtrapImporting] = useState(false)
  const [camtrapResult, setCamtrapResult] = useState<CamtrapImportResult | null>(null)
  const [camtrapError, setCamtrapError] = useState<string | null>(null)
  const [camtrapElapsed, setCamtrapElapsed] = useState(0)
  const [camtrapStage, setCamtrapStage] = useState(0)
  const [showAllWarnings, setShowAllWarnings] = useState(false)

  // ── Run-AI toggle: photos default on (preserves auto-annotate); CamtrapDP opt-in ──
  const [runAi, setRunAi] = useState(true)
  const [camtrapRunAi, setCamtrapRunAi] = useState(false)

  // ── Deployment assignment for uploads with no valid deployment ID ──
  const [assignedDeploymentId, setAssignedDeploymentId] = useState<string | null>(null)
  const [assignMode, setAssignMode] = useState<'existing' | 'create'>('existing')
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [newDep, setNewDep] = useState({ projectId: '', name: '', lat: '', lon: '' })
  const [creatingDep, setCreatingDep] = useState(false)
  const [createDepError, setCreateDepError] = useState<string | null>(null)

  const CAMTRAP_STAGES = [
    { label: 'Uploading package…',         pct: 10, after: 500   },
    { label: 'Parsing deployments…',       pct: 25, after: 3000  },
    { label: 'Registering taxa via iNat…', pct: 45, after: 8000  },
    { label: 'Importing media records…',   pct: 65, after: 15000 },
    { label: 'Importing observations…',    pct: 80, after: 22000 },
    { label: 'Finalising import…',         pct: 92, after: 30000 },
  ]

  useEffect(() => {
    if (!camtrapImporting) { setCamtrapStage(0); setCamtrapElapsed(0); return }
    const start = Date.now()
    const ticker = setInterval(() => setCamtrapElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    const timers = CAMTRAP_STAGES.map((s, i) => setTimeout(() => setCamtrapStage(i), s.after))
    return () => { clearInterval(ticker); timers.forEach(clearTimeout) }
  }, [camtrapImporting])

  // Which upload mode is active
  type UploadMode = 'idle' | 'images' | 'camtrapdp'
  const uploadMode: UploadMode = zipFile ? 'camtrapdp' : files.length > 0 ? 'images' : 'idle'

  // Fetch all deployments from Supabase on mount for coordinate mapping
  useEffect(() => {
    supabase
      .from('deployments')
      .select('id, project_id, location_name, latitude, longitude, deployment_start')
      .is('deleted_at', null)
      .then(({ data }) => {
        if (data) setDeployments(data)
      })
  }, [])

  // Fetch the user's projects (RLS-scoped) for the "create deployment" dropdown.
  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name')
      .then(({ data }) => {
        if (data) setProjects(data)
      })
  }, [])

  // Poll active Google Drive upload jobs
  useEffect(() => {
    const jobs = pipelineState.jobs
    if (jobs.length === 0) return

    const incompleteJobs = jobs.filter(j =>
      j.status === 'queued' ||
      j.status === 'in_progress' ||
      j.status === 'processing' ||
      j.status === 'deferred'
    )
    if (incompleteJobs.length === 0) return

    const timer = setInterval(async () => {
      try {
        const updates = await Promise.all(
          jobs.map(async (job) => {
            if (['completed', 'completed_with_errors', 'failed', 'skipped'].includes(job.status)) return job

            try {
              const res = await apiClient.get(`/api/jobs/${job.id}`)
              const j = res.data?.data ?? res.data ?? {}

              let status = j.status ?? job.status
              let progress = j.progress ?? job.progress

              if (progress >= 0.999 && (status === 'in_progress' || status === 'processing')) {
                status = 'completed'
                progress = 1.0
              }

              return {
                ...job,
                status,
                progress,
                error: j.error ? String(j.error) : job.error,
                message: j.message ?? job.message,
                updatedAt: j.updated_at ?? job.updatedAt,
                currentPhase: j.current_phase ?? job.currentPhase,
                summary: j.summary ?? job.summary,
                eventCount: j.event_count ?? job.eventCount ?? 0,
                // events from this poll (consumed below, not stored in state)
                _events: j.events ?? [],
              } as typeof job & { _events: Array<{ seq: number; type: string; phase: string; timestamp: string; message: string }> }
            } catch {
              return job
            }
          })
        )

        let changed = false
        const logsToAdd: LogEntry[] = []

        for (let i = 0; i < jobs.length; i++) {
          const prev = jobs[i]
          const next = updates[i] as any

          if (
            prev.status !== next.status ||
            prev.progress !== next.progress ||
            prev.message !== next.message ||
            (next.eventCount || 0) > (prev.eventCount || 0)
          ) {
            changed = true
          }

          // ── Structured event consumption (seq-based) ──────
          const events: Array<{ seq: number; type: string; phase: string; timestamp: string; message: string }> = next._events || []
          const prevSeq = lastSeenSeqRef.current[next.id] ?? -1

          // Sort by seq defensively, then filter to only new events
          const newEvents = events
            .sort((a, b) => a.seq - b.seq)
            .filter(e => e.seq > prevSeq)

          if (newEvents.length > 0) {
            lastSeenSeqRef.current[next.id] = newEvents[newEvents.length - 1].seq
            changed = true

            for (const evt of newEvents) {
              let level: LogEntry['level'] = 'info'
              if (evt.type === 'file_success' || evt.type === 'phase_complete') level = 'success'
              if (evt.type === 'file_failure' || evt.type === 'stall_warning') level = 'error'
              if (evt.type === 'file_skip') level = 'warning'
              if (evt.type === 'folder_created') level = 'info'
              if (evt.type === 'heartbeat') level = 'warning'

              logsToAdd.push({
                ts: new Date(evt.timestamp).getTime() || Date.now(),
                level,
                message: evt.message,
              })
            }
          } else if (next.message && next.message !== prev.message && events.length === 0) {
            // Fallback for jobs without structured events (other job types)
            let level: LogEntry['level'] = 'info'
            if (next.status === 'completed' || next.status === 'completed_with_errors') level = 'success'
            if (next.status === 'failed') level = 'error'
            logsToAdd.push({ ts: Date.now(), level, message: next.message })
          }

          // Strip _events before storing in state
          delete next._events
        }

        // Deduplicate simultaneous identical logs
        const uniqueLogs = new Set<string>()
        const filteredLogs = logsToAdd.filter(log => {
          if (uniqueLogs.has(log.message)) return false
          uniqueLogs.add(log.message)
          return true
        })

        if (changed) {
          setPipelineState(prev => ({
            ...prev,
            jobs: updates,
            logs: [...prev.logs, ...filteredLogs],
            lastUpdateTs: Date.now(),
          }))
        }
      } catch (e) {
        console.error('Polling failed', e)
      }
    }, 2000)

    return () => clearInterval(timer)
  }, [pipelineState.jobs])

  const analyseMutation = useMutation({
    mutationFn: async (imageFiles: File[]) => {
      const chunkSize = 10
      const totalBatches = Math.ceil(imageFiles.length / chunkSize)
      lastSeenSeqRef.current = {}

      setPipelineState({
          totalFiles: imageFiles.length,
          uploadedFiles: 0,
          jobs: [],
          logs: [{ ts: Date.now(), level: 'info', message: `🚀 Starting pipeline for ${imageFiles.length} images (${totalBatches} batch${totalBatches > 1 ? 'es' : ''} of ${chunkSize})…` }],
          lastUpdateTs: Date.now()
      })
      setResults([])

      const allResults: ExifResult[] = []

      for (let i = 0; i < imageFiles.length; i += chunkSize) {
        const batchNum = Math.floor(i / chunkSize) + 1
        const batchEnd = Math.min(i + chunkSize, imageFiles.length)

        // Log batch start before API call
        setPipelineState(prev => ({
          ...prev,
          logs: [...prev.logs, { ts: Date.now(), level: 'info' as const, message: `📦 Processing batch ${batchNum}/${totalBatches} (images ${i + 1}–${batchEnd})…` }],
          lastUpdateTs: Date.now(),
        }))

        const chunk = imageFiles.slice(i, i + chunkSize)
        const chunkPaths = filePaths.slice(i, i + chunkSize)
        const formData = new FormData()
        for (const f of chunk) {
          formData.append('files', f)
        }
        for (const p of chunkPaths) {
          formData.append('paths', p)
        }
        // Images always sync to Google Drive (default long-term storage).
        formData.append('upload_to_drive', 'true')
        // Whether to run the AI pipeline + Wildlife Brain after upload (user toggle).
        formData.append('run_ai', String(runAi))
        // Bind these images to a chosen/created deployment when they carry no valid one.
        if (assignedDeploymentId) formData.append('assigned_deployment_id', assignedDeploymentId)

        try {
          const response = await apiClient.upload('/api/exif/parse', formData)
          const data = response.data ?? {}
          const raw: any[] = data.images ?? data ?? []
          
          const mapped: ExifResult[] = raw.map((item: any) => {
            const exif = item.exif ?? {}
            const lat = exif.latitude ?? null
            const lon = exif.longitude ?? null
            const hasExifGps = lat !== null && lon !== null && !(lat === 0 && lon === 0)
            const depId = exif.deployment_id ?? null
            
            const matchedDep = depId
              ? deployments.find((d) => 
                  d.id.toLowerCase() === depId.toLowerCase() ||
                  (depId.length === 8 && d.id.toLowerCase().startsWith(depId.toLowerCase()))
                )
              : null

            let finalLat = hasExifGps ? Number(lat) : null
            let finalLon = hasExifGps ? Number(lon) : null
            if (finalLat === null && finalLon === null && matchedDep?.latitude && matchedDep?.longitude) {
              finalLat = matchedDep.latitude
              finalLon = matchedDep.longitude
            }

            return {
              filename: item.filename ?? 'unknown',
              deployment_id: depId,
              gps_lat: finalLat,
              gps_lon: finalLon,
              datetime: exif.date ?? exif.Datetime_Original ?? exif.DateTime ?? null,
              detection: exif.UserComment ?? null,
              matched_deployment: matchedDep?.location_name ?? null,
            }
          })
          
          allResults.push(...mapped)
          setResults([...allResults])
          
          const driveInfo = data.drive_upload
          
          setPipelineState(prev => {
              const logs = [...prev.logs]
              const jobs = [...prev.jobs]
              let uploadError = prev.uploadError ?? null
              const startIdx = i + 1
              const endIdx = Math.min(i + chunkSize, imageFiles.length)

              if (driveInfo) {
                if (driveInfo.status === 'skipped') {
                    const reason = driveInfo.reason === 'no_files_stored' ? 'Images already exist in system (duplicates)' : driveInfo.reason
                    logs.push({ ts: Date.now(), level: 'warning', message: `⏭️ Images ${startIdx}-${endIdx} skipped: ${reason}` })
                } else if (driveInfo.job_id) {
                    jobs.push({
                        id: driveInfo.job_id,
                        status: driveInfo.status || 'queued',
                        progress: 0,
                        fileCount: driveInfo.file_count || chunk.length
                    })

                    if (driveInfo.duplicates_skipped > 0) {
                        logs.push({ ts: Date.now(), level: 'warning', message: `⏭️ ${driveInfo.duplicates_skipped} images in batch already exist in system.` })
                    }

                    if (driveInfo.file_count > 0) {
                        logs.push({ ts: Date.now(), level: 'success', message: `✅ Buffered locally. Drive sync queued for ${driveInfo.file_count} images.` })
                    }
                } else if (driveInfo.status === 'error') {
                    // No job was enqueued — record a fatal error so derivePhase reports
                    // failure instead of a false "✅ Complete" (the 0-jobs edge case).
                    const msg = driveInfo.error || 'Unknown error'
                    logs.push({ ts: Date.now(), level: 'error', message: `❌ Storage/Drive integration failed: ${msg}` })
                    uploadError = uploadError || `Storage/Drive integration failed — no images were saved. ${msg}`
                }
              }

              return {
                  ...prev,
                  uploadedFiles: endIdx,
                  jobs,
                  logs,
                  uploadError,
                  lastUpdateTs: Date.now()
              }
          })

        } catch (e: any) {
          console.error("Chunk failed", e)
          const errorMessage = e.response?.data?.detail || e.response?.data?.error?.message || e.message || String(e)
          setPipelineState(prev => ({
              ...prev,
              logs: [...prev.logs, { ts: Date.now(), level: 'error', message: `❌ Failed to process images ${i+1}-${Math.min(i+chunkSize, imageFiles.length)}: ${errorMessage}` }],
              // A transport/parse failure creates no job either — flag it so the run
              // can't finish as a false "✅ Complete".
              uploadError: prev.uploadError || `Failed to process some images: ${errorMessage}`,
              uploadedFiles: Math.min(i + chunkSize, prev.totalFiles)
          }))
        }
      }

      return allResults
    }
  })

  const processFiles = async (incoming: File[]) => {
    // Check for ZIP files first — route to CamtrapDP
    const zips = incoming.filter(f => f.name.toLowerCase().endsWith('.zip'))
    const imageFiles = incoming.filter((f) =>
      f.type.startsWith('image/') ||
      f.name.toLowerCase().endsWith('.jpg') ||
      f.name.toLowerCase().endsWith('.jpeg') ||
      // Raw BMP frames: the backend re-compresses them to JPEG when
      // FF_BMP_INGEST_ENABLED, else ignores them. Folder drops often leave
      // f.type empty, so match the extension explicitly.
      f.name.toLowerCase().endsWith('.bmp')
    )

    // Only route to CamtrapDP if there are ZIPs and no images
    if (zips.length > 0 && imageFiles.length === 0) {
      setZipFile(zips[0])
      setFiles([])
      setFilePaths([])
      setResults([])
      setCamtrapResult(null)
      setCamtrapError(null)
      setPipelineState({ totalFiles: 0, uploadedFiles: 0, jobs: [], logs: [], lastUpdateTs: Date.now() })
      setInvalidDeployments({})
      return
    }

    // Otherwise handle as image files
    const paths = imageFiles.map((f) => (f as any).entryPath || f.webkitRelativePath || f.name)
    setFiles(imageFiles)
    setFilePaths(paths)
    setResults([])
    setZipFile(null)
    setCamtrapResult(null)
    setCamtrapError(null)
    setPipelineState({ totalFiles: 0, uploadedFiles: 0, jobs: [], logs: [], lastUpdateTs: Date.now() })
    lastSeenSeqRef.current = {}
    setInvalidDeployments({})
    setAssignedDeploymentId(null)
    setCreateDepError(null)

    // Detect unique deployment prefixes from paths
    const folderDepIds = Array.from(new Set(
      paths
        .map((p) => {
          const m = p.match(/MEDIA[/\\]([A-Fa-f0-9]{8})[/\\]/i)
          return m ? m[1].toUpperCase() : null
        })
        .filter(Boolean) as string[]
    ))
    
    const unknownIds = folderDepIds.filter(
      id => !deployments.some(d => d.id.toUpperCase().startsWith(id))
    )

    if (unknownIds.length > 0) {
      try {
        const response = await apiClient.post('/api/deployments/validate', {
          deployment_ids: unknownIds
        })
        // /validate returns the {id: status} map in the standard {data,...} envelope;
        // tolerate a bare map too (defensive across the split frontend/backend deploy).
        const validationResults: Record<string, 'valid' | 'no_access' | 'not_found'> =
          (response?.data ?? response ?? {}) as Record<string, 'valid' | 'no_access' | 'not_found'>
        const newInvalid: Record<string, 'no_access' | 'not_found'> = {}

        for (const [id, status] of Object.entries(validationResults)) {
          if (status === 'no_access' || status === 'not_found') {
            newInvalid[id] = status
          }
        }
        setInvalidDeployments(newInvalid)
      } catch (err) {
        console.error("Failed to validate deployments", err)
      }
    }
  }

  const handleCamtrapImport = async () => {
    if (!zipFile) return
    setCamtrapImporting(true)
    setCamtrapError(null)
    setCamtrapResult(null)
    try {
      const form = new FormData()
      form.append('file', zipFile)
      // Opt-in: run SpeciesNet + Wildlife Brain on the image-backed imported deployments.
      form.append('run_ai', String(camtrapRunAi))
      const res = await apiClient.upload('/api/camtrapdp/import', form) as { data: CamtrapImportResult }
      setCamtrapResult(res.data)
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.detail || (err as any)?.response?.data?.error?.message || (err instanceof Error ? err.message : String(err))
      setCamtrapError(msg)
    } finally {
      setCamtrapImporting(false)
    }
  }

  const createDeployment = async () => {
    if (!newDep.projectId || !newDep.name.trim()) {
      setCreateDepError('Pick a project and enter a name.')
      return
    }
    setCreatingDep(true)
    setCreateDepError(null)
    try {
      const res = await apiClient.post('/api/deployments', {
        project_id: newDep.projectId,
        name: newDep.name.trim(),
        latitude: newDep.lat ? Number(newDep.lat) : undefined,
        longitude: newDep.lon ? Number(newDep.lon) : undefined,
      })
      const dep = ((res as any).data?.data ?? (res as any).data) as Deployment
      setDeployments(prev => [...prev, dep])
      setAssignedDeploymentId(dep.id)
      setAssignMode('existing')
      setNewDep({ projectId: '', name: '', lat: '', lon: '' })
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.detail || (err as any)?.response?.data?.error?.message || (err instanceof Error ? err.message : String(err))
      setCreateDepError(msg)
    } finally {
      setCreatingDep(false)
    }
  }

  const clearAll = () => {
    setFiles([])
    setFilePaths([])
    setResults([])
    setZipFile(null)
    setCamtrapResult(null)
    setCamtrapError(null)
    setPipelineState({ totalFiles: 0, uploadedFiles: 0, jobs: [], logs: [], lastUpdateTs: Date.now() })
    lastSeenSeqRef.current = {}
    setAssignedDeploymentId(null)
    setCreateDepError(null)
  }

  const { isDragging, bind } = useDragAndDrop(processFiles)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files))
    }
  }

  // Detect unique deployment prefixes from paths
  const folderDepIds = Array.from(new Set(
    filePaths
      .map((p) => {
        const m = p.match(/MEDIA[/\\]([A-Fa-f0-9]{8})[/\\]/i)
        return m ? m[1].toUpperCase() : null
      })
      .filter(Boolean) as string[]
  ))
  const folderDepCount = folderDepIds.length
  
  const notFoundDeployments = Object.entries(invalidDeployments)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .filter(([_unused, status]) => status === 'not_found')
    .map(([id]) => id)
    
  const noAccessDeployments = Object.entries(invalidDeployments)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .filter(([_unused, status]) => status === 'no_access')
    .map(([id]) => id)
    
  const hasInvalidDeployments = notFoundDeployments.length > 0 || noAccessDeployments.length > 0

  // Offer the assign/create-deployment panel when there's no confirmed valid binding:
  // no MEDIA/<hex> folder deployment at all, or a folder deployment that doesn't exist.
  const needsDeployment = files.length > 0 && results.length === 0 && (folderDepCount === 0 || notFoundDeployments.length > 0)

  return (
    <div>
      {/* iNaturalist connection panel — temporarily hidden for cleaner UX */}
      {/* <INaturalistPanel /> */}

      <h3 style={{ marginBottom: '0.5rem' }}>Upload Data</h3>
      <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
        Upload a <strong>CamtrapDP package</strong> (.zip) to import labelled data from any camera trap tool,
        or drag-and-drop a <strong>media folder</strong> from your Wildlife Watcher SD card.
        The system auto-detects the format and routes to the correct pipeline.
      </p>

      <div
        className="card"
        {...bind}
        style={{
          textAlign: 'center',
          padding: '2rem',
          cursor: 'pointer',
          borderStyle: 'dashed',
          borderWidth: '2px',
          borderColor: isDragging ? 'var(--primary)' : undefined,
          backgroundColor: isDragging ? 'rgba(var(--primary-rgb, 59,130,246), 0.05)' : undefined,
          transition: 'border-color 0.2s, background-color 0.2s',
        }}
        onClick={() => folderInputRef.current?.click()}
      >
        <div style={{ pointerEvents: 'none' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.8 }}>
            {isDragging ? '📥' : '📂'}
          </div>
          <p style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
            {isDragging ? 'Drop to upload' : 'Click to select folder or drag-and-drop here'}
          </p>
          <p style={{ fontSize: '0.75rem', opacity: 0.6 }}>
            Supports Wildlife Watcher SD card folders (MEDIA/...) and CamtrapDP ZIP packages
          </p>
        </div>
        <input
          ref={folderInputRef}
          type="file"
          multiple
          {...{ webkitdirectory: "", directory: "" } as any}
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      </div>

      {/* ZIP file picker — temporarily hidden; users can drag-drop ZIP onto the main zone */}
      {/*
      <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
        <button
          onClick={() => zipInputRef.current?.click()}
          style={{
            padding: '0.375rem 1rem',
            fontSize: '0.8125rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            backgroundColor: 'transparent',
            color: 'var(--text-color)',
            cursor: 'pointer',
            opacity: 0.7,
          }}
        >
          📦 Or select a CamtrapDP .zip file
        </button>
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFiles([f]) }}
        />
      </div>
      */}

      {/* ── CamtrapDP ZIP panel ────────────────────────────────────── */}
      {uploadMode === 'camtrapdp' && zipFile && (
        <div style={{
          marginTop: '1rem',
          padding: '1.25rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          backgroundColor: 'var(--surface)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>📦 CamtrapDP Package Detected</div>
              <div style={{ fontSize: '0.8125rem', opacity: 0.7, marginTop: '0.25rem' }}>
                {zipFile.name} — {(zipFile.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <button
              onClick={clearAll}
              style={{
                padding: '0.25rem 0.5rem',
                fontSize: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                backgroundColor: 'transparent',
                color: 'var(--text-color)',
                cursor: 'pointer',
              }}
            >
              ✕ Clear
            </button>
          </div>

          <p style={{ fontSize: '0.8125rem', opacity: 0.7, marginBottom: '0.75rem' }}>
            This will create a new project and import all deployments, media records, and observations
            from the CamtrapDP package. You can explore the imported data in <strong>My Data</strong> afterwards.
          </p>

          {!camtrapResult && !camtrapImporting && (
            <>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={camtrapRunAi} onChange={e => setCamtrapRunAi(e.target.checked)} style={{ marginTop: '0.15rem' }} />
                <span>
                  <strong>Run AI analysis after import</strong>
                  <span style={{ opacity: 0.65 }}> — SpeciesNet detection + Wildlife Brain on images bundled in the package. Off by default (CamtrapDP data usually arrives already labelled).</span>
                </span>
              </label>
              <button
                className="btn"
                onClick={handleCamtrapImport}
                style={{ padding: '0.5rem 1.25rem' }}
              >
                ⬆ Import CamtrapDP Package
              </button>
            </>
          )}

          {camtrapImporting && (
            <div style={{ marginTop: '0.25rem', padding: '1rem', borderRadius: 'var(--radius)', backgroundColor: 'var(--bg-color, #fff)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{CAMTRAP_STAGES[camtrapStage]?.label ?? 'Importing…'}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{camtrapElapsed}s</span>
              </div>
              <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${CAMTRAP_STAGES[camtrapStage]?.pct ?? 10}%`,
                  borderRadius: '3px',
                  transition: 'width 1.2s ease',
                  backgroundImage: 'linear-gradient(90deg, var(--primary, #4caf50), #66bb6a)',
                }} />
              </div>
              <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '0.5rem', marginBottom: 0 }}>
                Large packages with many taxa can take 30–60 s. Please keep this tab open.
              </p>
            </div>
          )}

          {camtrapError && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              borderRadius: 'var(--radius)',
              backgroundColor: 'rgba(244,67,54,0.08)',
              color: 'var(--error, #f44336)',
              fontSize: '0.8125rem',
            }}>
              ⚠ {camtrapError}
            </div>
          )}

          {camtrapResult && (
            <div style={{
              marginTop: '0.75rem',
              padding: '1rem',
              borderRadius: 'var(--radius)',
              backgroundColor: 'rgba(76,175,80,0.08)',
              border: '1px solid rgba(76,175,80,0.3)',
              fontSize: '0.8125rem',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--primary)' }}>
                ✓ Import successful
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {[
                  ['Deployments', camtrapResult.deployments_imported],
                  ['Media records', camtrapResult.media_imported],
                  ['Observations', camtrapResult.observations_imported],
                ].map(([label, count]) => (
                  <div key={label as string} style={{ textAlign: 'center', padding: '0.375rem', backgroundColor: 'var(--bg-color, #fff)', borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>{count}</div>
                    <div style={{ opacity: 0.6, fontSize: '0.75rem' }}>{label}</div>
                  </div>
                ))}
              </div>
              {camtrapResult.warnings.length > 0 && (
                <div style={{ opacity: 0.75, marginBottom: '0.5rem' }}>
                  <strong>Warnings ({camtrapResult.warnings.length}):</strong>
                  <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                    {(showAllWarnings ? camtrapResult.warnings : camtrapResult.warnings.slice(0, 3)).map((w, i) => (
                      <li key={i} style={{ marginBottom: '0.2rem', wordBreak: 'break-word' }}>{w}</li>
                    ))}
                  </ul>
                  {camtrapResult.warnings.length > 3 && (
                    <button
                      onClick={() => setShowAllWarnings(v => !v)}
                      style={{ marginTop: '0.35rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.75rem', padding: 0 }}
                    >
                      {showAllWarnings ? '▲ Show fewer' : `▼ Show all ${camtrapResult.warnings.length} warnings`}
                    </button>
                  )}
                </div>
              )}
              {camtrapResult.ai_job_id && (
                <div style={{ marginBottom: '0.5rem', opacity: 0.85 }}>
                  🧠 AI analysis (SpeciesNet + Wildlife Brain) queued for the bundled images — track it in Processing history.
                </div>
              )}
              <Link to="/insights" style={{ color: 'var(--primary)', fontWeight: 500, fontSize: '0.875rem', textDecoration: 'none' }}>
                View imported data in My Data →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Selected files summary (image mode) */}
      {files.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.8125rem' }}>
          <strong>{files.length} images selected</strong>
          <div style={{ opacity: 0.6, fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {(files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB total
            {folderDepCount > 0 && <span style={{ color: 'var(--success)', marginLeft: '0.5rem' }}>• {folderDepCount} deployment{folderDepCount > 1 ? 's' : ''} detected from folders</span>}
          </div>
        </div>
      )}

      {/* ── Google Drive storage note + deployment validation ────── */}
      {files.length > 0 && results.length === 0 && (
        <div
          className="card"
          style={{
            marginTop: '1rem',
            padding: '1rem 1.25rem',
            borderLeft: '3px solid var(--border)',
          }}
        >
          {/* Images always sync to Google Drive (default long-term storage) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.625rem',
            fontWeight: 500, fontSize: '0.875rem',
          }}>
            <span style={{ fontSize: '1rem' }}>☁️</span>
            <span style={{ opacity: 0.8 }}>
              Images are saved to your connected Google Drive folder for long-term storage.
            </span>
          </div>

          {hasInvalidDeployments && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem',
              borderRadius: 'var(--radius)',
              backgroundColor: 'rgba(255, 152, 0, 0.1)',
              border: '1px solid rgba(255, 152, 0, 0.3)',
              fontSize: '0.8125rem'
            }}>
              <strong style={{ color: '#e65100', display: 'block', marginBottom: '0.25rem' }}>
                ⚠️ Upload Will Fail for Some Images
              </strong>
              
              {notFoundDeployments.length > 0 && (
                <p style={{ margin: '0.5rem 0 0 0', opacity: 0.9, color: '#e65100' }}>
                  The following deployments <strong>do not exist in the database</strong>: <br />
                  <strong style={{ fontFamily: 'monospace' }}>{notFoundDeployments.join(', ')}</strong>.
                  <br />Assign these photos to an existing deployment or create one below.
                </p>
              )}
              
              {noAccessDeployments.length > 0 && (
                <p style={{ margin: '0.5rem 0 0 0', opacity: 0.9, color: '#e65100' }}>
                  The following deployments <strong>belong to a project you do not have access to</strong>: <br />
                  <strong style={{ fontFamily: 'monospace' }}>{noAccessDeployments.join(', ')}</strong>.
                  <br />Please contact your project administrator to request access.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Assign / create a deployment for uploads with no valid deployment ── */}
      {needsDeployment && (
        <div className="card" style={{ marginTop: '1rem', padding: '1rem 1.25rem', borderLeft: '3px solid var(--primary)' }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.35rem' }}>📍 Assign a deployment</div>
          <p style={{ fontSize: '0.8125rem', opacity: 0.7, marginTop: 0, marginBottom: '0.75rem' }}>
            {folderDepCount === 0
              ? "These photos have no deployment folder. If they don't carry a deployment ID in their EXIF, assign them to a deployment so they bind correctly."
              : "Some deployment folders don't exist yet. Assign these photos to an existing deployment or create a new one."}
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {(['existing', 'create'] as const).map(m => (
              <button
                key={m}
                onClick={() => setAssignMode(m)}
                style={{
                  padding: '0.3rem 0.75rem', fontSize: '0.8125rem', borderRadius: 'var(--radius)', cursor: 'pointer',
                  border: `1px solid ${assignMode === m ? 'var(--primary)' : 'var(--border)'}`,
                  background: assignMode === m ? 'rgba(76,175,80,0.12)' : 'transparent',
                  color: 'var(--text-color)', fontWeight: assignMode === m ? 600 : 400,
                }}
              >
                {m === 'existing' ? 'Use existing' : '+ Create new'}
              </button>
            ))}
          </div>

          {assignMode === 'existing' ? (
            <select value={assignedDeploymentId ?? ''} onChange={e => setAssignedDeploymentId(e.target.value || null)} style={FIELD}>
              <option value="">— Select a deployment —</option>
              {deployments.map(d => (
                <option key={d.id} value={d.id}>{d.location_name || d.id.slice(0, 8)}</option>
              ))}
            </select>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <select value={newDep.projectId} onChange={e => setNewDep(v => ({ ...v, projectId: e.target.value }))} style={FIELD}>
                <option value="">— Select a project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input placeholder="Deployment name" value={newDep.name} onChange={e => setNewDep(v => ({ ...v, name: e.target.value }))} style={FIELD} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input placeholder="Latitude (optional)" value={newDep.lat} onChange={e => setNewDep(v => ({ ...v, lat: e.target.value }))} style={FIELD} />
                <input placeholder="Longitude (optional)" value={newDep.lon} onChange={e => setNewDep(v => ({ ...v, lon: e.target.value }))} style={FIELD} />
              </div>
              <button className="btn" onClick={createDeployment} disabled={creatingDep} style={{ padding: '0.4rem 1rem', alignSelf: 'flex-start' }}>
                {creatingDep ? 'Creating…' : 'Create & assign'}
              </button>
              {createDepError && <span style={{ color: 'var(--error)', fontSize: '0.8125rem' }}>⚠ {createDepError}</span>}
            </div>
          )}

          {assignedDeploymentId && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.8125rem', color: 'var(--success)' }}>
              ✓ Assigning uploads to <strong>{deployments.find(d => d.id === assignedDeploymentId)?.location_name || assignedDeploymentId.slice(0, 8)}</strong>
            </div>
          )}
        </div>
      )}

      {/* ── Run-AI toggle (image mode) ──────────────────────────── */}
      {files.length > 0 && results.length === 0 && pipelineState.totalFiles === 0 && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '1rem', fontSize: '0.8125rem', cursor: 'pointer', maxWidth: 460, marginInline: 'auto' }}>
          <input type="checkbox" checked={runAi} onChange={e => setRunAi(e.target.checked)} style={{ marginTop: '0.15rem' }} />
          <span><strong>Run AI analysis + Wildlife Brain</strong> <span style={{ opacity: 0.65 }}>— SpeciesNet detection, species ID & clustering after upload</span></span>
        </label>
      )}

      {/* ── Analyse button ──────────────────────────────────────── */}
      {files.length > 0 && results.length === 0 && pipelineState.totalFiles === 0 && (
        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <button
            className="btn"
            disabled={analyseMutation.isPending}
            onClick={() => analyseMutation.mutate(files)}
            style={{ 
              padding: '0.75rem 2rem', 
              opacity: analyseMutation.isPending ? 0.7 : 1,
              transition: 'opacity 0.2s',
              width: analyseMutation.isPending ? '100%' : 'auto',
              maxWidth: '300px'
            }}
          >
            {analyseMutation.isPending ? `Starting Pipeline...` : `Analyse ${files.length} Image${files.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {analyseMutation.isError && (
        <p style={{ color: 'var(--error)', marginTop: '1rem', textAlign: 'center' }}>
          {(analyseMutation.error as Error).message}
        </p>
      )}

      {/* ── Pipeline status ─────────────────────────────────────── */}
      {pipelineState.totalFiles > 0 && (
          <PipelineStatusBox state={pipelineState} phase={derivePhase(pipelineState)} />
      )}

      {/* ── Results table ───────────────────────────────────────── */}
      {results.length > 0 && (
        <div style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>File</th>
                <th style={{ padding: '0.5rem' }}>Deployment</th>
                <th style={{ padding: '0.5rem' }}>GPS</th>
                <th style={{ padding: '0.5rem' }}>Date/Time</th>
                <th style={{ padding: '0.5rem' }}>Detection</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.filename}</td>
                  <td style={{ padding: '0.5rem' }}>
                    {r.matched_deployment ? (
                      <span style={{ color: 'var(--success)' }}>✓ {r.matched_deployment}</span>
                    ) : r.deployment_id ? (
                      <span style={{ color: 'var(--error)', fontSize: '0.75rem' }} title="Deployment not fully accessible">
                        ⚠️ <span style={{ fontFamily: 'monospace' }}>{r.deployment_id.slice(0, 8)}…</span> 
                        {invalidDeployments[r.deployment_id.slice(0, 8).toUpperCase()] === 'no_access' 
                          ? ' (No Access)' 
                          : ' (Not Found)'}
                      </span>
                    ) : (
                      <span style={{ opacity: 0.4 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>
                    {r.gps_lat !== null && r.gps_lon !== null ? (
                      `${Number(r.gps_lat).toFixed(4)}, ${Number(r.gps_lon).toFixed(4)}`
                    ) : (
                      <span style={{ opacity: 0.8, color: 'var(--error)' }}>⚠️ No GPS Info</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>{r.datetime || '—'}</td>
                  <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>{r.detection || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Near-duplicate clustering — temporarily hidden for cleaner UX */}
      {/*
      <div
        style={{
          marginTop: '2.5rem',
          paddingTop: '2rem',
          borderTop: '1px solid var(--border)',
        }}
      >
        <ImageClustering />
      </div>
      */}
    </div>
  )
}
