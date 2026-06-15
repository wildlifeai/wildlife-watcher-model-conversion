 
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useINat } from '../../hooks/useINat'
import { INatBadge, type INatState } from './INatBadge'
import { MediaDetail } from './MediaDetail'
import { FilterSelect } from '../ui/ControlBar'
import { Ribbon } from '../ui/Ribbon'
import { StatusBadge, deriveAnnotationStatus } from '../ui/StatusBadge'
import type { AnnotationStatus } from '../ui/StatusBadge'
import { Modal } from '../ui/Modal'
import { isHumanReviewed, isAiLabel } from '../../lib/observations'
import { getTimeOfDay, formatCaptureTime } from '../../lib/time'
import { MediaGroup } from './MediaGroup'
import { useMultiClusters } from '../../hooks/useBrain'
import { useJobsList } from '../../hooks/useJobs'
import { MediaBulkActions, type BulkAction } from './MediaBulkActions'
import { DeleteConfirmModal, AiModelPickerModal, PipelineLogModal } from './BulkActionModals'

// ── Types ────────────────────────────────────────────────────────────────────

export interface MediaAssetRecord {
  thumbnail_url: string | null
  preview_url: string | null
  animal_crop_url: string | null
}

export interface MediaRecord {
  id: string
  deployment_id: string
  file_path: string
  file_name: string | null
  file_mediatype: string
  timestamp: string | null
  file_public: boolean
  media_comments: string | null
  exif_metadata: Record<string, unknown> | null
  // 1:1 rendition row (MEDIA_PREP): public Supabase Storage URLs for the grid.
  // PostgREST returns this to-one embed as a single object (media_id is the PK),
  // but tolerate an array too in case the relationship is ever re-detected.
  media_assets: MediaAssetRecord | MediaAssetRecord[] | null
  observations: ObservationRecord[]
}

/** Normalise the media_assets embed (PostgREST returns a single object for to-one). */
function firstAsset(a: MediaAssetRecord | MediaAssetRecord[] | null | undefined): MediaAssetRecord | undefined {
  return Array.isArray(a) ? a[0] : (a ?? undefined)
}

export interface ObservationRecord {
  id: string
  deployment_id: string
  media_id: string | null
  observation_type: string | null
  scientific_name: string | null
  vernacular_name?: string | null
  taxon_id?: string | null
  count: number | null
  life_stage: string | null
  sex: string | null
  behavior: string | null
  classification_method: string | null
  classified_by: string | null
  classification_probability: number | null
  observation_comments: string | null
  // AN-1/AN-2: validation provenance + lifecycle (authoritative for status)
  review_status?: string | null
  source_type?: string | null
  source_model_version?: string | null
  reviewer_id?: string | null
  annotator_id?: string | null
  bbox_x?: number | null
  bbox_y?: number | null
  bbox_w?: number | null
  bbox_h?: number | null
}

interface Props {
  deployments: { id: string; location_name: string | null; project_id: string; timezone?: string | null }[]
  /** WS5-T6: Pre-select a deployment when navigating from the upload dock. */
  initialDeploymentId?: string
  /** Pre-apply a species filter (e.g. deep-linked from an Insights chart). */
  initialSpecies?: string
}

type TimeOfDay = 'all' | 'day' | 'night'
type GroupBy = 'none' | 'cluster' | 'species' | 'sex' | 'life_stage' | 'annotation_type' | 'deployment' | 'model' | 'annotator'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a media record to a displayable image URL for the grid.
 *
 * - Rendition (MEDIA_PREP) → public Supabase Storage thumbnail/preview, used directly.
 *   This is the primary path: the auth-gated /api/media/{id}/image proxy below cannot
 *   work from a plain <img> tag (no Authorization header), so for gdrive:// originals
 *   the rendition is the ONLY thing that renders.
 * - Public http/https file_path → use directly.
 * - Otherwise → backend proxy (only resolves for public files; gdrive:// without a
 *   rendition will show the placeholder).
 */
function resolveImageUrl(media: MediaRecord): string | null {
  const asset = firstAsset(media.media_assets)
  const rendition = asset?.thumbnail_url || asset?.preview_url
  if (rendition) return rendition
  const filePath = media.file_path
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  const apiBase = import.meta.env.VITE_API_BASE_URL || ''
  return `${apiBase}/api/media/${media.id}/image?size=thumb`
}


// ── Processing banner ─────────────────────────────────────────────────────────
// Explains blank thumbnails / missing labels: when an upload or AI run is still
// processing a deployment the user is looking at, the grid would otherwise show
// empty cards with no reason. Driven by the user's active jobs (GET /api/jobs),
// intersected with the deployments currently in view.
function ProcessingBanner({ deployments }: { deployments: Props['deployments'] }) {
  const { data: jobs } = useJobsList()
  const viewIds = new Set(deployments.map(d => d.id))
  const names = new Map(deployments.map(d => [d.id, d.location_name || d.id.slice(0, 8)]))

  const active = (jobs ?? []).filter(
    j => (j.status === 'queued' || j.status === 'processing') && (j.deployment_ids ?? []).some(id => viewIds.has(id)),
  )
  if (active.length === 0) return null

  const depIds = [...new Set(active.flatMap(j => (j.deployment_ids ?? []).filter(id => viewIds.has(id))))]
  const depNames = depIds.map(id => names.get(id) || id.slice(0, 8))
  const shown = depNames.length <= 3 ? depNames.join(', ') : `${depNames.slice(0, 3).join(', ')} +${depNames.length - 3} more`
  const isOne = depIds.length === 1

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.6rem 0.9rem', marginBottom: '0.75rem',
        border: '1px solid rgba(59,130,246,0.4)', borderRadius: 'var(--radius)',
        backgroundColor: 'rgba(59,130,246,0.08)', fontSize: '0.8125rem',
      }}
    >
      <span style={{ fontSize: '1rem', animation: 'spin 1.4s linear infinite' }}>⟳</span>
      <span>
        <strong>Processing</strong> — AI analysis is running for {isOne ? 'deployment ' : 'deployments '}
        <strong>{shown}</strong>. Thumbnails and labels for {isOne ? 'it' : 'these'} will appear as they complete.
        See <em>Processing history</em> (avatar menu) for live progress.
      </span>
      <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function MediaBrowser({ deployments, initialDeploymentId, initialSpecies }: Props) {
  const { user } = useAuth()
  // deployment_id → IANA timezone, so capture times render in the photo's local zone.
  const tzByDeployment = useMemo(
    () => new Map(deployments.map(d => [d.id, d.timezone ?? null])),
    [deployments],
  )
  const [media, setMedia]         = useState<MediaRecord[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null)

  // ── Primary filters (in ControlBar) ──────────────────────────────────────
  const [filterDeployment, setFilterDeployment] = useState<string>('')
  const [filterSpecies, setFilterSpecies]       = useState<string>(initialSpecies ?? '')
  const [filterStatus, setFilterStatus]         = useState<string>('')
  const [filterAnnotator, setFilterAnnotator]   = useState<string>('')
  const [filterModel, setFilterModel]           = useState<string>('')
  const [filterAnnotationType, setFilterAnnotationType] = useState<string>('')
  const [filterSex, setFilterSex]               = useState<string>('')
  const [filterLifeStage, setFilterLifeStage]   = useState<string>('')
  const [thumbScale, setThumbScale]             = useState(() => {
    const saved = localStorage.getItem('ww:thumbScale')
    return saved ? Number(saved) : 140
  })
  const [groupBy, setGroupBy]                   = useState<GroupBy>(() => {
    return (localStorage.getItem('ww:groupBy') as GroupBy) || 'none'
  })
  const [clusterThreshold, setClusterThreshold] = useState(0.0)

  // Persist thumbScale and groupBy to localStorage
  useEffect(() => { localStorage.setItem('ww:thumbScale', String(thumbScale)) }, [thumbScale])
  useEffect(() => { localStorage.setItem('ww:groupBy', groupBy) }, [groupBy])

  // ── Advanced filter state ─────────────────────────────────────────────────
  const [advancedOpen, setAdvancedOpen]   = useState(false)
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo]     = useState('')
  const [filterTime, setFilterTime]         = useState<TimeOfDay>('all')

  // WS5-T2: pagination state
  const PAGE_SIZE = 100
  const [page, setPage]           = useState(0)
  const [totalCount, setTotalCount] = useState<number | null>(null)

  // ── Phase 3: iNaturalist publish + tracking ───────────────────────────────
  const inat = useINat()
  const [, setInatMode]         = useState(false)            // iNat selection mode
  const [inatSelected, setInatSelected] = useState<Set<string>>(new Set())
  const [inatStates, setInatStates]     = useState<Map<string, { state: INatState; uri: string | null }>>(new Map())
  const [inatBusy, setInatBusy]         = useState(false)
  const [inatMsg, setInatMsg]           = useState<string | null>(null)

  // ── Phase 4: Unified selection (click = select, double-click = open) ───────
  // Selection is implicit: it's "on" whenever at least one image is selected.
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  // Pending single-click timer, so a fast double-click opens the detail modal
  // without toggling selection first.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showDeleteModal, setShowDeleteModal]   = useState(false)
  const [showAiPicker, setShowAiPicker]         = useState(false)
  const [pipelineLogs, setPipelineLogs]         = useState<string[] | null>(null)
  // Quick in-context connect: paste a personal API token (Pathway 2). The full
  // guided panel lives on the Other page; this is the convenience entry point.
  const connectInat = useCallback(async () => {
    const t = window.prompt(
      'Paste your iNaturalist API token\n(open https://www.inaturalist.org/users/api_token, log in, and copy the api_token value):',
    )
    if (!t || !t.trim()) return
    try {
      await inat.setToken(t)
    } catch {
      setInatMsg('iNaturalist token was rejected — copy the full api_token and try again.')
    }
  }, [inat])

  // const toggleInat = (id: string) => setInatSelected(prev => {
  //   const next = new Set(prev)
  //   if (next.has(id)) next.delete(id)
  //   else next.add(id)
  //   return next
  // })

  // Load iNat upload/sync state for a set of media (graceful if table absent).
  const loadInatStates = useCallback(async (ids: string[]) => {
    if (ids.length === 0) { setInatStates(new Map()); return }
    const { data, error: err } = await supabase
      .from('inat_observation_media')
      .select('media_id, inat_observations(sync_status, inat_uri)')
      .in('media_id', ids)
    if (err || !data) return  // table not migrated yet / no access → no badges
    const map = new Map<string, { state: INatState; uri: string | null }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of data as any[]) {
      const io = Array.isArray(row.inat_observations) ? row.inat_observations[0] : row.inat_observations
      if (io?.sync_status) map.set(row.media_id, { state: io.sync_status as INatState, uri: io.inat_uri ?? null })
    }
    setInatStates(map)
  }, [])

  // ── Unified selection helpers ──────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])

  // Single click toggles selection (after a short delay); a second click within
  // the window cancels the toggle and opens the full-screen detail instead.
  const handleCardClick = useCallback((id: string) => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      setSelectedMediaId(id)
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        toggleSelect(id)
      }, 250)
    }
  }, [toggleSelect])

  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current) }, [])

  const handleBulkAction = useCallback(async (action: BulkAction) => {
    if (action === 'delete') {
      setShowDeleteModal(true)
    } else if (action === 'ai') {
      setShowAiPicker(true)
    } else if (action === 'inat-sync') {
      if (!inat.connected) {
        connectInat()
        return
      }
      syncFromInat()
    } else if (action === 'inat') {
      if (!inat.connected) {
        connectInat()
        return
      }
      // Upload the unified selection. Pass the ids directly: setInatSelected is
      // async, so uploadToInat() reading inatSelected here would see the stale
      // (empty) set and silently no-op.
      setInatSelected(selectedIds)
      setInatMode(true)
      uploadToInat(selectedIds)
    }
    // syncFromInat/uploadToInat are plain (unmemoised) functions declared below;
    // including them would just defeat the memo without changing behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inat.connected, connectInat, selectedIds])

  const handleBatchDelete = useCallback(async (ids: string[]) => {
    const resp = await fetch('/api/media/batch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_ids: ids }),
    })
    if (!resp.ok) throw new Error('Delete failed')
    // Remove deleted media from local state
    setMedia(prev => prev.filter(m => !ids.includes(m.id)))
    setSelectedIds(new Set())
  }, [])

  const handleRunAi = useCallback(async (models: string[]) => {
    const ids = Array.from(selectedIds)
    setPipelineLogs([`Starting AI pipeline for ${ids.length} images with models: ${models.join(', ')}…`])
    try {
      const resp = await fetch('/api/media/run-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_ids: ids, steps: models }),
      })
      if (!resp.ok) throw new Error('Pipeline request failed')
      const data = await resp.json()
      setPipelineLogs(prev => [...(prev || []), `✓ Job queued: ${data.data?.job_id ?? 'unknown'}`])
    } catch (e: any) {
      setPipelineLogs(prev => [...(prev || []), `⚠ Error: ${e?.message || 'unknown'}`])
    }
  }, [selectedIds])

  // WS5-T6: honour initialDeploymentId on mount / when it changes
  useEffect(() => {
    if (initialDeploymentId) { setFilterDeployment(initialDeploymentId); setPage(0) }
  }, [initialDeploymentId])



  // Reset page when deployment filter changes
  useEffect(() => { setPage(0) }, [filterDeployment, deployments])

  // ── Fetch media (with pagination) ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return

    const deploymentIds = filterDeployment
      ? [filterDeployment]
      : deployments.map(d => d.id)

    if (deploymentIds.length === 0) {
      setMedia([])
      setTotalCount(0)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const from = page * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    supabase
      .from('media')
      .select(
        'id, deployment_id, file_path, file_name, file_mediatype, timestamp, file_public, media_comments, exif_metadata, ' +
        'media_assets(thumbnail_url, preview_url, animal_crop_url), ' +
        'observations(id, deployment_id, media_id, observation_type, scientific_name, vernacular_name, taxon_id, ' +
        'count, life_stage, sex, behavior, ' +
        'classification_method, classified_by, classification_probability, observation_comments, ' +
        'review_status, source_type, source_model_version, reviewer_id, annotator_id, bbox_x, bbox_y, bbox_w, bbox_h)',
        { count: 'exact' }
      )
      .in('deployment_id', deploymentIds)
      .is('deleted_at', null)
      .order('timestamp', { ascending: false, nullsFirst: false })
      .range(from, to)
      .then(({ data, error: err, count }) => {
        if (cancelled) return
        if (err) { setError(err.message); setLoading(false); return }
        setMedia((data || []) as unknown as MediaRecord[])
        setTotalCount(count ?? null)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [user, deployments, filterDeployment, page])

  // Refresh iNaturalist badges whenever the loaded media set changes.
  useEffect(() => { loadInatStates(media.map(m => m.id)) }, [media, loadInatStates])

  // Upload the iNat-selected media to iNaturalist (burst-consolidated).
  // Accepts an explicit id set so callers can avoid the async-state trap;
  // falls back to inatSelected when called without args.
  const uploadToInat = async (ids?: Set<string>) => {
    const toPublish = ids ?? inatSelected
    if (toPublish.size === 0 || inatBusy) return
    setInatBusy(true)
    setInatMsg('⬆ Uploading to iNaturalist…')
    try {
      const r = await inat.publish([...toPublish])
      setInatMsg(
        `✓ ${r.observations_created} observation(s), ${r.photos_uploaded} photo(s)` +
        (r.skipped_bycatch ? ` · ${r.skipped_bycatch} by-catch skipped` : '') +
        (r.skipped_already_published ? ` · ${r.skipped_already_published} already on iNat` : '') +
        (r.errors ? ` · ${r.errors} error(s)` : ''),
      )
      setInatSelected(new Set())
      await loadInatStates(media.map(m => m.id))
    } catch (e) {
      setInatMsg(`⚠ ${(e as Error)?.message ?? 'Upload failed'}`)
    } finally {
      setInatBusy(false)
    }
  }

  // Pull community identifications from iNaturalist and refresh the badges.
  const syncFromInat = async () => {
    if (inatBusy) return
    setInatBusy(true)
    setInatMsg('↻ Syncing community IDs from iNaturalist…')
    try {
      const r = await inat.sync()
      setInatMsg(
        `✓ Synced ${r.updated}/${r.checked} · ${r.research} research-grade · ` +
        `${r.disagreement} disagreement · ${r.observations_written} community ID(s) written`,
      )
      await loadInatStates(media.map(m => m.id))
    } catch (e) {
      setInatMsg(`⚠ ${(e as Error)?.message ?? 'Sync failed'}`)
    } finally {
      setInatBusy(false)
    }
  }

  // ── Derived filter options ────────────────────────────────────────────────
  const speciesList = useMemo(() => {
    const names = new Set<string>()
    media.forEach(m => m.observations.forEach(o => { if (o.scientific_name) names.add(o.scientific_name) }))
    return Array.from(names).sort()
  }, [media])

  const humanAnnotatorList = useMemo(() => {
    const names = new Set<string>()
    media.forEach(m => m.observations.forEach(o => {
      if (o.classification_method === 'human' && o.classified_by) names.add(o.classified_by)
    }))
    return Array.from(names).sort()
  }, [media])

  const modelList = useMemo(() => {
    const models = new Set<string>()
    media.forEach(m => m.observations.forEach(o => {
      const v = o.source_model_version || (o.classification_method === 'machine' ? o.classified_by : null)
      if (v) models.add(v)
    }))
    return Array.from(models).sort().map(v => ({
      value: v,
      label: v.startsWith('speciesnet') ? `SpeciesNet (${v.split('-').pop()})` :
             v.startsWith('bioclip')    ? `BioCLIP (${v.split('-').pop()})` : v,
    }))
  }, [media])

  const sexList = useMemo(() => {
    const vals = new Set<string>()
    media.forEach(m => m.observations.forEach(o => { if (o.sex) vals.add(o.sex) }))
    return Array.from(vals).sort()
  }, [media])

  const lifeStageList = useMemo(() => {
    const vals = new Set<string>()
    media.forEach(m => m.observations.forEach(o => { if (o.life_stage) vals.add(o.life_stage) }))
    return Array.from(vals).sort()
  }, [media])

  // ── Client-side filter chain ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = media

    if (filterSpecies) {
      result = result.filter(m => m.observations.some(o => o.scientific_name === filterSpecies))
    }
    if (filterAnnotator) {
      result = result.filter(m => m.observations.some(o =>
        o.classification_method === 'human' && o.classified_by === filterAnnotator
      ))
    }
    if (filterModel) {
      result = result.filter(m => m.observations.some(o =>
        (o.source_model_version === filterModel) ||
        (o.classification_method === 'machine' && o.classified_by === filterModel)
      ))
    }
    if (filterAnnotationType) {
      result = result.filter(m => {
        const hasBbox = m.observations.some(o => o.bbox_x != null)
        return filterAnnotationType === 'bbox' ? hasBbox : !hasBbox
      })
    }
    if (filterSex) {
      result = result.filter(m => m.observations.some(o => o.sex === filterSex))
    }
    if (filterLifeStage) {
      result = result.filter(m => m.observations.some(o => o.life_stage === filterLifeStage))
    }
    if (filterStatus) {
      result = result.filter(m => {
        const status = deriveAnnotationStatus({
          hasReviewed: m.observations.some(isHumanReviewed),
          hasAi:       m.observations.some(isAiLabel),
        })
        return status === (filterStatus as AnnotationStatus)
      })
    }
    if (filterDateFrom) {
      result = result.filter(m => !m.timestamp || m.timestamp >= filterDateFrom)
    }
    if (filterDateTo) {
      result = result.filter(m => !m.timestamp || m.timestamp <= filterDateTo + 'T23:59:59')
    }
    if (filterTime !== 'all') {
      result = result.filter(m => getTimeOfDay(m.timestamp, tzByDeployment.get(m.deployment_id)) === filterTime)
    }

    return result
  }, [media, filterSpecies, filterAnnotator, filterModel, filterAnnotationType, filterSex, filterLifeStage, filterStatus, filterDateFrom, filterDateTo, filterTime, tzByDeployment])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd+A: select all visible media (once a selection has started)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && selectedIds.size > 0) {
        e.preventDefault()
        setSelectedIds(new Set(filtered.map(m => m.id)))
      }
      // Escape: clear selection or close detail modal
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set())
        } else if (selectedMediaId) {
          setSelectedMediaId(null)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedIds.size, filtered, selectedMediaId])

  // ── Cluster data (only fetched when groupBy === 'cluster') ─────────────────
  const activeDeploymentIds = useMemo(() => {
    if (filterDeployment) return [filterDeployment]
    return deployments.map(d => d.id)
  }, [deployments, filterDeployment])
  const clustersQ = useMultiClusters(
    groupBy === 'cluster' ? activeDeploymentIds : [],
    clusterThreshold,
  )

  // ── Grouped media computation ─────────────────────────────────────────────
  const groupedMedia = useMemo(() => {
    if (groupBy === 'none') return null

    const groups = new Map<string, MediaRecord[]>()
    const deploymentNames = new Map(deployments.map(d => [d.id, d.location_name || d.id.slice(0, 8)]))

    // Cluster lookups (from the multi-cluster API): media → cluster_id, the set
    // of outliers, and any confirmed species name per cluster for nicer labels.
    const clusterData = clustersQ.data
    const mediaCluster = clusterData?.media_clusters ?? {}
    const outlierSet = new Set(clusterData?.outlier_media_ids ?? [])
    const clusterNames = new Map<number, string>()
    for (const c of clusterData?.clusters ?? []) {
      if (c.scientific_name && !clusterNames.has(c.cluster_id)) clusterNames.set(c.cluster_id, c.scientific_name)
    }

    for (const m of filtered) {
      let key: string
      switch (groupBy) {
        case 'cluster': {
          if (!clusterData) { key = '(Loading clusters…)'; break }
          if (outlierSet.has(m.id)) { key = '🟡 Outliers'; break }
          const cid = mediaCluster[m.id]
          // Not in any cluster yet (e.g. blank frame with no animal crop, or
          // embeddings not run for this deployment).
          if (cid == null) { key = '⧗ Not yet clustered'; break }
          key = clusterNames.get(cid) ?? `Cluster ${cid}`
          break
        }
        case 'species':
          key = m.observations[0]?.scientific_name || '(No species)'
          break
        case 'sex':
          key = m.observations[0]?.sex || '(Unknown)'
          break
        case 'life_stage':
          key = m.observations[0]?.life_stage || '(Unknown)'
          break
        case 'annotation_type':
          key = m.observations.some(o => o.bbox_x != null) ? 'Bounding box' : 'Whole image'
          break
        case 'deployment':
          key = deploymentNames.get(m.deployment_id) || m.deployment_id.slice(0, 8)
          break
        case 'model': {
          const aiObs = m.observations.find(o => o.classification_method === 'machine')
          key = aiObs?.source_model_version || aiObs?.classified_by || '(No AI model)'
          break
        }
        case 'annotator': {
          const humanObs = m.observations.find(o => o.classification_method === 'human')
          key = humanObs?.classified_by || '(No annotator)'
          break
        }
        default:
          key = '(Ungrouped)'
      }
      const list = groups.get(key) || []
      list.push(m)
      groups.set(key, list)
    }

    // Sort groups by size descending
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [filtered, groupBy, deployments, clustersQ.data])

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:          filtered.length,
    withDetections: filtered.filter(m => m.observations.some(isAiLabel)).length,
    annotated:      filtered.filter(m => m.observations.some(isHumanReviewed)).length,
    noImage:        filtered.filter(m => !m.file_path).length,
  }), [filtered])

  const hasAdvancedFilters = !!(filterDateFrom || filterDateTo || filterTime !== 'all')

  const clearAdvanced = () => {
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterTime('all')
  }

  const selectedMedia = filtered.find(m => m.id === selectedMediaId) || null

  const handleMediaUpdated = (updated: MediaRecord) => {
    setMedia(prev => prev.map(m => m.id === updated.id ? updated : m))
  }

  // AN-4: after a one-click Confirm/Blank, jump to the next image in the grid.
  const advanceToNext = () => {
    if (!selectedMediaId) return
    const idx = filtered.findIndex(m => m.id === selectedMediaId)
    const next = idx >= 0 && idx < filtered.length - 1 ? filtered[idx + 1] : null
    setSelectedMediaId(next ? next.id : null)
  }

  // Step back to the previous image in the grid (modal ‹ arrow).
  const advanceToPrev = () => {
    if (!selectedMediaId) return
    const idx = filtered.findIndex(m => m.id === selectedMediaId)
    if (idx > 0) setSelectedMediaId(filtered[idx - 1].id)
  }

  if (deployments.length === 0) {
    return <p style={{ opacity: 0.6, padding: '2rem 0' }}>Select a project or add deployments to browse media.</p>
  }

  // Pagination button style helper
  const PAGE_BTN = (disabled: boolean): React.CSSProperties => ({
    padding: '0.3rem 0.6rem', fontSize: '0.8125rem',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    backgroundColor: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? 'var(--text-color)' : 'var(--primary)',
    opacity: disabled ? 0.35 : 1,
  })

  const minWidth = thumbScale
  const height = Math.round(thumbScale * 0.78)

  // ── Thumbnail card renderer (shared by flat + grouped grids) ──────────────
  const renderThumbCard = (m: MediaRecord) => {
    const imgUrl = resolveImageUrl(m)

    // WS5-T4 / AN-2: derive status badge from the review_status contract
    const annotStatus = deriveAnnotationStatus({
      hasReviewed: m.observations.some(isHumanReviewed),
      hasAi:       m.observations.some(isAiLabel),
    })

    // Top label: human-reviewed first, then AI
    const sortedObs = [...m.observations].sort((a, b) => {
      const ar = isHumanReviewed(a) ? 1 : 0
      const br = isHumanReviewed(b) ? 1 : 0
      return br - ar
    })
    const topObs = sortedObs[0] || null
    const isEmpty = !!topObs && !topObs.scientific_name && topObs.observation_type === 'blank'
    const label  = topObs?.scientific_name || (isEmpty ? 'Empty' : null)
    const conf   = topObs?.classification_probability ?? null
    const aiConfs = m.observations
      .filter(o => isAiLabel(o) && o.classification_probability != null)
      .map(o => o.classification_probability as number)
    const lowestConf = aiConfs.length ? Math.min(...aiConfs) : null
    const isSelected = selectedMediaId === m.id
    const inatSt  = inatStates.get(m.id)
    const sel = selectedIds.has(m.id)

    return (
      <div
        key={m.id}
        onClick={() => handleCardClick(m.id)}
        title="Click to select · double-click to open"
        style={{
          border: sel ? '2px solid var(--primary)' : isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          cursor: 'pointer',
          backgroundColor: 'var(--surface)',
          transition: 'border-color 0.15s, transform 0.15s',
          transform: isSelected ? 'scale(1.02)' : undefined,
          userSelect: 'none',
        }}
      >
        {/* Thumbnail area */}
        <div style={{
          height,
          backgroundColor: imgUrl ? undefined : 'rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={m.file_name || 'media'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <span style={{ fontSize: '2rem', opacity: 0.3 }}>📷</span>
          )}

          {/* WS5-T4: Status badge — top-left overlay */}
          <span style={{ position: 'absolute', top: 4, left: 4 }}>
            <StatusBadge
              status={annotStatus}
              size="sm"
              label={
                annotStatus === 'ai' && lowestConf !== null
                  ? `${(lowestConf * 100).toFixed(0)}%`
                  : undefined
              }
            />
          </span>

          {/* Phase 3: iNaturalist dove badge — top-right overlay */}
          {inatSt && (
            <span style={{ position: 'absolute', top: 4, right: 4 }}>
              <INatBadge state={inatSt.state} uri={inatSt.uri} />
            </span>
          )}

          {/* Selection checkmark — bottom-left, shown while a selection is active */}
          {(sel || selectedIds.size > 0) && (
            <span style={{
              position: 'absolute', bottom: 4, left: 4, width: 18, height: 18,
              borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 700,
              backgroundColor: sel ? 'var(--primary)' : 'rgba(0,0,0,0.45)',
              color: '#fff', boxShadow: '0 0 0 1.5px rgba(255,255,255,0.85)',
            }}>
              {sel ? '✓' : ''}
            </span>
          )}
        </div>

        {/* Label bar */}
        <div style={{ padding: '0.375rem 0.5rem', fontSize: '0.6875rem' }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {topObs?.scientific_name
              ? label
              : isEmpty
                ? <span style={{ opacity: 0.6, fontStyle: 'italic' }}>Empty</span>
                : <span style={{ opacity: 0.4 }}>No label</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.6, fontSize: '0.625rem' }}>
            <span>{m.file_name || m.file_path.split('/').pop()}</span>
            {conf !== null && <span>{(conf * 100).toFixed(0)}%</span>}
          </div>
          {m.timestamp && (
            <div style={{ opacity: 0.5, fontSize: '0.625rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {formatCaptureTime(m.timestamp, tzByDeployment.get(m.deployment_id))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ── "Being processed" banner for in-view deployments ───────── */}
      <ProcessingBanner deployments={deployments} />

      {/* ── Ribbon command bar ────────────────────────────────────── */}
      <Ribbon
        status={<span><strong>{totalCount ?? stats.total}</strong> media</span>}
        tabs={[
          {
            id: 'filter', label: 'Filter', icon: '⛃',
            groups: [
              { id: 'deployment', title: 'Deployment', content: (
                <FilterSelect value={filterDeployment} onChange={setFilterDeployment} placeholder="All deployments"
                  options={deployments.map(d => ({ value: d.id, label: d.location_name || d.id.slice(0, 8) }))} />
              ) },
              { id: 'species', title: 'Species', content: (
                <FilterSelect value={filterSpecies} onChange={setFilterSpecies} placeholder="All species"
                  options={speciesList.map(s => ({ value: s, label: s }))} />
              ) },
              { id: 'status', title: 'Status', content: (
                <FilterSelect value={filterStatus} onChange={setFilterStatus} placeholder="Any status"
                  options={[
                    { value: 'ai',       label: 'AI identified' },
                    { value: 'reviewed', label: '✓ Reviewed'    },
                    { value: 'pending',  label: '⧗ Processing'  },
                    { value: 'issue',    label: '✕ Issue'       },
                  ]} />
              ) },
              { id: 'annotator', title: 'Annotator', content: (
                <FilterSelect value={filterAnnotator} onChange={setFilterAnnotator} placeholder="Any annotator"
                  options={humanAnnotatorList.map(a => ({ value: a, label: a }))} />
              ) },
              { id: 'model', title: 'AI Model', content: (
                <FilterSelect value={filterModel} onChange={setFilterModel} placeholder="Any model"
                  options={modelList} />
              ) },
              { id: 'annotation-type', title: 'Annotation', content: (
                <FilterSelect value={filterAnnotationType} onChange={setFilterAnnotationType} placeholder="Any type"
                  options={[
                    { value: 'bbox',  label: '▣ Bounding box' },
                    { value: 'whole', label: '▢ Whole image'  },
                  ]} />
              ) },
              { id: 'sex', title: 'Sex', content: (
                <FilterSelect value={filterSex} onChange={setFilterSex} placeholder="Any sex"
                  options={sexList.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />
              ) },
              { id: 'life-stage', title: 'Life stage', content: (
                <FilterSelect value={filterLifeStage} onChange={setFilterLifeStage} placeholder="Any stage"
                  options={lifeStageList.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />
              ) },
              {
                id: 'refine', title: 'Refine',
                launcher: () => setAdvancedOpen(true),
                launcherTitle: 'Advanced filters (date range, day/night)',
                launcherActive: hasAdvancedFilters,
                content: (
                  <button
                    onClick={() => setAdvancedOpen(true)}
                    style={{
                      padding: '0.35rem 0.7rem', fontSize: '0.75rem', cursor: 'pointer',
                      borderRadius: 'var(--radius)', whiteSpace: 'nowrap',
                      border: `1px solid ${hasAdvancedFilters ? 'var(--primary)' : 'var(--border)'}`,
                      backgroundColor: hasAdvancedFilters ? 'rgba(76,175,80,0.1)' : 'transparent',
                      color: hasAdvancedFilters ? 'var(--primary)' : 'var(--text-color)',
                    }}
                  >
                    ⚙ Date · Day/Night{hasAdvancedFilters ? ' ●' : ''}
                  </button>
                ),
              },
            ],
          },
          {
            id: 'group', label: 'Group', icon: '▦',
            groups: [
              { id: 'group-mode', title: 'Group by', content: (
                <FilterSelect value={groupBy} onChange={v => setGroupBy(v as GroupBy)} placeholder="None"
                  options={[
                    { value: 'none',            label: '— None' },
                    { value: 'cluster',         label: '🧠 Cluster (embeddings)' },
                    { value: 'species',         label: '🐾 Species' },
                    { value: 'sex',             label: '♀♂ Sex' },
                    { value: 'life_stage',      label: '🌱 Life stage' },
                    { value: 'annotation_type', label: '▣ Annotation type' },
                    { value: 'deployment',      label: '📍 Deployment' },
                    { value: 'model',           label: '🤖 AI model' },
                    { value: 'annotator',       label: '👤 Annotator' },
                  ]} />
              ) },
              ...(groupBy === 'cluster' ? [{ id: 'cluster-threshold', title: 'Similarity', content: (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Loose</span>
                  <input type="range" min={0} max={1} step={0.05} value={clusterThreshold}
                    onChange={e => setClusterThreshold(+e.target.value)}
                    style={{ width: 80, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Tight</span>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, minWidth: '2rem' }}>{(clusterThreshold * 100).toFixed(0)}%</span>
                  {clustersQ.isLoading && <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>⏳</span>}
                </div>
              ) }] : []),
            ],
          },
        ]}
      />

      {/* iNaturalist publish result banner */}
      {inatMsg && (
        <div style={{
          margin: '0 0 1rem', padding: '0.5rem 0.75rem', fontSize: '0.8125rem',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          backgroundColor: inatMsg.startsWith('⚠') ? 'rgba(239,68,68,0.08)' : 'rgba(116,172,0,0.1)',
          display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center',
        }}>
          <span>{inatMsg}</span>
          <button onClick={() => setInatMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>✕</button>
        </div>
      )}

      {/* ── KPI row (selection actions slot in on the left) ────────── */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', fontSize: '0.8125rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {selectedIds.size > 0 && (
          <MediaBulkActions
            selectedCount={selectedIds.size}
            onSelectAll={() => setSelectedIds(new Set(filtered.map(m => m.id)))}
            onClearSelection={() => setSelectedIds(new Set())}
            onAction={handleBulkAction}
            inatConnected={!!inat.connected}
          />
        )}
        <span>
          <strong>{totalCount ?? stats.total}</strong> media
          {totalCount !== null && totalCount > PAGE_SIZE && (
            <span style={{ opacity: 0.55 }}> (showing {stats.total} this page)</span>
          )}
        </span>
        <span>• <strong>{stats.withDetections}</strong> with detections</span>
        <span>• <strong>{stats.annotated}</strong> annotated</span>
        {stats.noImage > 0 && (
          <span style={{ color: 'var(--warning, #f59e0b)' }}>• <strong>{stats.noImage}</strong> without hosted image</span>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.7, flexShrink: 0 }}>
          <span>🔍</span>
          <input type="range" min={80} max={280} step={10} value={thumbScale}
            onChange={e => setThumbScale(+e.target.value)}
            style={{ width: 100, accentColor: 'var(--primary)', cursor: 'pointer' }} />
        </label>
        {hasAdvancedFilters && (
          <button
            onClick={clearAdvanced}
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: '0.75rem', color: 'var(--primary)',
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius)',
            }}
          >
            ✕ Clear advanced filters
          </button>
        )}
      </div>

      {loading && <p style={{ opacity: 0.6 }}>Loading media…</p>}
      {error && <p style={{ color: 'var(--error)' }}>⚠ {error}</p>}

      {/* ── No-image guidance banner ──────────────────────────────── */}
      {!loading && stats.noImage > 0 && stats.noImage === stats.total && (
        <div style={{
          padding: '1rem',
          marginBottom: '1rem',
          border: '1px solid var(--warning, #f59e0b)',
          borderRadius: 'var(--radius)',
          backgroundColor: 'rgba(245,158,11,0.06)',
          fontSize: '0.8125rem',
        }}>
          <strong>📷 No hosted images found</strong>
          <p style={{ marginTop: '0.5rem', opacity: 0.85 }}>
            The media records in this dataset reference local file paths (e.g. from a CamtrapDP import)
            that aren't accessible online. To view thumbnails, you can:
          </p>
          <ul style={{ paddingLeft: '1.25rem', marginTop: '0.375rem' }}>
            <li>Upload the original images via the <strong>Upload Data</strong> page and they will be associated with this deployment.</li>
            <li>If your images are already hosted online, update the <code>file_path</code> with valid URLs in the media detail panel.</li>
          </ul>
        </div>
      )}

      {/* ── Thumbnail grid (full width) — selecting a photo opens the modal ── */}
      <div>
        <div>
          {!loading && filtered.length === 0 && (
            <p style={{ opacity: 0.6, padding: '1rem 0' }}>No media records found for the selected filters.</p>
          )}
          {/* Grouped view — collapsible sections */}
          {groupedMedia ? groupedMedia.map(([groupLabel, groupItems]) => (
            <MediaGroup key={groupLabel} label={groupLabel} count={groupItems.length}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
                gap: thumbScale < 120 ? '0.5rem' : '0.75rem',
              }}>
                {groupItems.map(m => renderThumbCard(m))}
              </div>
            </MediaGroup>
          )) : (
          /* Flat (ungrouped) grid */
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: thumbScale < 120 ? '0.5rem' : '0.75rem',
          }}>
            {filtered.map(m => renderThumbCard(m))}
          </div>
          )}

        </div>

        {/* Full-screen labeling modal */}
        {selectedMedia && (
          <MediaDetail
            media={selectedMedia}
            timezone={tzByDeployment.get(selectedMedia.deployment_id)}
            onClose={() => setSelectedMediaId(null)}
            onUpdated={handleMediaUpdated}
            onNext={advanceToNext}
            onPrev={advanceToPrev}
          />
        )}
      </div>

      {/* ── Pagination (WS5-T2) ──────────────────────────────────── */}
      {totalCount !== null && totalCount > PAGE_SIZE && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '0.5rem', marginTop: '1.25rem', fontSize: '0.8125rem',
        }}>
          <button
            onClick={() => setPage(0)}
            disabled={page === 0}
            style={PAGE_BTN(page === 0)}
          >
            ««
          </button>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={PAGE_BTN(page === 0)}
          >
            ‹ Prev
          </button>
          <span style={{ opacity: 0.7, minWidth: '7rem', textAlign: 'center' }}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= totalCount}
            style={PAGE_BTN((page + 1) * PAGE_SIZE >= totalCount)}
          >
            Next ›
          </button>
          <button
            onClick={() => setPage(Math.ceil(totalCount / PAGE_SIZE) - 1)}
            disabled={(page + 1) * PAGE_SIZE >= totalCount}
            style={PAGE_BTN((page + 1) * PAGE_SIZE >= totalCount)}
          >
            »»
          </button>
        </div>
      )}

      {/* ── Advanced settings modal (WS5-T3) ─────────────────────── */}
      <Modal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="Advanced filters"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              onClick={clearAdvanced}
              style={{
                padding: '0.5rem 1rem', fontSize: '0.875rem',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: 'transparent', color: 'var(--text-color)', cursor: 'pointer',
              }}
            >
              Clear all
            </button>
            <button
              onClick={() => setAdvancedOpen(false)}
              style={{
                padding: '0.5rem 1.25rem', fontSize: '0.875rem',
                border: 'none', borderRadius: 'var(--radius)',
                background: 'var(--primary)', color: '#fff', cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Date range */}
          <section>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>Date range</div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ opacity: 0.7 }}>From</span>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={e => setFilterDateFrom(e.target.value)}
                  style={{
                    padding: '0.375rem 0.5rem', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', backgroundColor: 'var(--surface)',
                    color: 'var(--text-color)', fontSize: '0.8125rem',
                  }}
                />
              </label>
              <label style={{ fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ opacity: 0.7 }}>To</span>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={e => setFilterDateTo(e.target.value)}
                  style={{
                    padding: '0.375rem 0.5rem', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', backgroundColor: 'var(--surface)',
                    color: 'var(--text-color)', fontSize: '0.8125rem',
                  }}
                />
              </label>
            </div>
          </section>

          {/* Time of day */}
          <section>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>Time of day</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {([['all', 'All'], ['day', '☀ Day (06–18)'], ['night', '🌙 Night (18–06)']] as [TimeOfDay, string][]).map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setFilterTime(val)}
                  style={{
                    padding: '0.375rem 0.875rem', fontSize: '0.8125rem',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    backgroundColor: filterTime === val ? 'var(--primary)' : 'transparent',
                    color: filterTime === val ? '#fff' : 'var(--text-color)',
                    transition: 'background-color 0.15s',
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </section>

        </div>
      </Modal>

      {/* ── Bulk action modals ──────────────────────────────────── */}
      {showDeleteModal && (
        <DeleteConfirmModal
          mediaIds={Array.from(selectedIds)}
          fileNames={filtered.filter(m => selectedIds.has(m.id)).map(m => m.file_name || m.file_path.split('/').pop() || m.id)}
          onConfirm={handleBatchDelete}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
      {showAiPicker && (
        <AiModelPickerModal
          count={selectedIds.size}
          onRun={handleRunAi}
          onClose={() => setShowAiPicker(false)}
        />
      )}
      {pipelineLogs !== null && (
        <PipelineLogModal
          isRunning={pipelineLogs.length > 0 && !pipelineLogs[pipelineLogs.length - 1]?.startsWith('✓') && !pipelineLogs[pipelineLogs.length - 1]?.startsWith('⚠')}
          logs={pipelineLogs}
          onClose={() => setPipelineLogs(null)}
        />
      )}
    </div>
  )
}

