// Copyright (c) 2026
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * UndoToastHost — a lightweight, ephemeral "Deleted N · Undo" toast.
 *
 * There's no general toast system in the app (the notifications feature is DB-backed/persistent),
 * so this is a tiny singleton: mount <UndoToastHost/> once (in App), then call showUndoToast(...)
 * from anywhere (imported from ./undoToastBus). Auto-dismisses after ~6s; clicking Undo runs the
 * supplied callback (which calls the matching /restore endpoint).
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { subscribeUndoToast, type UndoPayload } from './undoToastBus'

export function UndoToastHost() {
  const [toast, setToast] = useState<UndoPayload | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    subscribeUndoToast(setToast)
    return () => subscribeUndoToast(null)
  }, [])

  useEffect(() => {
    if (!toast || busy) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast, busy])

  if (!toast) return null

  const handleUndo = async () => {
    const cb = toast.onUndo
    setBusy(true)
    try {
      await cb()
    } catch (e) {
      // Surface a failed undo (permission/network) instead of silently leaving the item deleted.
      alert(e instanceof Error ? e.message : 'Undo failed. The item is still deleted.')
    } finally {
      setBusy(false)
      setToast(null)
    }
  }

  return createPortal(
    <div
      role="status"
      style={{
        position: 'fixed', bottom: '1.25rem', left: '1.25rem', zIndex: 2000,
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.6rem 0.9rem', borderRadius: 'var(--radius)',
        background: 'var(--text-color)', color: 'var(--bg-color)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.25)', fontSize: '0.8125rem', maxWidth: 360,
      }}
    >
      <span>{toast.message}</span>
      <button
        onClick={handleUndo}
        disabled={busy}
        style={{
          background: 'none', border: 'none', cursor: busy ? 'wait' : 'pointer',
          color: 'var(--primary, #3b82f6)', fontWeight: 700, fontSize: '0.8125rem', filter: 'brightness(1.5)',
        }}
      >
        {busy ? 'Undoing…' : 'Undo'}
      </button>
      <button
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: '0.9rem' }}
      >
        ✕
      </button>
    </div>,
    document.body,
  )
}
