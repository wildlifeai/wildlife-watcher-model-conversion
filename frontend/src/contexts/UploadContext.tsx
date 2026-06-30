/* eslint-disable react-refresh/only-export-components */
/**
 * UploadContext — global upload pipeline state.
 *
 * Lifts all upload state (multi-batch API loop, Drive-job polling,
 * modal open/close, progress dock visibility) out of the AnalyseImages
 * page component so it persists while the user navigates away.
 *
 * Usage:
 *   const { openModal, dockState, pipelineState, phase } = useUploadStore()
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { apiClient } from '../lib/apiClient'
import { registerLocalPreviews } from '../lib/localPreviewStore'
import type { PipelineState, PipelineJob, LogEntry } from '../components/toolkit/PipelineStatusBox'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type UploadPhase =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'stalled'

export type DockState = 'hidden' | 'minimised' | 'medium'

/** Minimal deployment shape needed for coordinate fallback and stats. */
export interface UploadDeployment {
  id: string
  project_id: string
  location_name: string | null
  latitude: number | null
  longitude: number | null
  deployment_start: string | null
}

interface UploadContextValue {
  // ── Modal ──────────────────────────────────────────────────────────────────
  modalOpen: boolean
  openModal: () => void
  closeModal: () => void

  // ── Pipeline ───────────────────────────────────────────────────────────────
  pipelineState: PipelineState
  phase: UploadPhase
  /** True while a batch loop is running or Drive jobs are still in-flight. */
  isActive: boolean

  // ── Actions ────────────────────────────────────────────────────────────────
  /** Kick off a multi-batch image upload. Closes the modal and shows the dock. */
  startUpload: (
    files: File[],
    paths: string[],
    uploadToDrive: boolean,
    deployments: UploadDeployment[],
  ) => Promise<void>
  clearUpload: () => void

  // ── Dock ───────────────────────────────────────────────────────────────────
  dockState: DockState
  setDockState: (s: DockState) => void

  // ── WS5-T6: deployment IDs from the most recent upload ────────────────────
  /** IDs of deployments included in the last upload batch. */
  uploadedDeploymentIds: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_PIPELINE: PipelineState = {
  totalFiles: 0,
  uploadedFiles: 0,
  jobs: [],
  logs: [],
  lastUpdateTs: 0,
}

export function derivePhase(state: PipelineState): UploadPhase {
  if (state.jobs.some((j) => j.status === 'failed')) return 'failed'

  if (
    state.jobs.length > 0 &&
    state.jobs.every((j) =>
      ['completed', 'completed_with_errors', 'failed', 'skipped'].includes(j.status),
    )
  )
    return 'completed'

  // Edge case: all files were duplicates — no jobs enqueued but upload finished
  if (
    state.totalFiles > 0 &&
    state.uploadedFiles === state.totalFiles &&
    state.jobs.length === 0
  )
    return 'completed'

  if (state.uploadedFiles < state.totalFiles) return 'uploading'

  const idleMs = Date.now() - state.lastUpdateTs
  if (idleMs > 15_000 && state.jobs.some((j) => j.status === 'processing')) return 'stalled'

  if (state.jobs.length > 0) return 'processing'
  return 'idle'
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const UploadContext = createContext<UploadContextValue | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 10

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [pipelineState, setPipelineState] = useState<PipelineState>(EMPTY_PIPELINE)
  const [dockState, setDockState] = useState<DockState>('hidden')
  const [uploadedDeploymentIds, setUploadedDeploymentIds] = useState<string[]>([])

  // Guards and tracking refs (don't need re-render)
  const busyRef = useRef(false)
  const lastSeenSeqRef = useRef<Record<string, number>>({})

  const phase = derivePhase(pipelineState)
  const isActive =
    phase === 'uploading' || phase === 'processing' || phase === 'stalled'

  // ── Modal helpers ──────────────────────────────────────────────────────────
  const openModal = useCallback(() => setModalOpen(true), [])
  const closeModal = useCallback(() => setModalOpen(false), [])

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clearUpload = useCallback(() => {
    if (busyRef.current) return          // don't clear mid-upload
    setPipelineState(EMPTY_PIPELINE)
    setDockState('hidden')
    setUploadedDeploymentIds([])
    lastSeenSeqRef.current = {}
  }, [])

  // ── Job polling ────────────────────────────────────────────────────────────
  useEffect(() => {
    const { jobs } = pipelineState
    if (jobs.length === 0) return

    const incomplete = jobs.filter((j) =>
      ['queued', 'in_progress', 'processing', 'deferred'].includes(j.status),
    )
    if (incomplete.length === 0) return

    const timer = setInterval(async () => {
      try {
        const updates = await Promise.all(
          jobs.map(async (job): Promise<PipelineJob> => {
            if (
              ['completed', 'completed_with_errors', 'failed', 'skipped'].includes(job.status)
            )
              return job

            try {
              const res = await apiClient.get(`/api/jobs/${job.id}`)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const j: any = res.data?.data ?? res.data ?? {}

              let status: string = j.status ?? job.status
              let progress: number = j.progress ?? job.progress

              if (progress >= 0.999 && ['in_progress', 'processing'].includes(status)) {
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
                // Transient — consumed below, stripped before storing in state
                _events: j.events ?? [],
              } as PipelineJob & { _events: unknown[] }
            } catch {
              return job
            }
          }),
        )

        let changed = false
        const logsToAdd: LogEntry[] = []
        // Jobs spawned by a running job (e.g. AI analysis offloaded to the GPU
        // worker) that the dock should chain onto so it keeps polling + the dock
        // stays open until the follow-on finishes.
        const childJobsToAdd: PipelineJob[] = []

        for (let i = 0; i < jobs.length; i++) {
          const prev = jobs[i]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const next = updates[i] as any

          if (
            prev.status !== next.status ||
            prev.progress !== next.progress ||
            prev.message !== next.message ||
            (next.eventCount ?? 0) > (prev.eventCount ?? 0)
          ) {
            changed = true
          }

          // Structured event consumption (seq-based de-dup)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const events: any[] = next._events ?? []
          const prevSeq = lastSeenSeqRef.current[next.id] ?? -1
           
          const newEvents = events
            .sort((a: any, b: any) => a.seq - b.seq)
            .filter((e: any) => e.seq > prevSeq)

          if (newEvents.length > 0) {
            lastSeenSeqRef.current[next.id] = newEvents[newEvents.length - 1].seq
            changed = true

            for (const evt of newEvents) {
              let level: LogEntry['level'] = 'info'
              if (evt.type === 'file_success' || evt.type === 'phase_complete')
                level = 'success'
              if (evt.type === 'file_failure' || evt.type === 'stall_warning')
                level = 'error'
              if (evt.type === 'file_skip') level = 'warning'
              if (evt.type === 'heartbeat') level = 'warning'

              logsToAdd.push({
                ts: new Date(evt.timestamp).getTime() || Date.now(),
                level,
                message: evt.message,
              })

              // Chain onto a spawned follow-on job (e.g. offloaded AI analysis).
              const childId: string | undefined = evt.child_job_id
              if (
                childId &&
                !jobs.some((j) => j.id === childId) &&
                !childJobsToAdd.some((c) => c.id === childId)
              ) {
                childJobsToAdd.push({ id: childId, status: 'queued', progress: 0, fileCount: 0 })
              }
            }
          } else if (next.message && next.message !== prev.message && events.length === 0) {
            // Fallback for job types without structured events
            let level: LogEntry['level'] = 'info'
            if (
              next.status === 'completed' ||
              next.status === 'completed_with_errors'
            )
              level = 'success'
            if (next.status === 'failed') level = 'error'
            logsToAdd.push({ ts: Date.now(), level, message: next.message })
          }

          delete next._events
        }

        // De-duplicate simultaneous identical log messages
        const seen = new Set<string>()
        const deduped = logsToAdd.filter((l) => {
          if (seen.has(l.message)) return false
          seen.add(l.message)
          return true
        })

        if (changed || childJobsToAdd.length > 0) {
          setPipelineState((prev) => ({
            ...prev,
            // Append any newly-spawned follow-on jobs so the dock keeps polling
            // them; the effect re-runs on the new jobs list and the dock stays
            // open until every job (including the chained AI job) is terminal.
            jobs: [...updates, ...childJobsToAdd],
            logs: [...prev.logs, ...deduped],
            lastUpdateTs: Date.now(),
          }))
        }
      } catch (e) {
        console.error('[UploadContext] polling failed', e)
      }
    }, 2000)

    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineState.jobs])

  // ── startUpload ────────────────────────────────────────────────────────────
  const startUpload = useCallback(
    async (
      files: File[],
      paths: string[],
      uploadToDrive: boolean,
      deployments: UploadDeployment[],
    ): Promise<void> => {
      if (busyRef.current) return
      busyRef.current = true

      // Store deployment IDs for the post-upload "View Annotations" smart link
      setUploadedDeploymentIds(deployments.map(d => d.id))

      // Instant thumbnails: mint object URLs from the user's own files now, so the
      // Annotations grid can show them within ~1s (before any server rendition).
      registerLocalPreviews(files)

      const totalBatches = Math.ceil(files.length / BATCH_SIZE)
      lastSeenSeqRef.current = {}

      // Initialise state, close modal, show dock
      setPipelineState({
        totalFiles: files.length,
        uploadedFiles: 0,
        jobs: [],
        logs: [
          {
            ts: Date.now(),
            level: 'info',
            message: `🚀 Starting upload for ${files.length} image${files.length !== 1 ? 's' : ''} (${totalBatches} batch${totalBatches !== 1 ? 'es' : ''})…`,
          },
        ],
        lastUpdateTs: Date.now(),
      })
      setModalOpen(false)
      setDockState('medium')

      try {
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          const batchNum = Math.floor(i / BATCH_SIZE) + 1
          const batchEnd = Math.min(i + BATCH_SIZE, files.length)
          const chunk = files.slice(i, i + BATCH_SIZE)
          const chunkPaths = paths.slice(i, i + BATCH_SIZE)

          setPipelineState((prev) => ({
            ...prev,
            logs: [
              ...prev.logs,
              {
                ts: Date.now(),
                level: 'info',
                message: `📦 Batch ${batchNum}/${totalBatches} — images ${i + 1}–${batchEnd}…`,
              },
            ],
            lastUpdateTs: Date.now(),
          }))

          const formData = new FormData()
          for (const f of chunk) formData.append('files', f)
          for (const p of chunkPaths) formData.append('paths', p)
          if (uploadToDrive) formData.append('upload_to_drive', 'true')

          try {
            const response = await apiClient.upload('/api/exif/parse', formData)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: any = response.data ?? {}
            const driveInfo = data.drive_upload

            setPipelineState((prev) => {
              const logs = [...prev.logs]
              const jobs = [...prev.jobs]

              if (driveInfo) {
                if (driveInfo.status === 'skipped') {
                  const reason =
                    driveInfo.reason === 'no_files_stored'
                      ? 'images already exist (duplicates)'
                      : driveInfo.reason
                  logs.push({
                    ts: Date.now(),
                    level: 'warning',
                    message: `⏭️ Batch ${batchNum} skipped: ${reason}`,
                  })
                } else if (driveInfo.job_id) {
                  jobs.push({
                    id: driveInfo.job_id,
                    status: driveInfo.status || 'queued',
                    progress: 0,
                    fileCount: driveInfo.file_count || chunk.length,
                  })
                  if ((driveInfo.duplicates_skipped ?? 0) > 0) {
                    logs.push({
                      ts: Date.now(),
                      level: 'warning',
                      message: `⏭️ ${driveInfo.duplicates_skipped} already exist (skipped).`,
                    })
                  }
                  if ((driveInfo.file_count ?? 0) > 0) {
                    logs.push({
                      ts: Date.now(),
                      level: 'success',
                      message: `✅ Buffered. Drive sync queued for ${driveInfo.file_count} images.`,
                    })
                  }
                } else if (driveInfo.status === 'error') {
                  logs.push({
                    ts: Date.now(),
                    level: 'error',
                    message: `❌ Azure/Drive failed: ${driveInfo.error || 'Unknown error'}`,
                  })
                }
              } else if (!uploadToDrive) {
                logs.push({
                  ts: Date.now(),
                  level: 'success',
                  message: `✅ Images ${i + 1}–${batchEnd} extracted.`,
                })
              }

              return { ...prev, uploadedFiles: batchEnd, jobs, logs, lastUpdateTs: Date.now() }
            })
          } catch (e: unknown) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = e as any
            const msg =
              err?.response?.data?.detail ??
              err?.response?.data?.error?.message ??
              err?.message ??
              String(err)
            setPipelineState((prev) => ({
              ...prev,
              logs: [
                ...prev.logs,
                {
                  ts: Date.now(),
                  level: 'error',
                  message: `❌ Batch ${batchNum} failed: ${msg}`,
                },
              ],
              uploadedFiles: Math.min(i + BATCH_SIZE, prev.totalFiles),
              lastUpdateTs: Date.now(),
            }))
          }
        }
      } finally {
        busyRef.current = false
      }
    },
    [],
  )

  return (
    <UploadContext.Provider
      value={{
        modalOpen,
        openModal,
        closeModal,
        pipelineState,
        phase,
        isActive,
        startUpload,
        clearUpload,
        dockState,
        setDockState,
        uploadedDeploymentIds,
      }}
    >
      {children}
    </UploadContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useUploadStore(): UploadContextValue {
  const ctx = useContext(UploadContext)
  if (!ctx) throw new Error('useUploadStore must be used within <UploadProvider>')
  return ctx
}

