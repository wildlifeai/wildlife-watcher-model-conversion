/**
 * useIsAdmin — true when the signed-in user holds the system-wide `ww_admin`
 * role. Backed by the RLS-safe `has_system_role` RPC. Used to gate admin-only
 * navigation and pages (e.g. the Usage dashboard).
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import { supabase } from '../config/supabase'
import { useAuth } from './useAuth'

export function useIsAdmin(): boolean {
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!user) { setIsAdmin(false); return }
    let cancelled = false
    supabase
      .rpc('has_system_role', { required_role: 'ww_admin' })
      .then(({ data }) => { if (!cancelled) setIsAdmin(data === true) })
    return () => { cancelled = true }
  }, [user])

  return isAdmin
}
