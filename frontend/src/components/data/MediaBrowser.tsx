import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import { MediaDetail } from './MediaDetail'

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaRecord {
  id: string
  deployment_id: string
  file_path: string
  file_name: string | null
  file_mediatype: string
  timestamp: string | null
  favorite: boolean
  file_public: boolean
  media_comments: string | null
  observations: ObservationRecord[]
}

export interface ObservationRecord {
  id: string
  deployment_id: string
  media_id: string | null
  observation_type: string | null
  scientific_name: string | null
  count: number | null
  life_stage: string | null
  sex: string | null
  behavior: string | null
  classification_method: string | null
  classified_by: string | null
  classification_probability: number | null
  observation_comments: string | null
  bbox_x?: number | null
  bbox_y?: number | null
  bbox_w?: number | null
  bbox_h?: number | null
}

interface Props {
  deployments: { id: string; location_name: string | null; project_id: string }[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a file_path to a displayable image URL.
 *
 * - Public URLs (http/https) → use directly
 * - Private storage (gdrive://, relative paths, etc.) → proxy through backend
 * - Empty/missing → null (placeholder shown)
 */
function resolveImageUrl(filePath: string, mediaId: string, size: 'thumb' | 'full' = 'thumb'): string | null {
  if (!filePath) return null
  // Public URLs can be used directly in <img src>
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  // Everything else goes through the backend proxy (gdrive://, s3://, relative paths, etc.)
  const apiBase = import.meta.env.VITE_API_BASE_URL || ''
  return `${apiBase}/api/media/${mediaId}/image?size=${size}`
}

// ── Component ────────────────────────────────────────────────────────────────

export function MediaBrowser({ deployments }: Props) {
  const { user } = useAuth()
  const [media, setMedia] = useState<MediaRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null)

  // Filters
  const [filterDeployment, setFilterDeployment] = useState<string>('')
  const [filterSpecies, setFilterSpecies] = useState<string>('')
  const [filterAnnotator, setFilterAnnotator] = useState<string>('')

  // Scope deployments to selected project
  const scopedDeployments = useMemo(() => {
    return deployments
  }, [deployments])

  // Fetch media
  useEffect(() => {
    if (!user) return

    const deploymentIds = filterDeployment
      ? [filterDeployment]
      : scopedDeployments.map(d => d.id)

    if (deploymentIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMedia([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('media')
      .select('id, deployment_id, file_path, file_name, file_mediatype, timestamp, favorite, file_public, media_comments, observations(id, deployment_id, media_id, observation_type, scientific_name, count, life_stage, sex, behavior, classification_method, classified_by, classification_probability, observation_comments, bbox_x, bbox_y, bbox_w, bbox_h)')
      .in('deployment_id', deploymentIds)
      .is('deleted_at', null)
      .order('timestamp', { ascending: false, nullsFirst: false })
      .limit(200)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err.message); setLoading(false); return }
        setMedia((data || []) as unknown as MediaRecord[])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [user, scopedDeployments, filterDeployment])

  // Derive filter options from loaded data
  const speciesList = useMemo(() => {
    const names = new Set<string>()
    media.forEach(m => {
      m.observations.forEach(o => { if (o.scientific_name) names.add(o.scientific_name) })
    })
    return Array.from(names).sort()
  }, [media])

  const annotatorList = useMemo(() => {
    const ids = new Set<string>()
    media.forEach(m => {
      m.observations.forEach(o => { if (o.classified_by) ids.add(o.classified_by) })
    })
    return Array.from(ids).sort()
  }, [media])

  // Apply client-side filters
  const filtered = useMemo(() => {
    let result = media
    if (filterSpecies) {
      result = result.filter(m =>
        m.observations.some(o => o.scientific_name === filterSpecies)
      )
    }
    if (filterAnnotator) {
      result = result.filter(m =>
        m.observations.some(o => o.classified_by === filterAnnotator)
      )
    }
    return result
  }, [media, filterSpecies, filterAnnotator])

  // KPI stats
  const stats = useMemo(() => ({
    total: filtered.length,
    withDetections: filtered.filter(m => m.observations.some(o => o.classification_method === 'machine')).length,
    annotated: filtered.filter(m => m.observations.some(o => o.classification_method === 'human')).length,
    favorites: filtered.filter(m => m.favorite).length,
    noImage: filtered.filter(m => !m.file_path).length,
  }), [filtered])

  const selectedMedia = filtered.find(m => m.id === selectedMediaId) || null

  const handleMediaUpdated = (updated: MediaRecord) => {
    setMedia(prev => prev.map(m => m.id === updated.id ? updated : m))
  }

  const selectStyle = {
    padding: '0.375rem 0.5rem',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-color)',
    fontSize: '0.8125rem',
  }

  if (deployments.length === 0) {
    return <p style={{ opacity: 0.6, padding: '2rem 0' }}>Select a project or add deployments to browse media.</p>
  }

  return (
    <div>
      {/* ── Filters ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <select value={filterDeployment} onChange={e => setFilterDeployment(e.target.value)} style={selectStyle}>
          <option value="">All deployments</option>
          {scopedDeployments.map(d => (
            <option key={d.id} value={d.id}>{d.location_name || d.id.slice(0, 8)}</option>
          ))}
        </select>

        <select value={filterSpecies} onChange={e => setFilterSpecies(e.target.value)} style={selectStyle}>
          <option value="">All species</option>
          {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={filterAnnotator} onChange={e => setFilterAnnotator(e.target.value)} style={selectStyle}>
          <option value="">All annotators</option>
          {annotatorList.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* ── KPI row ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', fontSize: '0.8125rem', flexWrap: 'wrap' }}>
        <span><strong>{stats.total}</strong> media</span>
        <span>• <strong>{stats.withDetections}</strong> with detections</span>
        <span>• <strong>{stats.annotated}</strong> annotated</span>
        <span>• <strong>{stats.favorites}</strong> ⭐</span>
        {stats.noImage > 0 && (
          <span style={{ color: 'var(--warning, #f59e0b)' }}>• <strong>{stats.noImage}</strong> without hosted image</span>
        )}
      </div>

      {loading && <p style={{ opacity: 0.6 }}>Loading media…</p>}
      {error && <p style={{ color: 'var(--error)' }}>⚠ {error}</p>}

      {/* ── No-image guidance banner ──────────────────────────── */}
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
            The media records in this dataset reference local file paths (e.g. from a CamtrapDP import) that aren't accessible online. To view thumbnails, you can:
          </p>
          <ul style={{ paddingLeft: '1.25rem', marginTop: '0.375rem' }}>
            <li>Upload the original images via the <strong>Upload Data</strong> page and they will be associated with this deployment.</li>
            <li>If your images are already hosted online, update the <code>file_path</code> with valid URLs in the media detail panel.</li>
          </ul>
        </div>
      )}

      {/* ── Grid + Detail layout ──────────────────────────────── */}
      <div style={{ display: 'flex', gap: '1.5rem' }}>
        {/* Thumbnail grid */}
        <div style={{ flex: selectedMedia ? '0 0 55%' : '1 1 100%', transition: 'flex 0.2s' }}>
          {!loading && filtered.length === 0 && (
            <p style={{ opacity: 0.6, padding: '1rem 0' }}>No media records found for the selected filters.</p>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '0.75rem',
          }}>
            {filtered.map(m => {
              const imgUrl = resolveImageUrl(m.file_path, m.id)
              // Prioritize human observations first, then machine
              const sortedObs = [...m.observations].sort((a, b) => {
                if (a.classification_method === 'human' && b.classification_method !== 'human') return -1
                if (a.classification_method !== 'human' && b.classification_method === 'human') return 1
                return 0
              })
              const topObs = sortedObs[0] || null
              const label = topObs?.scientific_name || null
              const conf = topObs?.classification_probability ?? null
              const isSelected = selectedMediaId === m.id

              return (
                <div
                  key={m.id}
                  onClick={() => setSelectedMediaId(isSelected ? null : m.id)}
                  style={{
                    border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
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
                    height: '100px',
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
                    {m.favorite && (
                      <span style={{ position: 'absolute', top: 4, right: 4, fontSize: '0.75rem' }}>⭐</span>
                    )}
                  </div>

                  {/* Label bar */}
                  <div style={{ padding: '0.375rem 0.5rem', fontSize: '0.6875rem' }}>
                    <div style={{
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {label || <span style={{ opacity: 0.4 }}>No label</span>}
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

        {/* Detail panel */}
        {selectedMedia && (
          <div style={{ flex: '0 0 43%', minWidth: 0 }}>
            <MediaDetail
              media={selectedMedia}
              onClose={() => setSelectedMediaId(null)}
              onUpdated={handleMediaUpdated}
            />
          </div>
        )}
      </div>
    </div>
  )
}
