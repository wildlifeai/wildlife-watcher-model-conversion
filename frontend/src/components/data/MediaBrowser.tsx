 
import { useState, useEffect, useMemo, useCallback } from 'react'
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
  media_assets: MediaAssetRecord[] | null
  observations: ObservationRecord[]
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
  reviewer_id?: string | null
  annotator_id?: string | null
  bbox_x?: number | null
  bbox_y?: number | null
  bbox_w?: number | null
  bbox_h?: number | null
}

interface Props {
  deployments: { id: string; location_name: string | null; project_id: string }[]
  /** WS5-T6: Pre-select a deployment when navigating from the upload dock. */
  initialDeploymentId?: string
}

type ThumbSize = 'small' | 'medium' | 'large'
type TimeOfDay = 'all' | 'day' | 'night'

/** Grid/thumbnail dimensions per size preset. */
const THUMB = {
  small:  { minWidth: 100, height: 80  },
  medium: { minWidth: 140, height: 110 },
  large:  { minWidth: 200, height: 160 },
} as const

const INAT_BTN: React.CSSProperties = {
  padding: '0.3rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  backgroundColor: 'transparent', color: 'var(--text-color)',
}
const INAT_BTN_ACTIVE: React.CSSProperties = { ...INAT_BTN, backgroundColor: '#74ac00', color: '#fff', borderColor: '#74ac00' }

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
  const asset = media.media_assets?.[0]
  const rendition = asset?.thumbnail_url || asset?.preview_url
  if (rendition) return rendition
  const filePath = media.file_path
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  const apiBase = import.meta.env.VITE_API_BASE_URL || ''
  return `${apiBase}/api/media/${media.id}/image?size=thumb`
}

/** Hour-based day/night split: day = 06:00–18:00. */
function getTimeOfDay(timestamp: string | null): 'day' | 'night' {
  if (!timestamp) return 'day'   // unknown → treat as day (no false exclusions)
  const h = new Date(timestamp).getHours()
  return h >= 6 && h < 18 ? 'day' : 'night'
}

// ── Component ────────────────────────────────────────────────────────────────

export function MediaBrowser({ deployments, initialDeploymentId }: Props) {
  const { user } = useAuth()
  const [media, setMedia]         = useState<MediaRecord[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null)

  // ── Primary filters (in ControlBar) ──────────────────────────────────────
  const [filterDeployment, setFilterDeployment] = useState<string>('')
  const [filterSpecies, setFilterSpecies]       = useState<string>('')
  const [filterStatus, setFilterStatus]         = useState<string>('')
  const [filterAnnotator, setFilterAnnotator]   = useState<string>('')
  const [thumbSize, setThumbSize]               = useState<ThumbSize>('medium')

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
  const [inatMode, setInatMode]         = useState(false)            // iNat selection mode
  const [inatSelected, setInatSelected] = useState<Set<string>>(new Set())
  const [inatStates, setInatStates]     = useState<Map<string, { state: INatState; uri: string | null }>>(new Map())
  const [inatBusy, setInatBusy]         = useState(false)
  const [inatMsg, setInatMsg]           = useState<string | null>(null)

  const toggleInat = (id: string) => setInatSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

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
        'review_status, source_type, reviewer_id, annotator_id, bbox_x, bbox_y, bbox_w, bbox_h)',
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
  const uploadToInat = async () => {
    if (inatSelected.size === 0 || inatBusy) return
    setInatBusy(true)
    setInatMsg('⬆ Uploading to iNaturalist…')
    try {
      const r = await inat.publish([...inatSelected])
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

  const annotatorList = useMemo(() => {
    const ids = new Set<string>()
    media.forEach(m => m.observations.forEach(o => { if (o.classified_by) ids.add(o.classified_by) }))
    return Array.from(ids).sort()
  }, [media])

  // ── Client-side filter chain ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = media

    if (filterSpecies) {
      result = result.filter(m => m.observations.some(o => o.scientific_name === filterSpecies))
    }
    if (filterAnnotator) {
      result = result.filter(m => m.observations.some(o => o.classified_by === filterAnnotator))
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
      result = result.filter(m => getTimeOfDay(m.timestamp) === filterTime)
    }

    return result
  }, [media, filterSpecies, filterAnnotator, filterStatus, filterDateFrom, filterDateTo, filterTime])

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

  const { minWidth, height } = THUMB[thumbSize]

  const thumbToggle = (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {(['small', 'medium', 'large'] as ThumbSize[]).map((s, i) => (
        <button
          key={s}
          title={`${s.charAt(0).toUpperCase() + s.slice(1)} thumbnails`}
          onClick={() => setThumbSize(s)}
          style={{
            padding: '0.35rem 0.7rem',
            fontSize: '0.75rem',
            border: 'none',
            borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
            backgroundColor: thumbSize === s ? 'var(--primary)' : 'transparent',
            color: thumbSize === s ? '#fff' : 'var(--text-color)',
            transition: 'background-color 0.15s',
          }}
        >
          {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
        </button>
      ))}
    </div>
  )

  return (
    <div>
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
                    { value: 'issue',    label: '✕ Issue'       },
                  ]} />
              ) },
              { id: 'annotator', title: 'Annotator', content: (
                <FilterSelect value={filterAnnotator} onChange={setFilterAnnotator} placeholder="Any annotator"
                  options={annotatorList.map(a => ({ value: a, label: a }))} />
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
            id: 'view', label: 'View', icon: '🗗',
            groups: [
              { id: 'thumbs', title: 'Thumbnail size', content: thumbToggle },
            ],
          },
          ...(inat.enabled ? [{
            id: 'inat', label: 'iNaturalist', icon: '🕊',
            groups: [
              {
                id: 'inat-account', title: 'Account',
                content: inat.connected
                  ? <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>✓ {inat.username || 'Connected'}</span>
                  : <button onClick={() => inat.connect()} style={INAT_BTN}>🔗 Connect</button>,
              },
              {
                id: 'inat-select', title: 'Selection',
                content: (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button
                      onClick={() => { setInatMode(v => !v); setInatSelected(new Set()) }}
                      style={inatMode ? INAT_BTN_ACTIVE : INAT_BTN}
                      title="Toggle selecting photos to publish to iNaturalist"
                    >
                      {inatMode ? '☑ Selecting' : '☐ Select photos'}
                    </button>
                    {inatMode && <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{inatSelected.size} selected</span>}
                  </div>
                ),
              },
              {
                id: 'inat-upload', title: 'Publish',
                content: (
                  <button
                    onClick={uploadToInat}
                    disabled={!inat.connected || inatSelected.size === 0 || inatBusy}
                    style={(!inat.connected || inatSelected.size === 0 || inatBusy)
                      ? { ...INAT_BTN, opacity: 0.45, cursor: 'not-allowed' }
                      : INAT_BTN_ACTIVE}
                    title={!inat.connected ? 'Connect your iNaturalist account first (Account group)' : undefined}
                  >
                    {inatBusy ? '⏳ Uploading…' : `⬆ Upload ${inatSelected.size} to iNat`}
                  </button>
                ),
              },
              {
                id: 'inat-sync', title: 'Community IDs',
                content: (
                  <button
                    onClick={syncFromInat}
                    disabled={!inat.connected || inatBusy}
                    style={(!inat.connected || inatBusy) ? { ...INAT_BTN, opacity: 0.45, cursor: 'not-allowed' } : INAT_BTN}
                    title="Pull the latest community identifications from iNaturalist and update badges"
                  >
                    {inatBusy ? '⏳…' : '↻ Sync IDs'}
                  </button>
                ),
              },
            ],
          }] : []),
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

      {/* ── KPI row ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', fontSize: '0.8125rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: thumbSize === 'small' ? '0.5rem' : '0.75rem',
          }}>
            {filtered.map(m => {
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
              // A reviewed "blank" observation = confirmed empty (no animals).
              // Show "Empty" rather than the ambiguous "No label" placeholder.
              const isEmpty = !!topObs && !topObs.scientific_name && topObs.observation_type === 'blank'
              const label  = topObs?.scientific_name || (isEmpty ? 'Empty' : null)
              const conf   = topObs?.classification_probability ?? null
              const isSelected = selectedMediaId === m.id
              const inatSt  = inatStates.get(m.id)            // iNat upload/sync state (if any)
              const inatSel = inatMode && inatSelected.has(m.id)

              return (
                <div
                  key={m.id}
                  onClick={() => (inatMode ? toggleInat(m.id) : setSelectedMediaId(isSelected ? null : m.id))}
                  style={{
                    border: isSelected ? '2px solid var(--primary)' : inatSel ? '2px solid #74ac00' : '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    backgroundColor: 'var(--surface)',
                    transition: 'border-color 0.15s, transform 0.15s',
                    transform: isSelected ? 'scale(1.02)' : undefined,
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
                          annotStatus === 'ai' && conf !== null
                            ? `AI ${(conf * 100).toFixed(0)}%`
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

                    {/* iNat selection checkbox — bottom-left, only in select mode */}
                    {inatMode && (
                      <span style={{
                        position: 'absolute', bottom: 4, left: 4, width: 18, height: 18,
                        borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', fontWeight: 700,
                        backgroundColor: inatSel ? '#74ac00' : 'rgba(0,0,0,0.45)',
                        color: '#fff', boxShadow: '0 0 0 1.5px rgba(255,255,255,0.85)',
                      }}>
                        {inatSel ? '✓' : ''}
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
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Full-screen labeling modal */}
        {selectedMedia && (
          <MediaDetail
            media={selectedMedia}
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
    </div>
  )
}

