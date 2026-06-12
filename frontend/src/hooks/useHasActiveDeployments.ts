// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// useHasActiveDeployments — drives the conditional 📡 Field nav tab.
// A deployment is "active / out in the field" when it has no end date or its end date
// is in the future. Result is cached by react-query AND seeded from localStorage so the
// tab doesn't flash in on every page load for returning field users.
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { supabase } from '../config/supabase'

const LS_KEY = 'ww:hasActiveDeployments'

export function useHasActiveDeployments(): boolean {
  const { user } = useAuth()

  const { data } = useQuery<boolean>({
    queryKey: ['hasActiveDeployments', user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    // Seed from the last known value so a returning user sees the tab immediately.
    initialData: () => {
      try { return localStorage.getItem(LS_KEY) === '1' ? true : undefined } catch { return undefined }
    },
    queryFn: async () => {
      const nowIso = new Date().toISOString()
      const { count } = await supabase
        .from('deployments')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .or(`deployment_end.is.null,deployment_end.gt.${nowIso}`)
      const has = (count ?? 0) > 0
      try { localStorage.setItem(LS_KEY, has ? '1' : '0') } catch { /* ignore */ }
      return has
    },
  })

  return !!data
}
