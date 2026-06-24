/**
 * InaturalistPanel — account-level iNaturalist controls (Settings).
 *
 * Home for "Sync all annotations from iNaturalist" — pulls community IDs back
 * into Wildlife Watcher for every linked observation. This replaces the old
 * per-grid "Sync iNaturalist IDs" bulk action; sync also runs automatically on
 * login (see InatAutoSync).
 */
import { useState } from 'react'
import { useINat } from '../../hooks/useINat'

export function InaturalistPanel() {
  const inat = useINat()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const syncAll = async () => {
    if (busy) return
    setBusy(true)
    setMsg('↻ Syncing community IDs from iNaturalist…')
    try {
      const r = await inat.sync()
      setMsg(
        `✓ Synced ${r.updated}/${r.checked} · ${r.research} research-grade · ` +
        `${r.disagreement} disagreement · ${r.observations_written} community ID(s) written`,
      )
    } catch (e) {
      setMsg(`⚠ ${(e as Error)?.message ?? 'Sync failed'}`)
    } finally {
      setBusy(false)
    }
  }

  if (inat.enabled === false) return null

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem 1.25rem', backgroundColor: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>🌿 iNaturalist</h3>
        {inat.connected
          ? <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Connected{inat.username ? ` as @${inat.username}` : ''}</span>
          : <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Not connected</span>}
      </div>

      <p style={{ fontSize: '0.82rem', opacity: 0.75, lineHeight: 1.5 }}>
        Community identifications sync automatically when you sign in. Use the button below to
        pull the latest IDs for all your annotations on demand.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        {inat.connected ? (
          <>
            <button className="btn" onClick={syncAll} disabled={busy} style={{ fontSize: '0.82rem' }}>
              {busy ? '↻ Syncing…' : '↻ Sync all annotations from iNaturalist'}
            </button>
            <button
              onClick={() => inat.disconnect()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-color)', opacity: 0.6 }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => inat.connect()} style={{ fontSize: '0.82rem' }}>
            Connect iNaturalist
          </button>
        )}
      </div>

      {msg && <p style={{ fontSize: '0.78rem', marginBottom: 0, marginTop: '0.75rem', opacity: 0.85 }}>{msg}</p>}
    </div>
  )
}
