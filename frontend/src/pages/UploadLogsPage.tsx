/**
 * UploadLogsPage — /upload/logs
 *
 * Full-screen log view for an active or completed upload job.
 * Opened when the user clicks ⤢ (expand) in the ProgressDock,
 * or when the dock CTA links here on failure.
 *
 * Reads live state from UploadContext — no route params needed.
 */
import { Link, useNavigate } from 'react-router-dom'
import { useUploadStore } from '../contexts/UploadContext'
import { PipelineStatusBox } from '../components/toolkit/PipelineStatusBox'

export function UploadLogsPage() {
  const { pipelineState, phase, clearUpload, dockState, setDockState } = useUploadStore()
  const navigate = useNavigate()

  const isEmpty = pipelineState.totalFiles === 0

  const handleDismiss = () => {
    clearUpload()
    navigate('/annotations')
  }

  return (
    <div>
      {/* ── Breadcrumb ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', opacity: 0.7 }}>
        <Link to="/annotations" style={{ color: 'inherit', textDecoration: 'underline' }}>
          Annotations
        </Link>
        <span>›</span>
        <span>Upload Logs</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0 }}>Upload Logs</h2>

        <div style={{ display: 'flex', gap: '0.625rem' }}>
          {dockState !== 'minimised' && pipelineState.totalFiles > 0 && (
            <button
              className="btn"
              style={{ padding: '0.375rem 0.875rem', fontSize: '0.8125rem' }}
              onClick={() => { setDockState('minimised'); navigate(-1) }}
            >
              − Minimise to dock
            </button>
          )}
          {(phase === 'completed' || phase === 'failed') && (
            <button
              style={{
                padding: '0.375rem 0.875rem', fontSize: '0.8125rem',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                backgroundColor: 'transparent', color: 'var(--text-color)', cursor: 'pointer',
              }}
              onClick={handleDismiss}
            >
              ✕ Dismiss &amp; go to Annotations
            </button>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div style={{
          padding: '3rem',
          textAlign: 'center',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          backgroundColor: 'var(--surface)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.4 }}>📋</div>
          <p style={{ opacity: 0.6, marginBottom: '1rem' }}>No active upload. Start one using the Upload button in the nav bar.</p>
          <Link to="/" className="btn" style={{ textDecoration: 'none', padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}>
            Back to home
          </Link>
        </div>
      ) : (
        <>
          {/* Summary row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1.25rem',
          }}>
            {([
              ['Total images', pipelineState.totalFiles],
              // Real media count from job results (job.summary.uploaded), not the
              // optimistic files-sent counter — BMPs without a deployment ID and
              // failures don't become media.
              ['Stored as media', pipelineState.jobs.reduce((n, j) => n + (j.summary?.uploaded ?? 0), 0)],
              ['Failed', pipelineState.jobs.reduce((n, j) => n + (j.summary?.failed ?? 0), 0)],
              ['Status', phase.charAt(0).toUpperCase() + phase.slice(1)],
            ] as [string, string | number][]).map(([label, value]) => (
              <div
                key={label}
                style={{
                  padding: '0.75rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'var(--surface)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.2rem' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Full PipelineStatusBox — expanded log */}
          <PipelineStatusBox state={pipelineState} phase={phase} />

          {/* Done CTA */}
          {(phase === 'completed' || phase === 'failed') && (
            <div style={{
              marginTop: '1.5rem',
              padding: '1rem 1.25rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
            }}>
              <span style={{ fontWeight: 500, fontSize: '0.9375rem' }}>
                {phase === 'completed' ? '✅ Upload finished' : '❌ Upload failed'}
              </span>
              {phase === 'completed' && (
                <Link
                  to="/annotations"
                  className="btn"
                  style={{ textDecoration: 'none', padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}
                  onClick={clearUpload}
                >
                  🏷️ View Annotations
                </Link>
              )}
              <button
                style={{
                  marginLeft: 'auto', padding: '0.5rem 1rem', fontSize: '0.8125rem',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  backgroundColor: 'transparent', color: 'var(--text-color)', cursor: 'pointer',
                }}
                onClick={clearUpload}
              >
                Clear logs
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
