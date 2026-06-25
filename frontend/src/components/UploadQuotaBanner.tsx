/**
 * UploadQuotaBanner — soft-warning shown when the signed-in user is over their
 * upload quota. Uploads are never blocked (soft enforcement); this just nudges
 * the user to contact an admin. Backed by the `my_upload_usage` RPC.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import { supabase } from '../config/supabase'
import { useAuth } from '../hooks/useAuth'

interface MyUsage {
  photos_uploaded: number
  max_photos: number | null
  over_quota: boolean
}

export function UploadQuotaBanner() {
  const { user } = useAuth()
  const [usage, setUsage] = useState<MyUsage | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!user) { setUsage(null); return }
    let cancelled = false
    supabase.rpc('my_upload_usage').then(({ data }) => {
      if (cancelled) return
      const row = Array.isArray(data) ? data[0] : data
      setUsage(row ? (row as MyUsage) : null)
    })
    return () => { cancelled = true }
  }, [user])

  if (!usage?.over_quota || dismissed) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.6rem 1rem', margin: '0 0 1rem',
      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
      borderRadius: 'var(--radius)', fontSize: '0.85rem',
    }}>
      <span>⚠</span>
      <span style={{ flex: 1 }}>
        You've exceeded a usage limit
        {usage.max_photos != null && usage.photos_uploaded > usage.max_photos && <> (<strong>{usage.photos_uploaded.toLocaleString()}</strong> / {usage.max_photos.toLocaleString()} photos)</>}.
        Everything still works, but please contact an administrator to review your quota.
      </span>
      <button onClick={() => setDismissed(true)} title="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '0.9rem' }}>✕</button>
    </div>
  )
}
