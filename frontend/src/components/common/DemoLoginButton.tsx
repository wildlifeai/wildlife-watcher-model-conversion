/**
 * DemoLoginButton — "Try the demo" entry point.
 *
 * Signs the visitor into the shared read-only demo account via
 * POST /api/auth/demo-session. Used on the marketing hero and the login
 * page; renders an error inline if the demo is disabled on this server.
 */
import { useState } from 'react'
import { loginAsDemo } from '../../hooks/useAuth'

export function DemoLoginButton({ style }: { style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    setBusy(true)
    setError(null)
    try {
      await loginAsDemo()
      // No navigation needed: the auth listener flips the app into the
      // signed-in layout, and HomePage swaps to the dashboard.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The demo is temporarily unavailable.')
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
      <button
        onClick={handleClick}
        disabled={busy}
        style={{
          padding: '0.75rem 2rem', fontSize: '1rem', fontWeight: 600,
          border: '1px solid var(--primary)', borderRadius: 'var(--radius)',
          backgroundColor: 'transparent', color: 'var(--primary)',
          cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
          ...style,
        }}
      >
        {busy ? 'Opening demo…' : '🔍 Try the demo'}
      </button>
      {error && <span style={{ fontSize: '0.8125rem', color: 'var(--error, #f44336)' }}>{error}</span>}
    </span>
  )
}
