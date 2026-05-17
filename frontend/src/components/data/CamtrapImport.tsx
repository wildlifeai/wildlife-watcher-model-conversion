import { useState, useRef } from 'react'
import { apiClient } from '../../lib/apiClient'

interface ImportResult {
  project_id: string
  deployments_imported: number
  media_imported: number
  observations_imported: number
  warnings: string[]
}

interface CamtrapImportProps {
  onImportComplete?: (projectId: string) => void
}

export function CamtrapImport({ onImportComplete }: CamtrapImportProps) {
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.zip')) {
      setError('Please upload a .zip file (CamtrapDP package).')
      return
    }
    setFile(f)
    setResult(null)
    setError(null)
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

  const dropZoneStyle: React.CSSProperties = {
    border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
    borderRadius: 'var(--radius)',
    padding: '2rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background-color 0.2s',
    backgroundColor: dragging ? 'rgba(76,175,80,0.05)' : 'transparent',
  }

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      marginBottom: '1.5rem',
      overflow: 'hidden',
    }}>
      {/* Collapsible header */}
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
        <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>
          {expanded ? '▲ collapse' : '▼ expand'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: '0.8125rem', opacity: 0.7, marginBottom: '1rem' }}>
            Upload a CamtrapDP v1.0 ZIP file from any source (Agouti, WildID, or a Wildlife Watcher export).
            A new project will be created and you can immediately explore it in the Map and Reports tabs.
          </p>

          {/* Drop zone */}
          <div
            style={dropZoneStyle}
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
                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                  {(file.size / 1024).toFixed(1)} KB — click to replace
                </div>
              </div>
            ) : (
              <div style={{ opacity: 0.6 }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.375rem' }}>⬆</div>
                <div>Drop CamtrapDP <strong>.zip</strong> here, or click to browse</div>
              </div>
            )}
          </div>

          {/* Actions */}
          {file && !result && (
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                id="camtrap-import-btn"
                className="btn"
                onClick={handleImport}
                disabled={importing}
                style={{ padding: '0.5rem 1.25rem' }}
              >
                {importing ? '⏳ Importing…' : '⬆ Import Package'}
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

          {/* Error */}
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

          {/* Success result */}
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
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {[
                  ['Deployments', result.deployments_imported],
                  ['Media records', result.media_imported],
                  ['Observations', result.observations_imported],
                ].map(([label, count]) => (
                  <div key={String(label)} style={{ textAlign: 'center', padding: '0.375rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>{count}</div>
                    <div style={{ opacity: 0.6, fontSize: '0.75rem' }}>{label}</div>
                  </div>
                ))}
              </div>
              {result.warnings.length > 0 && (
                <div style={{ opacity: 0.7 }}>
                  <strong>Warnings:</strong>
                  <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
