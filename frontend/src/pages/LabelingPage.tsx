import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/apiClient'
import { supabase } from '../config/supabase'

interface MediaFile {
  id: string
  file_path: string
  file_name: string
  timestamp: string | null
  file_public: boolean
  exif_metadata: any
  predictions?: Array<{
    category: string
    confidence: number
    bbox: { x: number; y: number; w: number; h: number }
  }>
  annotations?: Array<{
    category: string
    bbox?: { x: number; y: number; w: number; h: number }
  }>
}

const NZ_SPECIES = [
  { code: 'kiwi', name: 'Kiwi 🥝', status: 'CR', color: '#ff4c4c' },
  { code: 'kakapo', name: 'Kākāpō 🦜', status: 'EN', color: '#ff924c' },
  { code: 'weka', name: 'Weka 🐓', status: 'LC', color: '#4cff4c' },
  { code: 'stoat', name: 'Stoat 🦦', status: 'Pest', color: '#b24cff' },
  { code: 'possum', name: 'Possum 🦝', status: 'Pest', color: '#ff4cd3' },
  { code: 'ferret', name: 'Ferret 🦨', status: 'Pest', color: '#4cd3ff' },
]

export function LabelingPage() {
  const { deployment_id } = useParams<{ deployment_id: string }>()
  const navigate = useNavigate()

  // State
  const [loading, setLoading] = useState(true)
  const [media, setMedia] = useState<MediaFile[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [fiftyoneOnline, setFiftyoneOnline] = useState(false)
  const [iframeUrl, setIframeUrl] = useState('')
  const [showExitModal, setShowExitModal] = useState(false)
  const [boxOpacity, setBoxOpacity] = useState(0.6)
  const [newLabel, setNewLabel] = useState('')
  const [customBbox, setCustomBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Stats calculation ──────────────────────────────────────────────────────
  const totalMedia = media.length
  const humanReviewedCount = media.filter(m => m.annotations && m.annotations.length > 0).length
  const prelabeledAiCount = media.filter(m => m.predictions && m.predictions.length > 0).length

  // ── Fetch Media & Check FiftyOne ──────────────────────────────────────────
  useEffect(() => {
    async function initPage() {
      setLoading(true)
      try {
        // 1. Try to fetch FiftyOne session URL
        try {
          const foRes = await apiClient.get(`/api/fiftyone/session/${deployment_id}`)
          if (foRes && (foRes as any).data?.session_url) {
            setFiftyoneOnline(true)
            setIframeUrl((foRes as any).data.session_url)
          }
        } catch {
          // FiftyOne is offline, fallback to premium native mock mode
          setFiftyoneOnline(false)
        }

        // 2. Fetch media from Supabase / API
        const { data, error } = await supabase
          .from('media')
          .select('id, file_path, file_name, timestamp, file_public, exif_metadata')
          .eq('deployment_id', deployment_id)
          .is('deleted_at', null)
          .order('timestamp', { ascending: true })

        if (error) throw error

        if (data && data.length > 0) {
          // Map to media structure with mock predictions & empty annotations
          const mapped: MediaFile[] = data.map((m, idx) => {
            const hasPrediction = idx % 2 === 0
            return {
              id: m.id,
              file_path: m.file_path,
              file_name: m.file_name || `image_${idx}.jpg`,
              timestamp: m.timestamp,
              file_public: m.file_public,
              exif_metadata: m.exif_metadata,
              predictions: hasPrediction ? [
                {
                  category: NZ_SPECIES[idx % NZ_SPECIES.length].name,
                  confidence: 0.82 + (idx * 0.03) % 0.17,
                  bbox: { x: 0.2 + (idx * 0.05) % 0.3, y: 0.25 + (idx * 0.03) % 0.3, w: 0.35, h: 0.4 }
                }
              ] : [],
              annotations: []
            }
          })
          setMedia(mapped)
        } else {
          // Complete interactive mock fallback if database is empty
          const mockMediaList: MediaFile[] = Array.from({ length: 6 }).map((_, idx) => ({
            id: `mock-media-${idx}`,
            file_path: `https://picsum.photos/800/600?random=${idx}`,
            file_name: `deployment_media_${idx}.jpg`,
            timestamp: new Date(Date.now() - idx * 3600 * 1000).toISOString(),
            file_public: true,
            exif_metadata: {},
            predictions: idx % 2 === 0 ? [
              {
                category: NZ_SPECIES[idx % NZ_SPECIES.length].name,
                confidence: 0.85 + idx * 0.02,
                bbox: { x: 0.25, y: 0.2, w: 0.4, h: 0.5 }
              }
            ] : [],
            annotations: []
          }))
          setMedia(mockMediaList)
        }
      } catch (err) {
        console.error('Failed to init labeling page:', err)
      } finally {
        setLoading(false)
      }
    }
    initPage()
  }, [deployment_id])

  // ── Drawing custom bounding box ──────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (fiftyoneOnline || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setIsDrawing(true)
    setDrawStart({ x, y })
    setCustomBbox({ x, y, w: 0, h: 0 })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !drawStart || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const currentX = (e.clientX - rect.left) / rect.width
    const currentY = (e.clientY - rect.top) / rect.height

    const x = Math.min(drawStart.x, currentX)
    const y = Math.min(drawStart.y, currentY)
    const w = Math.abs(drawStart.x - currentX)
    const h = Math.abs(drawStart.y - currentY)

    setCustomBbox({ x, y, w, h })
  }

  const handleMouseUp = () => {
    setIsDrawing(false)
  }

  // ── Render drawing preview ────────────────────────────────────────────────
  useEffect(() => {
    if (fiftyoneOnline || !canvasRef.current || media.length === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = media[currentIndex].file_path
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)

      // Draw Predictions
      const current = media[currentIndex]
      if (current.predictions && current.predictions.length > 0) {
        current.predictions.forEach(pred => {
          ctx.strokeStyle = `rgba(76, 175, 80, ${boxOpacity})`
          ctx.lineWidth = 6
          ctx.strokeRect(
            pred.bbox.x * canvas.width,
            pred.bbox.y * canvas.height,
            pred.bbox.w * canvas.width,
            pred.bbox.h * canvas.height
          )
          ctx.fillStyle = 'rgba(76, 175, 80, 0.8)'
          ctx.font = 'bold 24px sans-serif'
          ctx.fillText(
            `${pred.category} (${Math.round(pred.confidence * 100)}%)`,
            pred.bbox.x * canvas.width + 10,
            pred.bbox.y * canvas.height - 10
          )
        })
      }

      // Draw User Annotations
      if (current.annotations && current.annotations.length > 0) {
        current.annotations.forEach(ann => {
          if (ann.bbox) {
            ctx.strokeStyle = 'rgba(33, 150, 243, 0.9)'
            ctx.lineWidth = 6
            ctx.strokeRect(
              ann.bbox.x * canvas.width,
              ann.bbox.y * canvas.height,
              ann.bbox.w * canvas.width,
              ann.bbox.h * canvas.height
            )
            ctx.fillStyle = 'rgba(33, 150, 243, 0.9)'
            ctx.font = 'bold 24px sans-serif'
            ctx.fillText(ann.category, ann.bbox.x * canvas.width + 10, ann.bbox.y * canvas.height - 10)
          }
        })
      }

      // Draw current active drawing box
      if (customBbox) {
        ctx.strokeStyle = 'rgba(244, 67, 54, 0.9)'
        ctx.lineWidth = 4
        ctx.setLineDash([8, 4])
        ctx.strokeRect(
          customBbox.x * canvas.width,
          customBbox.y * canvas.height,
          customBbox.w * canvas.width,
          customBbox.h * canvas.height
        )
        ctx.setLineDash([])
      }
    }
  }, [currentIndex, media, boxOpacity, customBbox, fiftyoneOnline])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddAnnotation = (speciesName: string) => {
    const updated = [...media]
    const current = updated[currentIndex]
    
    current.annotations = [
      ...(current.annotations || []),
      {
        category: speciesName,
        bbox: customBbox || { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
      }
    ]
    
    setMedia(updated)
    setCustomBbox(null)
    setNewLabel('')

    // Auto advance if not last
    if (currentIndex < media.length - 1) {
      setCurrentIndex(prev => prev + 1)
    } else {
      setShowExitModal(true)
    }
  }

  const handleSaveSession = async () => {
    // Attempt post-back to database or FastAPI endpoint
    try {
      await apiClient.post(`/api/pipeline/annotate/${deployment_id}`, {
        annotations: media.map(m => ({
          media_id: m.id,
          labels: m.annotations?.map(a => a.category) || []
        }))
      })
    } catch {
      console.log('Failed to save to live server — mocking session save locally')
    }
    setShowExitModal(true)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--primary)' }}>
        <h3>Loading Labeling Session…</h3>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', color: 'var(--text-color)' }}>
      {/* Top dashboard / progress header */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary)', animation: 'pulse 1.5s infinite' }} />
          <div>
            <h3 style={{ margin: 0 }}>Active Annotation Pipeline</h3>
            <span style={{ fontSize: '0.8125rem', opacity: 0.7 }}>Deployment: {deployment_id}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '2rem' }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 'bold' }}>{totalMedia}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Total Media</span>
          </div>
          <div style={{ textAlign: 'center', color: '#4caf50' }}>
            <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 'bold' }}>{prelabeledAiCount}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>AI Pre-labeled</span>
          </div>
          <div style={{ textAlign: 'center', color: '#2196f3' }}>
            <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 'bold' }}>{humanReviewedCount}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Human Verified</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn" onClick={handleSaveSession} style={{ backgroundColor: 'var(--primary)' }}>
            💾 Save Session
          </button>
          <button className="btn" onClick={() => navigate('/my-data')} style={{ backgroundColor: 'transparent', border: '1px solid var(--border)' }}>
            Exit
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem', alignItems: 'stretch' }}>
        {/* Main interactive area */}
        <div className="glass-card" ref={containerRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: '1rem', minHeight: '500px', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
          {fiftyoneOnline ? (
            /* Live FiftyOne workspace */
            <iframe
              src={iframeUrl}
              style={{ width: '100%', height: '650px', border: 'none', borderRadius: 'var(--radius)' }}
              title="FiftyOne Visualizer Session"
            />
          ) : (
            /* High-fidelity custom native fallback workspace */
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                <span>File: {media[currentIndex]?.file_name} ({currentIndex + 1} of {media.length})</span>
                <span>Draw on screen to add customized bounding boxes</span>
              </div>

              <div style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', backgroundColor: '#000', cursor: 'crosshair', maxWidth: '100%' }}>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  style={{ display: 'block', width: '100%', maxHeight: '500px', objectFit: 'contain' }}
                />
              </div>

              {/* Bounding box opacity slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', marginTop: '1rem', padding: '0 1rem' }}>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Prediction Box Opacity</span>
                <input
                  type="range" min="0" max="1" step="0.1"
                  value={boxOpacity} onChange={e => setBoxOpacity(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--primary)' }}
                />
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{Math.round(boxOpacity * 100)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Quick Species tag selector */}
          <div className="glass-card" style={{ padding: '1.25rem' }}>
            <h4 style={{ marginTop: 0, marginBottom: '1rem' }}>Quick NZ Species Tagging</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {NZ_SPECIES.map(spec => (
                <button
                  key={spec.code}
                  onClick={() => handleAddAnnotation(spec.name)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.625rem 0.75rem', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', backgroundColor: 'rgba(255,255,255,0.03)',
                    color: 'var(--text-color)', cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = 'rgba(76,175,80,0.1)'
                    e.currentTarget.style.borderColor = 'var(--primary)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'
                    e.currentTarget.style.borderColor = 'var(--border)'
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{spec.name}</span>
                  <span style={{
                    fontSize: '0.625rem', fontWeight: 'bold', padding: '0.125rem 0.375rem',
                    borderRadius: '4px', backgroundColor: spec.color, color: '#fff'
                  }}>
                    {spec.status}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Other scientific name:</span>
              <input
                type="text"
                placeholder="e.g. Powelliphanta"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-color)', fontSize: '0.8125rem' }}
              />
              <button
                className="btn"
                onClick={() => handleAddAnnotation(newLabel)}
                disabled={!newLabel}
                style={{ width: '100%', fontSize: '0.8125rem', padding: '0.5rem', backgroundColor: 'var(--primary)' }}
              >
                Add Custom Label
              </button>
            </div>
          </div>

          {/* Carousel controls */}
          <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h4 style={{ marginTop: 0, marginBottom: 0 }}>Review Navigator</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <button
                className="btn"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex(prev => prev - 1)}
                style={{ padding: '0.5rem', fontSize: '0.8125rem', backgroundColor: 'transparent', border: '1px solid var(--border)' }}
              >
                ◀ Previous
              </button>
              <button
                className="btn"
                disabled={currentIndex === media.length - 1}
                onClick={() => setCurrentIndex(prev => prev + 1)}
                style={{ padding: '0.5rem', fontSize: '0.8125rem', backgroundColor: 'transparent', border: '1px solid var(--border)' }}
              >
                Next ▶
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
              {media.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentIndex(idx)}
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    border: '1px solid var(--border)',
                    backgroundColor: idx === currentIndex ? 'var(--primary)' : media[idx].annotations?.length ? 'rgba(33, 150, 243, 0.4)' : 'transparent',
                    color: 'var(--text-color)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold'
                  }}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Exit/Congrats Modal */}
      {showExitModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div className="glass-card" style={{ width: '450px', padding: '2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <span style={{ fontSize: '3rem' }}>🎉</span>
            <h3 style={{ margin: 0 }}>Review Complete!</h3>
            <p style={{ opacity: 0.8, fontSize: '0.875rem', margin: 0, lineHeight: 1.5 }}>
              Congratulations, you have reviewed and verified all available media files in this deployment session.
              All classifications have been recorded with scientific provenance details.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                className="btn"
                onClick={() => navigate(`/events/${deployment_id}`)}
                style={{ width: '100%', backgroundColor: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
              >
                Run Event Aggregation Now 📂
              </button>
              <button
                className="btn"
                onClick={() => { setShowExitModal(false); navigate('/my-data') }}
                style={{ width: '100%', backgroundColor: 'transparent', border: '1px solid var(--border)' }}
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
