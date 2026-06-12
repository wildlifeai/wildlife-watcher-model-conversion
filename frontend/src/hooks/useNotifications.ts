// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// useNotifications — in-app notification feed (avatar badge + dropdown + page).
// Reads the RLS-scoped `notifications` table directly (each row belongs to the signed-in
// user). Polls every 45s + on window focus. Degrades gracefully when the table isn't
// deployed yet (the ww-backend migration may not have reached this environment) — any
// query error is treated as "no notifications / unavailable" so the UI never breaks.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { supabase } from '../config/supabase'

export interface AppNotification {
  id: string
  created_at: string
  project_id: string | null
  deployment_id: string | null
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  read_at: string | null
}

const MAX = 100

export function useNotifications() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    enabled: !!user,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, created_at, project_id, deployment_id, type, title, body, data, read_at')
        .order('created_at', { ascending: false })
        .limit(MAX)
      // Table not deployed yet / no access → treat as empty + unavailable.
      if (error) return { items: [] as AppNotification[], available: false }
      return { items: (data ?? []) as AppNotification[], available: true }
    },
  })

  const items = data?.items ?? []
  const available = data?.available ?? false
  const unreadCount = items.filter(n => !n.read_at).length

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] })

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null)
    await invalidate()
  }

  const markAllRead = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    await invalidate()
  }

  return { items, unreadCount, available, loading: isLoading, markRead, markAllRead, refresh: refetch }
}
