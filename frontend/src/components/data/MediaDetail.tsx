import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { ObservationRecord, MediaRecord } from './MediaBrowser'
import { humanCreateFields, humanReviewFields, isHumanReviewed, isAiLabel } from '../../lib/observations'
import { SpeciesPicker } from './SpeciesPicker'
import { StatusBadge } from '../ui/StatusBadge'
import { formatCaptureTime } from '../../lib/time'

interface Props {
  media: MediaRecord
  /** Deployment IANA timezone for rendering the capture time in local time. */
  timezone?: string | null
  onClose: () => void
  onUpdated: (updated: MediaRecord) => void
  /** Step to the next image (also used for Confirm/Blank auto-advance). */
  onNext?: () => void
  /** Step to the previous image. */
  onPrev?: () => void
}

const LIFE_STAGES = ['adult', 'subadult', 'juvenile', 'hatchling', 'unknown']
const SEX_OPTIONS = ['male', 'female', 'unknown']
const OBS_TYPES = ['animal', 'human', 'vehicle', 'blank', 'unknown']

const ACTION_BTN: React.CSSProperties = {
  padding: '0.25rem 0.5rem', fontSize: '0.6875rem', fontWeight: 600,
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  backgroundColor: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
}
const CONFIRM_BTN: React.CSSProperties = { ...ACTION_BTN, color: '#10b981', borderColor: 'rgba(16,185,129,0.5)' }
const REJECT_BTN: React.CSSProperties = { ...ACTION_BTN, color: '#ef4444', borderColor: 'rgba(239,68,68,0.5)' }
const BOX_BTN: React.CSSProperties = { ...ACTION_BTN, color: 'var(--text-color)' }
const BOX_BTN_ACTIVE: React.CSSProperties = { ...ACTION_BTN, color: '#fff', backgroundColor: '#f59e0b', borderColor: '#f59e0b' }

const NAV_ARROW: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 6,
  width: 44, height: 44, borderRadius: '50%', border: 'none',
  backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: '1.5rem',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const NAV_ARROW_LEFT: React.CSSProperties = { ...NAV_ARROW, left: 12 }
const NAV_ARROW_RIGHT: React.CSSProperties = { ...NAV_ARROW, right: 12 }

function resolveImageUrl(media: MediaRecord, size: 'thumb' | 'full' = 'full'): string | null {
  // Prefer the public Supabase rendition (MEDIA_PREP) — the auth-gated proxy below
  // can't load from a plain <img> tag, so for gdrive:// originals it's the only
  // thing that renders. Full view favours the larger preview_url.
  // media_assets is a to-one embed → PostgREST returns a single object (tolerate array).
  const asset = Array.isArray(media.media_assets) ? media.media_assets[0] : (media.media_assets ?? undefined)
  const rendition = size === 'full'
    ? (asset?.preview_url || asset?.thumbnail_url)
    : (asset?.thumbnail_url || asset?.preview_url)
  if (rendition) return rendition
  const filePath = media.file_path
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  const apiBase = import.meta.env.VITE_API_BASE_URL || ''
  return `${apiBase}/api/media/${media.id}/image?size=${size}`
}

// One label/value row used by the Media-information tab.
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
      <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

// Media-information tab — capture context + the full extracted EXIF, read-only.
function MediaInfoSection({ media, timezone }: { media: MediaRecord; timezone?: string | null }) {
  const aiCount = media.observations.filter(isAiLabel).length
  return (
    <div style={{ padding: '0.75rem 1rem' }}>
      <strong style={{ fontSize: '0.8125rem' }}>Capture</strong>
      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column' }}>
        {media.timestamp && <InfoRow label="Captured (local)" value={formatCaptureTime(media.timestamp, timezone)} />}
        {media.timestamp && <InfoRow label="Captured (UTC)" value={new Date(media.timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC')} />}
        <InfoRow label="File" value={media.file_name || media.file_path.split('/').pop()} />
        <InfoRow label="Media type" value={media.file_mediatype} />
        <InfoRow label="Hosting" value={media.file_public ? 'Public URL' : 'Private (proxied)'} />
        <InfoRow label="AI detections" value={aiCount} />
        {media.media_comments && <InfoRow label="Comments" value={media.media_comments} />}
      </div>
      <ExifSection exif={media.exif_metadata} />
    </div>
  )
}

// EXIF panel — lists primitive key/values from the media's exif_metadata jsonb.
function ExifSection({ exif }: { exif: Record<string, unknown> | null }) {
  const entries = exif && typeof exif === 'object'
    ? Object.entries(exif).filter(([, v]) => v != null && typeof v !== 'object')
    : []
  return (
    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)' }}>
      <strong style={{ fontSize: '0.8125rem' }}>EXIF</strong>
      {entries.length === 0 ? (
        <p style={{ fontSize: '0.75rem', opacity: 0.5, margin: '0.5rem 0 0' }}>No EXIF metadata recorded for this image.</p>
      ) : (
        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column' }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
              <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }}>{k}</span>
              <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MediaDetail({ media, timezone, onClose, onUpdated, onNext, onPrev }: Props) {
  const { user } = useAuth()
  const imgUrl = resolveImageUrl(media)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  // Right panel is split into two tabs: the editable annotations, and read-only
  // capture/EXIF metadata (so the date + extracted EXIF aren't buried below the form).
  const [activeTab, setActiveTab] = useState<'annotations' | 'info'>('annotations')

  // ── AN-7: bounding-box drawing state ───────────────────────────────────────
  // bboxObsId = the observation a freshly-drawn box will be written to (draw mode).
  const [bboxObsId, setBboxObsId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const drawStart = useRef<{ x: number; y: number } | null>(null)
  const imgWrapRef = useRef<HTMLDivElement>(null)

  // Keyboard: Esc cancels a draw (or closes the modal); ←/→ step between images.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        if (bboxObsId) { setBboxObsId(null); setDraft(null); drawStart.current = null }
        else onClose()
      } else if (!typing && !bboxObsId && e.key === 'ArrowRight') {
        onNext?.()
      } else if (!typing && !bboxObsId && e.key === 'ArrowLeft') {
        onPrev?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bboxObsId, onClose, onNext, onPrev])

  // ── Update observation ─────────────────────────────────────────────────────
  // AN-1: any human edit also stamps review provenance (review_status,
  // reviewer_id, …) so the validation layer can see a human verified this label.
  const updateObservation = async (obsId: string, fields: Partial<ObservationRecord>) => {
    setSaving(true)
    setSaveMsg(null)
    const patch = { ...fields, ...humanReviewFields({ userId: user?.id, userEmail: user?.email }) }
    const { error } = await supabase
      .from('observations')
      .update(patch)
      .eq('id', obsId)
    if (error) {
      setSaveMsg(`Error: ${error.message}`)
    } else {
      onUpdated({
        ...media,
        observations: media.observations.map(o => o.id === obsId ? { ...o, ...patch } : o),
      })
      setSaveMsg('Saved ✓')
      setTimeout(() => setSaveMsg(null), 2000)
    }
    setSaving(false)
  }

  // ── Add new observation ────────────────────────────────────────────────────
  // AN-1: a manually-added observation is fully human-provenanced.
  const addObservation = async () => {
    setSaving(true)
    const newObs = {
      deployment_id: media.deployment_id,
      media_id: media.id,
      observation_level: 'media',
      observation_type: 'animal',
      ...humanCreateFields({ userId: user?.id, userEmail: user?.email }),
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

  // ── AN-4: one-click reviewer verbs ─────────────────────────────────────────
  // Confirm: accept the AI label as-is (just stamps human_reviewed via updateObservation).
  const confirmObservation = async (obsId: string) => {
    await updateObservation(obsId, {})
    onNext?.()
  }

  // Reject: the detection is a false trigger → mark blank and clear the species.
  const rejectObservation = async (obsId: string) => {
    await updateObservation(obsId, {
      observation_type: 'blank',
      scientific_name: null,
      vernacular_name: null,
      taxon_id: null,
    })
    onNext?.()
  }

  // ── AN-7: bounding-box draw / delete ───────────────────────────────────────
  const normPos = (e: React.MouseEvent) => {
    const rect = imgWrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  const onDrawDown = (e: React.MouseEvent) => {
    const p = normPos(e)
    drawStart.current = p
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onDrawMove = (e: React.MouseEvent) => {
    const s = drawStart.current
    if (!s) return
    const p = normPos(e)
    setDraft({
      x: Math.min(s.x, p.x), y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y),
    })
  }

  const onDrawUp = async () => {
    const d = draft
    drawStart.current = null
    const target = bboxObsId
    setDraft(null)
    setBboxObsId(null)
    // Ignore accidental clicks; require a meaningful box.
    if (d && target && d.w > 0.01 && d.h > 0.01) {
      await updateObservation(target, { bbox_x: d.x, bbox_y: d.y, bbox_w: d.w, bbox_h: d.h })
    }
  }

  const clearBox = (obsId: string) =>
    updateObservation(obsId, { bbox_x: null, bbox_y: null, bbox_w: null, bbox_h: null })

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
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.82)', display: 'flex' }}>
      {/* ── LEFT: full-screen image stage ──────────────────── */}
      <div
        onClick={e => { if (e.target === e.currentTarget && !bboxObsId) onClose() }}
        style={{
          flex: 1, minWidth: 0, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'auto', padding: '1.5rem',
        }}
      >
        {onPrev && <button onClick={onPrev} title="Previous (←)" style={NAV_ARROW_LEFT}>‹</button>}
        {onNext && <button onClick={onNext} title="Next (→)" style={NAV_ARROW_RIGHT}>›</button>}
        {imgUrl ? (
          <div ref={imgWrapRef} style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
            <img src={imgUrl} alt={media.file_name || ''} style={{ maxWidth: '100%', maxHeight: '92vh', display: 'block' }} />
            {/* Bounding boxes from observations with bbox data */}
            {media.observations.map(obs => {
              const hasBbox = obs.bbox_x !== undefined && obs.bbox_x !== null &&
                              obs.bbox_y !== undefined && obs.bbox_y !== null &&
                              obs.bbox_w !== undefined && obs.bbox_w !== null &&
                              obs.bbox_h !== undefined && obs.bbox_h !== null
              if (!hasBbox) return null
              // Reviewed → blue, raw AI → green (AN-2 contract)
              const reviewed = isHumanReviewed(obs)
              const color = reviewed ? 'rgba(33,150,243,0.8)' : 'rgba(76,175,80,0.8)'
              const label = obs.scientific_name || obs.observation_type || 'Unknown'
              const conf = obs.classification_probability
              return (
                <div
                  key={obs.id}
                  style={{
                    position: 'absolute',
                    left: `${obs.bbox_x! * 100}%`,
                    top: `${obs.bbox_y! * 100}%`,
                    width: `${obs.bbox_w! * 100}%`,
                    height: `${obs.bbox_h! * 100}%`,
                    border: `2px solid ${color}`,
                    borderRadius: '2px',
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    top: -18,
                    left: 0,
                    backgroundColor: color,
                    color: '#fff',
                    fontSize: '0.625rem',
                    padding: '1px 4px',
                    borderRadius: '2px',
                    whiteSpace: 'nowrap',
                  }}>
                    {label} {conf ? `${(conf * 100).toFixed(0)}%` : ''}
                  </span>
                  {/* AN-7: delete box (hidden while drawing) */}
                  {!bboxObsId && (
                    <button
                      onClick={() => clearBox(obs.id)}
                      title="Delete this box"
                      style={{
                        position: 'absolute', top: -8, right: -8, width: 18, height: 18,
                        borderRadius: '50%', border: 'none', cursor: 'pointer',
                        backgroundColor: color, color: '#fff', fontSize: '0.625rem',
                        lineHeight: 1, pointerEvents: 'auto', padding: 0,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )
            })}

            {/* AN-7: live draft rectangle while drawing */}
            {draft && (
              <div style={{
                position: 'absolute',
                left: `${draft.x * 100}%`, top: `${draft.y * 100}%`,
                width: `${draft.w * 100}%`, height: `${draft.h * 100}%`,
                border: '2px dashed #f59e0b', borderRadius: '2px',
                backgroundColor: 'rgba(245,158,11,0.12)', pointerEvents: 'none',
              }} />
            )}

            {/* AN-7: drawing surface — only active in draw mode */}
            {bboxObsId && (
              <div
                onMouseDown={onDrawDown}
                onMouseMove={onDrawMove}
                onMouseUp={onDrawUp}
                style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 5 }}
              />
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.5, color: '#fff' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📷</div>
            <div style={{ fontSize: '0.8125rem' }}>Image not hosted</div>
            <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Path: <code style={{ fontSize: '0.6875rem' }}>{media.file_path}</code>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: annotation + EXIF panel ─────────────────── */}
      <div style={{
        width: 400, flexShrink: 0, backgroundColor: 'var(--surface)',
        borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, backgroundColor: 'var(--surface)', zIndex: 1,
        }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {media.file_name || media.file_path.split('/').pop()}
          </div>
          <button onClick={onClose} title="Close (Esc)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6 }}>
            ✕
          </button>
        </div>

        {/* AN-7: draw-mode hint */}
        {bboxObsId && (
          <div style={{
            padding: '0.4rem 1rem', fontSize: '0.75rem', fontWeight: 600,
            backgroundColor: 'rgba(245,158,11,0.12)', color: '#b45309',
            borderBottom: '1px solid var(--border)',
          }}>
            ▭ Drag on the image to draw a box · Esc to cancel
          </div>
        )}

        {/* ── Tabs: Annotations | Media information ────────── */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {(['annotations', 'info'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '0.5rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                background: 'none', border: 'none', color: 'var(--text-color)',
                borderBottom: activeTab === tab ? '2px solid var(--primary, #10b981)' : '2px solid transparent',
                opacity: activeTab === tab ? 1 : 0.6,
              }}
            >
              {tab === 'annotations' ? 'Annotations' : 'Media information'}
            </button>
          ))}
        </div>

        {/* ── Annotations tab ──────────────────────────────── */}
        {/* The AI pipeline writes one observation per detection box, so a single
            animal often arrives as several near-identical rows. To keep review
            simple, show ONE primary observation (human-reviewed first, then the
            highest-confidence AI row); the rest stay editable in a collapsed
            "Other detections" section. All boxes still render on the image. */}
        {activeTab === 'annotations' && (
        <div style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '0.8125rem' }}>Observation</strong>
          {saveMsg && <span style={{ fontSize: '0.75rem', color: saveMsg.startsWith('Error') ? 'var(--error)' : 'var(--success, #4caf50)' }}>{saveMsg}</span>}
        </div>

        {(() => {
        const ranked = [...media.observations].sort((a, b) =>
          ((isHumanReviewed(b) ? 1 : 0) - (isHumanReviewed(a) ? 1 : 0)) ||
          ((b.classification_probability ?? 0) - (a.classification_probability ?? 0))
        )
        const primaryObs = ranked[0] ?? null
        const otherObs   = ranked.slice(1)

        const renderObsCard = (obs: ObservationRecord) => {
          const reviewed    = isHumanReviewed(obs)
          const obsStatus   = reviewed ? 'reviewed' : isAiLabel(obs) ? 'ai' : 'issue'
          const needsReview = isAiLabel(obs) && !reviewed
          const obsHasBbox  = obs.bbox_x != null && obs.bbox_w != null
          const drawing     = bboxObsId === obs.id
          return (
          <div key={obs.id} style={{
            padding: '0.625rem',
            marginBottom: '0.5rem',
            border: needsReview ? '1px solid rgba(20,184,166,0.5)' : '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: '0.8125rem',
          }}>
            {/* AN-4: status + one-click reviewer verbs */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <StatusBadge
                status={obsStatus}
                size="sm"
                label={obsStatus === 'ai' && obs.classification_probability != null
                  ? `AI ${(obs.classification_probability * 100).toFixed(0)}%`
                  : undefined}
              />
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                {needsReview && (
                  <>
                    <button onClick={() => confirmObservation(obs.id)} disabled={saving} style={CONFIRM_BTN} title="Confirm the AI label is correct">
                      ✓ Confirm
                    </button>
                    <button onClick={() => rejectObservation(obs.id)} disabled={saving} style={REJECT_BTN} title="False trigger — mark blank">
                      ✕ Blank
                    </button>
                  </>
                )}
                {/* AN-7: draw / redraw this observation's bounding box */}
                <button
                  onClick={() => { setDraft(null); setBboxObsId(drawing ? null : obs.id) }}
                  disabled={saving}
                  style={drawing ? BOX_BTN_ACTIVE : BOX_BTN}
                  title={obsHasBbox ? 'Redraw the bounding box' : 'Draw a bounding box'}
                >
                  {drawing ? '⨯ Cancel' : obsHasBbox ? '▭ Redraw' : '▭ Box'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.6875rem', opacity: 0.6 }}>Species</label>
                {/* AN-5: taxon-validated picker (sets taxon_id), replaces free text */}
                <SpeciesPicker
                  initialQuery={obs.vernacular_name || obs.scientific_name || ''}
                  placeholder="Search species…"
                  disabled={saving}
                  onSelect={sel => updateObservation(obs.id, {
                    taxon_id: sel.taxon_id,
                    scientific_name: sel.scientific_name,
                    vernacular_name: sel.vernacular_name,
                    observation_type: 'animal',
                  })}
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
              {reviewed ? '👤' : '🤖'} {obs.classified_by || '—'}
              {obs.classification_probability != null && ` • ${(obs.classification_probability * 100).toFixed(0)}%`}
            </div>
          </div>
          )
        }

        return (
          <>
            {primaryObs && renderObsCard(primaryObs)}
            {otherObs.length > 0 && (
              <details style={{ marginBottom: '0.5rem' }}>
                <summary style={{
                  cursor: 'pointer', fontSize: '0.75rem', opacity: 0.65,
                  padding: '0.25rem 0', userSelect: 'none',
                }}>
                  Other detections ({otherObs.length}) — same image, lower confidence
                </summary>
                <div style={{ marginTop: '0.5rem' }}>
                  {otherObs.map(obs => renderObsCard(obs))}
                </div>
              </details>
            )}
          </>
        )
        })()}

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
        )}

        {/* ── Media information tab ────────────────────────── */}
        {activeTab === 'info' && <MediaInfoSection media={media} timezone={timezone} />}
      </div>
    </div>
  )
}
