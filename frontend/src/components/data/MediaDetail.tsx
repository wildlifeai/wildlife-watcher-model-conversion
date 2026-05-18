import { useState } from 'react'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { ObservationRecord, DetectionRecord } from './MediaBrowser'

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
  detections: DetectionRecord[]
}

interface Props {
  media: MediaRecord
  onClose: () => void
  onUpdated: (updated: MediaRecord) => void
}

const LIFE_STAGES = ['adult', 'subadult', 'juvenile', 'hatchling', 'unknown']
const SEX_OPTIONS = ['male', 'female', 'unknown']
const OBS_TYPES = ['animal', 'human', 'vehicle', 'blank', 'unknown']

function resolveImageUrl(filePath: string): string | null {
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  if (filePath.startsWith('media-files/') || filePath.startsWith('media/')) {
    const { data } = supabase.storage.from('media-files').getPublicUrl(filePath)
    return data?.publicUrl || null
  }
  return null
}

export function MediaDetail({ media, onClose, onUpdated }: Props) {
  const { user } = useAuth()
  const imgUrl = resolveImageUrl(media.file_path)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // ── Toggle favorite ────────────────────────────────────────────────────────
  const toggleFavorite = async () => {
    const { error } = await supabase
      .from('media')
      .update({ favorite: !media.favorite })
      .eq('id', media.id)
    if (!error) {
      onUpdated({ ...media, favorite: !media.favorite })
    }
  }

  // ── Toggle public ──────────────────────────────────────────────────────────
  const togglePublic = async () => {
    const { error } = await supabase
      .from('media')
      .update({ file_public: !media.file_public })
      .eq('id', media.id)
    if (!error) {
      onUpdated({ ...media, file_public: !media.file_public })
    }
  }

  // ── Update observation ─────────────────────────────────────────────────────
  const updateObservation = async (obsId: string, fields: Partial<ObservationRecord>) => {
    setSaving(true)
    setSaveMsg(null)
    const { error } = await supabase
      .from('observations')
      .update(fields)
      .eq('id', obsId)
    if (error) {
      setSaveMsg(`Error: ${error.message}`)
    } else {
      onUpdated({
        ...media,
        observations: media.observations.map(o => o.id === obsId ? { ...o, ...fields } : o),
      })
      setSaveMsg('Saved ✓')
      setTimeout(() => setSaveMsg(null), 2000)
    }
    setSaving(false)
  }

  // ── Add new observation ────────────────────────────────────────────────────
  const addObservation = async () => {
    setSaving(true)
    const newObs = {
      deployment_id: media.deployment_id,
      media_id: media.id,
      observation_level: 'media',
      observation_type: 'animal',
      classification_method: 'human',
      classified_by: user?.email || 'unknown',
      classification_timestamp: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from('observations')
      .insert(newObs)
      .select()
      .single()
    if (!error && data) {
      onUpdated({
        ...media,
        observations: [...media.observations, data as unknown as ObservationRecord],
      })
    }
    setSaving(false)
  }

  const inputStyle = {
    width: '100%',
    padding: '0.375rem 0.5rem',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-color)',
    fontSize: '0.8125rem',
  }

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'var(--surface)',
      overflow: 'hidden',
    }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.75rem 1rem',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
          {media.file_name || media.file_path.split('/').pop()}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={toggleFavorite} title="Toggle favorite"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>
            {media.favorite ? '⭐' : '☆'}
          </button>
          <button onClick={togglePublic} title="Toggle public"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', opacity: media.file_public ? 1 : 0.4 }}>
            {media.file_public ? '🌐' : '🔒'}
          </button>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6 }}>
            ✕
          </button>
        </div>
      </div>

      {/* ── Image / placeholder ────────────────────────────── */}
      <div style={{
        position: 'relative',
        width: '100%',
        minHeight: '200px',
        backgroundColor: 'rgba(0,0,0,0.03)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {imgUrl ? (
          <>
            <img src={imgUrl} alt={media.file_name || ''} style={{ width: '100%', display: 'block' }} />
            {/* Detection bounding boxes */}
            {media.detections.map(det => det.bbox && (
              <div
                key={det.id}
                style={{
                  position: 'absolute',
                  left: `${det.bbox.x * 100}%`,
                  top: `${det.bbox.y * 100}%`,
                  width: `${det.bbox.w * 100}%`,
                  height: `${det.bbox.h * 100}%`,
                  border: '2px solid rgba(76,175,80,0.8)',
                  borderRadius: '2px',
                  pointerEvents: 'none',
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: -18,
                  left: 0,
                  backgroundColor: 'rgba(76,175,80,0.85)',
                  color: '#fff',
                  fontSize: '0.625rem',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  whiteSpace: 'nowrap',
                }}>
                  {det.category} {det.confidence ? `${(det.confidence * 100).toFixed(0)}%` : ''}
                </span>
              </div>
            ))}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.5 }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📷</div>
            <div style={{ fontSize: '0.8125rem' }}>Image not hosted</div>
            <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Path: <code style={{ fontSize: '0.6875rem' }}>{media.file_path}</code>
            </div>
          </div>
        )}
      </div>

      {/* ── Metadata ───────────────────────────────────────── */}
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', opacity: 0.7 }}>
        {media.timestamp && <div>📅 {new Date(media.timestamp).toLocaleString()}</div>}
        <div>📁 {media.file_mediatype}</div>
        {media.detections.length > 0 && <div>🔍 {media.detections.length} detection{media.detections.length > 1 ? 's' : ''}</div>}
      </div>

      {/* ── Observations ───────────────────────────────────── */}
      <div style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '0.8125rem' }}>Observations ({media.observations.length})</strong>
          {saveMsg && <span style={{ fontSize: '0.75rem', color: saveMsg.startsWith('Error') ? 'var(--error)' : 'var(--success, #4caf50)' }}>{saveMsg}</span>}
        </div>

        {media.observations.map(obs => (
          <div key={obs.id} style={{
            padding: '0.625rem',
            marginBottom: '0.5rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: '0.8125rem',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.6875rem', opacity: 0.6 }}>Species</label>
                <input
                  style={inputStyle}
                  value={obs.scientific_name || ''}
                  onChange={e => updateObservation(obs.id, { scientific_name: e.target.value || null })}
                  placeholder="Scientific name"
                  disabled={saving}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.6875rem', opacity: 0.6 }}>Type</label>
                <select style={inputStyle} value={obs.observation_type || ''} onChange={e => updateObservation(obs.id, { observation_type: e.target.value || null })} disabled={saving}>
                  <option value="">—</option>
                  {OBS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.6875rem', opacity: 0.6 }}>Count</label>
                <input style={inputStyle} type="number" min="0" value={obs.count ?? ''} onChange={e => updateObservation(obs.id, { count: e.target.value ? parseInt(e.target.value) : null })} disabled={saving} />
              </div>
              <div>
                <label style={{ fontSize: '0.6875rem', opacity: 0.6 }}>Life stage</label>
                <select style={inputStyle} value={obs.life_stage || ''} onChange={e => updateObservation(obs.id, { life_stage: e.target.value || null })} disabled={saving}>
                  <option value="">—</option>
                  {LIFE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.6875rem', opacity: 0.6 }}>Sex</label>
                <select style={inputStyle} value={obs.sex || ''} onChange={e => updateObservation(obs.id, { sex: e.target.value || null })} disabled={saving}>
                  <option value="">—</option>
                  {SEX_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div style={{ fontSize: '0.6875rem', opacity: 0.5, marginTop: '0.25rem' }}>
              {obs.classification_method === 'machine' ? '🤖' : '👤'} {obs.classified_by || '—'}
              {obs.classification_probability !== null && ` • ${(obs.classification_probability * 100).toFixed(0)}%`}
            </div>
          </div>
        ))}

        <button
          onClick={addObservation}
          disabled={saving}
          style={{
            padding: '0.375rem 0.75rem',
            fontSize: '0.8125rem',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)',
            backgroundColor: 'transparent',
            color: 'var(--text-color)',
            cursor: 'pointer',
            width: '100%',
            opacity: 0.7,
          }}
        >
          + Add Observation
        </button>
      </div>
    </div>
  )
}
