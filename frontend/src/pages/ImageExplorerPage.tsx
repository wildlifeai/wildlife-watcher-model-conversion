import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMediaRegistry, type MediaRow } from '../hooks/useMediaRegistry'
import { useSimilarImages } from '../hooks/useBrain'

export function ImageExplorerPage() {
  const { deployment_id } = useParams<{ deployment_id: string }>()
  const { data, isLoading } = useMediaRegistry(deployment_id)
  const [selected, setSelected] = useState<MediaRow | null>(null)
  const [similarId, setSimilarId] = useState<string | null>(null)
  const similarQ = useSimilarImages(similarId, 12)

  const media = useMemo(() => data?.media || [], [data])
  const byId = useMemo(() => {
    const m: Record<string, MediaRow> = {}
    for (const x of media) m[x.id] = x
    return m
  }, [media])

  if (isLoading) return <div style={{ padding: '2rem' }}>Loading media…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--text-color)' }}>
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>Image Explorer</h3>
          <span style={{ fontSize: '0.8125rem', opacity: 0.7 }}>{media.length} images (page 1)</span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link to={`/clusters/${deployment_id}`} className="btn" style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', textDecoration: 'none', fontSize: '0.8125rem' }}>◧ Clusters</Link>
          <Link to={`/umap/${deployment_id}`} className="btn" style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', textDecoration: 'none', fontSize: '0.8125rem' }}>✦ UMAP</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
        {media.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelected(m)}
            style={{ padding: 0, border: selected?.id === m.id ? '2px solid var(--primary)' : '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', cursor: 'pointer', background: 'var(--surface)', aspectRatio: '4/3' }}
          >
            <img src={m.thumbnail_url || undefined} alt={m.file_name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        ))}
      </div>

      {/* Detail slide-out */}
      {selected && (
        <div style={{ position: 'fixed', top: 57, right: 0, bottom: 0, width: 360, background: 'var(--surface)', borderLeft: '1px solid var(--border)', padding: '1.25rem', overflowY: 'auto', zIndex: 50, boxShadow: '-8px 0 24px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.875rem' }}>{selected.file_name || selected.id.slice(0, 8)}</strong>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-color)', fontSize: '1.1rem' }}>✕</button>
          </div>
          <img src={selected.preview_url || selected.thumbnail_url || undefined} alt="" style={{ width: '100%', borderRadius: 'var(--radius)', margin: '0.75rem 0' }} />
          <button className="btn" onClick={() => setSimilarId(selected.id)} style={{ width: '100%', backgroundColor: 'var(--primary)', fontSize: '0.8125rem' }}>
            🔎 Show similar
          </button>

          {similarId === selected.id && (
            <div style={{ marginTop: '1rem' }}>
              <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{similarQ.isLoading ? 'Searching…' : 'Most similar'}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 6 }}>
                {(similarQ.data?.results || []).map((hit) => (
                  <div key={hit.media_id} title={`score ${hit.score.toFixed(3)}`} style={{ aspectRatio: '1', borderRadius: 3, overflow: 'hidden', background: 'var(--bg-color)' }}>
                    {byId[hit.media_id]?.thumbnail_url ? (
                      <img src={byId[hit.media_id].thumbnail_url || undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '0.55rem', opacity: 0.5, padding: 2, display: 'block' }}>{hit.media_id.slice(0, 6)}</span>
                    )}
                  </div>
                ))}
              </div>
              {similarQ.isError && <span style={{ fontSize: '0.7rem', color: '#f44336' }}>No embedding for this image yet.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
