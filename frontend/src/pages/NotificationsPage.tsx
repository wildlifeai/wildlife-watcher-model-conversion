// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// NotificationsPage — /notifications (opened from the avatar menu).
// Lists the signed-in user's notifications with type/unread filters and mark-read
// actions. Degrades to a "coming soon" state when the notifications table isn't
// deployed in this environment yet (see useNotifications).
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications, type AppNotification } from '../hooks/useNotifications'

const TYPE_META: Record<string, { icon: string; label: string }> = {
  species_detection: { icon: '🐾', label: 'Species detection' },
  camera_silent:     { icon: '📡', label: 'Camera silent' },
  upload_complete:   { icon: '✅', label: 'Upload complete' },
  system:            { icon: 'ℹ️', label: 'System' },
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function NotificationsPage() {
  const { items, available, loading, unreadCount, markRead, markAllRead } = useNotifications()
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const filtered = useMemo(() => items.filter(n =>
    (!typeFilter || n.type === typeFilter) && (!unreadOnly || !n.read_at)
  ), [items, typeFilter, unreadOnly])

  const types = useMemo(() => Array.from(new Set(items.map(n => n.type))), [items])

  const onOpen = (n: AppNotification) => {
    if (!n.read_at) markRead(n.id)
    const link = (n.data as { link?: string } | null)?.link
    if (typeof link === 'string' && link.startsWith('/')) navigate(link)
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
        <h2 style={{ margin: '0 0 0.375rem 0' }}>🔔 Notifications</h2>
        {available && unreadCount > 0 && (
          <button className="btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => markAllRead()}>
            Mark all read ({unreadCount})
          </button>
        )}
      </div>
      <p style={{ opacity: 0.65, fontSize: '0.9rem', marginTop: 0 }}>
        Alerts about your projects — species detections and (soon) cameras that go silent.
      </p>

      {!available ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', marginTop: '1rem', opacity: 0.8 }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔔</div>
          <div style={{ fontWeight: 600 }}>Notifications aren't enabled in this environment yet</div>
          <div style={{ fontSize: '0.85rem', opacity: 0.65, marginTop: '0.35rem' }}>
            Once the notifications table is deployed, species-detection and camera-health alerts will
            appear here. Configure which ones you receive in Settings.
          </div>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.75rem 0 1rem' }}>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text-color)', fontSize: '0.8rem' }}
            >
              <option value="">All types</option>
              {types.map(t => <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', opacity: 0.85 }}>
              <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
            <span style={{ marginLeft: 'auto', fontSize: '0.78rem', opacity: 0.55 }}>{filtered.length} shown</span>
          </div>

          {loading ? (
            <p style={{ opacity: 0.5 }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', opacity: 0.7 }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>🎉</div>
              <div style={{ fontWeight: 600 }}>You're all caught up</div>
              <div style={{ fontSize: '0.85rem', opacity: 0.65, marginTop: '0.3rem' }}>No notifications match this filter.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {filtered.map(n => {
                const meta = TYPE_META[n.type] ?? { icon: '🔔', label: n.type }
                return (
                  <div
                    key={n.id}
                    onClick={() => onOpen(n)}
                    style={{
                      display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: 'pointer',
                      padding: '0.75rem 0.9rem', borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      background: n.read_at ? 'transparent' : 'rgba(76,175,80,0.06)',
                    }}
                  >
                    <span style={{ fontSize: '1.1rem', lineHeight: 1.2 }}>{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: n.read_at ? 500 : 700, fontSize: '0.875rem' }}>{n.title}</span>
                        <span style={{ fontSize: '0.7rem', opacity: 0.5, whiteSpace: 'nowrap' }}>{timeAgo(n.created_at)}</span>
                      </div>
                      {n.body && <div style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: '0.15rem' }}>{n.body}</div>}
                    </div>
                    {!n.read_at && (
                      <button
                        onClick={e => { e.stopPropagation(); markRead(n.id) }}
                        title="Mark read"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
