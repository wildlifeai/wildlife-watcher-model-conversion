import { useState, useRef, useEffect } from 'react'
import { apiClient } from '../../lib/apiClient'

interface ImportResult {
  project_id: string
  project_name: string
  deployments_imported: number
  media_imported: number
  observations_imported: number
  warnings: string[]
  drive_uploads?: { uploaded: number; skipped: number; failed: number }
}

interface CamtrapImportProps {
  onImportComplete?: (projectId: string) => void
}

// Simulated progress stages — the API is a single blocking call with no streaming
const STAGES = [
  { label: 'Uploading package…',         pct: 10, after: 500   },
  { label: 'Parsing deployments…',       pct: 25, after: 3000  },
  { label: 'Registering taxa via iNat…', pct: 45, after: 8000  },
  { label: 'Importing media records…',   pct: 65, after: 15000 },
  { label: 'Importing observations…',    pct: 80, after: 22000 },
  { label: 'Finalising import…',         pct: 92, after: 30000 },
]

function useImportProgress(importing: boolean) {
  const [stage, setStage] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number>(0)

  useEffect(() => {
    if (!importing) {
      setTimeout(() => {
        setStage(0)
        setElapsed(0)
      }, 0)
      return
    }
    startRef.current = Date.now()
    const ticker = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    const timers = STAGES.map((s, i) => setTimeout(() => setStage(i), s.after))
    return () => {
      clearInterval(ticker)
      timers.forEach(clearTimeout)
    }
  }, [importing])

  const pct = importing ? (STAGES[stage]?.pct ?? 10) : 0
  const label = importing ? (STAGES[stage]?.label ?? 'Importing…') : ''
  return { pct, label, elapsed }
}

const WARN_PREVIEW = 3

export function CamtrapImport({ onImportComplete }: CamtrapImportProps) {
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAllWarnings, setShowAllWarnings] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { pct, label, elapsed } = useImportProgress(importing)

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.zip')) {
      setError('Please upload a .zip file (CamtrapDP package).')
      return
    }
    setFile(f)
    setResult(null)
    setError(null)
    setShowAllWarnings(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleImport = async () => {
    if (!file) return
    setImporting(true)
    setError(null)
    setResult(null)
    setShowAllWarnings(false)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiClient.upload('/api/camtrapdp/import', form) as { data: ImportResult }
      setResult(res.data)
      onImportComplete?.(res.data.project_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed. Check the file and try again.'
      setError(msg)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem', overflow: 'hidden' }}>

      {/* ── Header ───────────────────────────────────────────────── */}
      <button
        id="camtrap-import-toggle"
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.875rem 1rem',
          backgroundColor: 'var(--surface)',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-color)',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}
      >
        <span>📦 Import CamtrapDP Package</span>
        <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>{expanded ? '▲ collapse' : '▼ expand'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border)' }}>

          <p style={{ fontSize: '0.8125rem', opacity: 0.7, marginBottom: '1rem' }}>
            Upload a CamtrapDP v1.0 ZIP file from any source (Agouti, WildID, or a Wildlife Watcher export).
            A new project will be created and you can immediately explore it in the Map and Reports tabs.
          </p>

          {/* ── Drop zone ──────────────────────────────────────────── */}
          <div
            style={{
              border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              padding: '2rem',
              textAlign: 'center',
              cursor: importing ? 'not-allowed' : 'pointer',
              transition: 'border-color 0.2s, background-color 0.2s',
              backgroundColor: dragging ? 'rgba(76,175,80,0.05)' : 'transparent',
              opacity: importing ? 0.45 : 1,
              pointerEvents: importing ? 'none' : 'auto',
            }}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            aria-label="Drop CamtrapDP ZIP here or click to browse"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {file ? (
              <div>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.375rem' }}>📦</div>
                <div style={{ fontWeight: 500 }}>{file.name}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{(file.size / 1024).toFixed(1)} KB — click to replace</div>
              </div>
            ) : (
              <div style={{ opacity: 0.6 }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.375rem' }}>⬆</div>
                <div>Drop CamtrapDP <strong>.zip</strong> here, or click to browse</div>
              </div>
            )}
          </div>

          {/* ── Loading panel ──────────────────────────────────────── */}
          {importing && (
            <div style={{
              marginTop: '0.75rem',
              padding: '1rem',
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{elapsed}s</span>
              </div>
              <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
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

          {/* ── Action buttons ─────────────────────────────────────── */}
          {file && !result && !importing && (
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                id="camtrap-import-btn"
                className="btn"
                onClick={handleImport}
                disabled={importing}
                style={{ padding: '0.5rem 1.25rem' }}
              >
                ⬆ Import Package
              </button>
              <button
                onClick={() => { setFile(null); setError(null) }}
                style={{
                  padding: '0.5rem 0.75rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  fontSize: '0.8125rem',
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* ── Error ──────────────────────────────────────────────── */}
          {error && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              borderRadius: 'var(--radius)',
              backgroundColor: 'rgba(244,67,54,0.08)',
              color: 'var(--error, #f44336)',
              fontSize: '0.8125rem',
            }}>
              ⚠ {error}
            </div>
          )}

          {/* ── Success result ─────────────────────────────────────── */}
          {result && (
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
                {result.project_name && (
                  <span style={{ fontWeight: 400, marginLeft: '0.5rem', opacity: 0.7 }}>— {result.project_name}</span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {([
                  ['Deployments', result.deployments_imported],
                  ['Media records', result.media_imported],
                  ['Observations', result.observations_imported],
                ] as [string, number][]).map(([lbl, count]) => (
                  <div key={lbl} style={{ textAlign: 'center', padding: '0.375rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>{count}</div>
                    <div style={{ opacity: 0.6, fontSize: '0.75rem' }}>{lbl}</div>
                  </div>
                ))}
              </div>

              {result.drive_uploads && (
                <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', opacity: 0.7 }}>
                  ☁ Drive: {result.drive_uploads.uploaded} uploaded
                  {result.drive_uploads.skipped > 0 && `, ${result.drive_uploads.skipped} skipped`}
                  {result.drive_uploads.failed > 0 && `, ${result.drive_uploads.failed} failed`}
                </div>
              )}

              {result.warnings.length > 0 && (
                <div style={{ opacity: 0.75, marginTop: '0.25rem' }}>
                  <strong>Warnings ({result.warnings.length}):</strong>
                  <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                    {(showAllWarnings ? result.warnings : result.warnings.slice(0, WARN_PREVIEW)).map((w, i) => (
                      <li key={i} style={{ marginBottom: '0.2rem', wordBreak: 'break-word' }}>{w}</li>
                    ))}
                  </ul>
                  {result.warnings.length > WARN_PREVIEW && (
                    <button
                      onClick={() => setShowAllWarnings(v => !v)}
                      style={{ marginTop: '0.35rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.75rem', padding: 0 }}
                    >
                      {showAllWarnings ? '▲ Show fewer' : `▼ Show all ${result.warnings.length} warnings`}
                    </button>
                  )}
                </div>
              )}

              <a href="/my-data" style={{ display: 'inline-block', marginTop: '0.75rem', color: 'var(--primary)', fontSize: '0.8125rem' }}>
                View imported data in My Data →
              </a>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
