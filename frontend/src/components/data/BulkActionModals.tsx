// Copyright (c) 2026
// SPDX-License-Identifier: GPL-3.0-or-later
//
// BulkActionModals — guardrail modals for media bulk actions.
//  - Delete confirmation
//  - AI model picker + pipeline log
//  - iNat connect prompt (if not connected)
//  - iNat upload progress

import { useState } from 'react'
import { Modal } from '../ui/Modal'

// ── Delete confirmation ─────────────────────────────────────────────────────

interface DeleteModalProps {
  mediaIds: string[]
  fileNames: string[]
  onConfirm: (ids: string[]) => Promise<void>
  onClose: () => void
}

export function DeleteConfirmModal({ mediaIds, fileNames, onConfirm, onClose }: DeleteModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(mediaIds)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const MAX_SHOW = 5

  return (
    <Modal open={true} onClose={onClose} title={`⚠ Delete ${mediaIds.length} images?`}>
      <div style={{ fontSize: '0.8125rem', lineHeight: 1.6 }}>
        <p style={{ marginBottom: '0.75rem' }}>
          This will soft-delete these images and their associated observations.
          <br />
          <span style={{ opacity: 0.7 }}>This action can be undone by an admin.</span>
        </p>

        <ul style={{ paddingLeft: '1.25rem', marginBottom: '0.75rem', maxHeight: 140, overflowY: 'auto' }}>
          {fileNames.slice(0, MAX_SHOW).map((name, i) => (
            <li key={i} style={{ opacity: 0.85 }}>{name}</li>
          ))}
          {fileNames.length > MAX_SHOW && (
            <li style={{ opacity: 0.55, fontStyle: 'italic' }}>
              … and {fileNames.length - MAX_SHOW} more
            </li>
          )}
        </ul>

        {error && <p style={{ color: 'var(--error)', marginBottom: '0.5rem' }}>⚠ {error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn"
            onClick={handleDelete}
            disabled={busy}
            style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
          >
            {busy ? '⏳ Deleting…' : `Delete ${mediaIds.length}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── AI model picker ─────────────────────────────────────────────────────────

export interface AiModelChoice {
  id: string
  label: string
  description: string
  checked: boolean
}

const DEFAULT_MODELS: AiModelChoice[] = [
  { id: 'speciesnet', label: 'SpeciesNet', description: 'Detector + species classifier', checked: true },
  { id: 'bioclip',    label: 'BioCLIP',    description: 'Zero-shot secondary classifier', checked: false },
  { id: 'dinov3',     label: 'DINOv3',     description: 'Embedding + clustering',         checked: false },
]

interface AiPickerProps {
  count: number
  onRun: (models: string[]) => void
  onClose: () => void
}

export function AiModelPickerModal({ count, onRun, onClose }: AiPickerProps) {
  const [models, setModels] = useState(DEFAULT_MODELS)

  const toggle = (id: string) => setModels(prev =>
    prev.map(m => m.id === id ? { ...m, checked: !m.checked } : m)
  )

  const selected = models.filter(m => m.checked).map(m => m.id)

  return (
    <Modal open={true} onClose={onClose} title={`🧠 Re-classify ${count} images`}>
      <div style={{ fontSize: '0.8125rem', lineHeight: 1.6 }}>
        <p style={{ marginBottom: '0.75rem', opacity: 0.85 }}>
          Select AI models to run:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
          {models.map(m => (
            <label
              key={m.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer',
                padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
                border: `1px solid ${m.checked ? 'var(--primary)' : 'var(--border)'}`,
                backgroundColor: m.checked ? 'rgba(76,175,80,0.06)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              <input
                type="checkbox"
                checked={m.checked}
                onChange={() => toggle(m.id)}
                style={{ marginTop: '0.15rem', accentColor: 'var(--primary)' }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{m.description}</div>
              </div>
            </label>
          ))}
        </div>

        <p style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.75rem' }}>
          ⓘ Existing AI labels will be preserved; new observations will be added alongside them.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            onClick={() => { onRun(selected); onClose() }}
            disabled={selected.length === 0}
          >
            🧠 Run AI ({selected.length} model{selected.length !== 1 ? 's' : ''})
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── AI Pipeline Log Modal ───────────────────────────────────────────────────

interface PipelineLogProps {
  isRunning: boolean
  logs: string[]
  onClose: () => void
}

export function PipelineLogModal({ isRunning, logs, onClose }: PipelineLogProps) {
  return (
    <Modal open={true} onClose={onClose} title={isRunning ? '🧠 AI Pipeline Running' : '🧠 AI Pipeline Complete'}>
      <div style={{ fontSize: '0.8125rem' }}>
        <div style={{
          maxHeight: 300, overflowY: 'auto', marginBottom: '0.75rem',
          padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem',
          backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }}>
          {logs.length === 0 && <span style={{ opacity: 0.5 }}>Waiting for pipeline to start…</span>}
          {logs.map((line, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line}</div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>
            {isRunning ? 'Close (runs in background)' : 'Close'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
