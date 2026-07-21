/**
 * useIsAdmin — true when the signed-in user holds the system-wide `ww_admin`
 * role. Backed by the RLS-safe `has_system_role` RPC. Used to gate admin-only
 * navigation and pages (e.g. the Usage dashboard).
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import { supabase } from '../config/supabase'
import { useAuth } from './useAuth'

// Returns null while resolving, then true/false — so callers can gate admin-only
// API calls and redirect immediately without a flash or wasted request.
export function useIsAdmin(): boolean | null {
  const { user, loading } = useAuth()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    // Session still restoring: stay null. Resolving to false here bounced
    // admins off /admin/usage before the role check could even start.
    if (loading) return
    if (!user) { setIsAdmin(false); return }
    let cancelled = false
    supabase
      .rpc('has_system_role', { required_role: 'ww_admin' })
      .then(({ data, error }) => { if (!cancelled) setIsAdmin(!error && data === true) })
    return () => { cancelled = true }
  }, [user, loading])

  return isAdmin
}
