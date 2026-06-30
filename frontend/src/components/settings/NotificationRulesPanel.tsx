// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// NotificationRulesPanel — per-project notification preferences (Settings).
// Event-type × channel matrix backed by the RLS-scoped `notification_rules` table.
// Degrades to a "coming soon" note if the table isn't deployed in this environment.
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../config/supabase'

type Channel = 'web' | 'email' | 'push'
interface Rule {
  project_id: string
  event_type: string
  species_filter: string | null
  channels: string[]
  digest: string
  is_active: boolean
}

const EVENTS: { id: string; label: string; hint: string; hasFilter: boolean }[] = [
  { id: 'species_detection', label: 'Species detections', hint: 'When the AI labels a matching species', hasFilter: true },
  { id: 'camera_silent',     label: 'Camera went silent', hint: 'When an active camera stops reporting (needs LoRaWAN)', hasFilter: false },
  { id: 'upload_complete',   label: 'Upload finished',    hint: 'When an upload + AI run completes', hasFilter: false },
]
const CHANNELS: { id: Channel; label: string; disabled?: boolean; note?: string }[] = [
  { id: 'web',   label: 'In-app' },
  { id: 'email', label: 'Email' },
  { id: 'push',  label: 'Mobile', disabled: true, note: 'Delivered by the mobile app' },
]

const key = (p: string, e: string) => `${p}:${e}`

export function NotificationRulesPanel({ projectId }: { projectId?: string } = {}) {
  const { user } = useAuth()
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [rules, setRules] = useState<Record<string, Rule>>({})
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    // Scope to one project when opened as a per-project action; otherwise list all.
    let projQuery = supabase.from('projects').select('id, name').order('name')
    if (projectId) projQuery = projQuery.eq('id', projectId)
    Promise.all([
      projQuery,
      supabase.from('notification_rules').select('project_id, event_type, species_filter, channels, digest, is_active'),
    ]).then(([projRes, ruleRes]) => {
      if (cancelled) return
      setProjects((projRes.data as { id: string; name: string }[] | null) ?? [])
      if (ruleRes.error) {
        setAvailable(false)
      } else {
        const map: Record<string, Rule> = {}
        for (const r of (ruleRes.data ?? []) as Rule[]) map[key(r.project_id, r.event_type)] = r
        setRules(map)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user, projectId])

  const ruleFor = (p: string, e: string): Rule =>
    rules[key(p, e)] ?? { project_id: p, event_type: e, species_filter: null, channels: [], digest: 'immediate', is_active: false }

  const persist = async (next: Rule) => {
    if (!user) return
    setRules(prev => ({ ...prev, [key(next.project_id, next.event_type)]: next }))
    await supabase.from('notification_rules').upsert(
      {
        user_id: user.id,
        project_id: next.project_id,
        event_type: next.event_type,
        species_filter: next.species_filter || null,
        channels: next.channels,
        digest: next.digest,
        is_active: next.channels.length > 0,
      },
      { onConflict: 'user_id,project_id,event_type' },
    )
  }

  const toggleChannel = (p: string, e: string, ch: Channel) => {
    const r = ruleFor(p, e)
    const channels = r.channels.includes(ch) ? r.channels.filter(c => c !== ch) : [...r.channels, ch]
    persist({ ...r, channels })
  }
  const setFilter = (p: string, e: string, value: string) => {
    const r = ruleFor(p, e)
    persist({ ...r, species_filter: value })
  }

  if (!available) {
    return (
      <p style={{ fontSize: '0.85rem', opacity: 0.65 }}>
        Notification preferences aren't enabled in this environment yet — once the
        <code> notification_rules </code> table is deployed, per-project alert settings appear here.
      </p>
    )
  }
  if (loading) return <p style={{ opacity: 0.5 }}>Loading…</p>
  if (projects.length === 0) return <p style={{ fontSize: '0.85rem', opacity: 0.65 }}>No projects to configure yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.78rem', opacity: 0.6, margin: 0 }}>
        Mobile delivery is handled by the app; email delivery activates once an email provider is configured.
      </p>
      {projects.map(p => (
        <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {/* The slide-over header already names the project when scoped to one. */}
          {!projectId && (
            <div style={{ padding: '0.6rem 0.9rem', fontWeight: 600, fontSize: '0.9rem', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              {p.name}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ opacity: 0.6, fontSize: '0.72rem', textAlign: 'left' }}>
                <th style={{ padding: '0.4rem 0.9rem', fontWeight: 600 }}>Event</th>
                {CHANNELS.map(c => (
                  <th key={c.id} style={{ padding: '0.4rem', fontWeight: 600, textAlign: 'center', width: 70 }} title={c.note}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map(ev => {
                const r = ruleFor(p.id, ev.id)
                return (
                  <tr key={ev.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.5rem 0.9rem' }}>
                      <div style={{ fontWeight: 500 }}>{ev.label}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.55 }}>{ev.hint}</div>
                      {ev.hasFilter && (
                        <input
                          value={r.species_filter ?? ''}
                          onChange={e => setFilter(p.id, ev.id, e.target.value)}
                          placeholder="Any species (or type e.g. rat)"
                          style={{ marginTop: '0.35rem', width: 'min(240px, 100%)', fontSize: '0.72rem', padding: '0.25rem 0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text-color)' }}
                        />
                      )}
                    </td>
                    {CHANNELS.map(c => (
                      <td key={c.id} style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={r.channels.includes(c.id)}
                          disabled={c.disabled}
                          title={c.note}
                          onChange={() => toggleChannel(p.id, ev.id, c.id)}
                          style={{ cursor: c.disabled ? 'not-allowed' : 'pointer' }}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
