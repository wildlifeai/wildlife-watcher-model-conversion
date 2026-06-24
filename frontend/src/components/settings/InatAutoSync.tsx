/**
 * InatAutoSync — pulls iNaturalist community IDs once per session on login.
 *
 * Renders nothing. Mounted in the authenticated app shell so that, when a signed-in
 * user has iNaturalist linked, their community IDs are refreshed automatically
 * (the on-demand "sync all" button lives in Settings → InaturalistPanel).
 */
import { useEffect, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useINat } from '../../hooks/useINat'

const SESSION_KEY = 'ww:inatSyncedThisSession'

export function InatAutoSync() {
  const { user } = useAuth()
  const inat = useINat()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    if (!user || !inat.connected) return
    // Scope the once-per-session guard to the user, so a different account
    // signing in within the same browser session still syncs.
    const key = `${SESSION_KEY}:${user.id}`
    if (sessionStorage.getItem(key)) { ran.current = true; return }
    ran.current = true
    sessionStorage.setItem(key, '1')
    // Best-effort; failures are silent (the Settings button surfaces errors).
    inat.sync().catch(() => {})
  }, [user, inat.connected, inat])

  return null
}
