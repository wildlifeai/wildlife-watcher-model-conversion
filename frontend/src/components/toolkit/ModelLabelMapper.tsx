// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// ModelLabelMapper — post-upload step that captures what a model's output
// classes mean: which are target species (mapped to a taxon via SpeciesPicker)
// and which are background/negative classes. Saved to ai_models.label_map (RLS:
// organisation_manager). This lets the website reflect on-device predictions as
// real taxa and skip negatives. Labels come from the model's own class order
// (detection_capabilities), so they stay aligned with the device's labels.txt.
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import { supabase } from '../../config/supabase'
import { SpeciesPicker } from '../data/SpeciesPicker'

interface LabelEntry {
  role: 'target' | 'background'
  taxon_id?: string | null
  scientific_name?: string | null
  vernacular_name?: string | null
}
type LabelMap = Record<string, LabelEntry>

// Heuristic default: names like "not rat", "background", "blank" are negatives.
function looksNegative(label: string): boolean {
  return /^(not[ _-]|non[ _-]|no[ _-]|background|blank|none|unknown|negative|other|empty|absent)/i.test(label.trim())
}

export function ModelLabelMapper({ modelId, onDone }: { modelId: string; onDone?: () => void }) {
  const [modelName, setModelName] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [map, setMap] = useState<LabelMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('ai_models')
      .select('name, detection_capabilities, label_map')
      .eq('id', modelId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) { setLoading(false); return }
        const labs = ((data.detection_capabilities as string[] | null) || []).filter(Boolean)
        const saved = (data.label_map as LabelMap | null) || {}
        const init: LabelMap = {}
        for (const l of labs) {
          init[l] = saved[l] ?? { role: looksNegative(l) ? 'background' : 'target' }
        }
        setModelName((data.name as string) || '')
        setLabels(labs)
        setMap(init)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [modelId])

  const setRole = (label: string, role: LabelEntry['role']) =>
    setMap(m => ({
      ...m,
      [label]: role === 'background'
        ? { role, taxon_id: null, scientific_name: null, vernacular_name: null }
        : { ...m[label], role },
    }))

  const setSpecies = (label: string, sel: { taxon_id: string | null; scientific_name: string; vernacular_name: string | null }) =>
    setMap(m => ({
      ...m,
      [label]: { role: 'target', taxon_id: sel.taxon_id, scientific_name: sel.scientific_name, vernacular_name: sel.vernacular_name },
    }))

  const save = async () => {
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('ai_models').update({ label_map: map }).eq('id', modelId)
    setSaving(false)
    if (error) { setMsg(`Error: ${error.message}`); return }
    setMsg('Saved ✓')
    onDone?.()
  }

  if (loading) return <p style={{ opacity: 0.5, fontSize: '0.85rem' }}>Loading model labels…</p>
  if (labels.length === 0) {
    return (
      <p style={{ fontSize: '0.85rem', opacity: 0.65 }}>
        This model reported no labels, so there's nothing to map. You can still use it.
      </p>
    )
  }

  const unmappedTargets = labels.filter(l => map[l]?.role === 'target' && !map[l]?.scientific_name)

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', marginTop: '1rem', backgroundColor: 'var(--surface)' }}>
      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>🏷️ What do this model's labels mean?</div>
      <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: '0 0 0.875rem 0', lineHeight: 1.5 }}>
        Tell us which of <strong>{modelName || 'this model'}</strong>'s output classes are species
        to detect (mapped to a taxon) and which are background/negative classes. This lets the site
        show the camera's on-device predictions as real species and ignore the negatives.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {labels.map(label => {
          const entry = map[label]
          const isTarget = entry?.role === 'target'
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
              <code style={{ fontSize: '0.8rem', minWidth: 90, paddingTop: '0.35rem' }}>{label}</code>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['target', 'background'] as const).map(role => (
                  <label key={role} style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', paddingTop: '0.35rem' }}>
                    <input type="radio" checked={entry?.role === role} onChange={() => setRole(label, role)} />
                    {role === 'target' ? 'Target species' : 'Background / negative'}
                  </label>
                ))}
              </div>
              {isTarget && (
                <div style={{ flex: 1, minWidth: 200 }}>
                  <SpeciesPicker
                    initialQuery={entry?.vernacular_name || entry?.scientific_name || label}
                    placeholder="Map to a species…"
                    onSelect={sel => setSpecies(label, sel)}
                  />
                  {entry?.scientific_name && (
                    <div style={{ fontSize: '0.72rem', opacity: 0.7, marginTop: '0.2rem' }}>
                      → <em>{entry.scientific_name}</em>{entry.vernacular_name ? ` (${entry.vernacular_name})` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.875rem' }}>
        <button className="btn" onClick={save} disabled={saving} style={{ fontSize: '0.85rem' }}>
          {saving ? 'Saving…' : 'Save label mapping'}
        </button>
        {unmappedTargets.length > 0 && (
          <span style={{ fontSize: '0.72rem', opacity: 0.6 }}>
            {unmappedTargets.length} target label{unmappedTargets.length > 1 ? 's' : ''} not yet mapped to a species
          </span>
        )}
        {msg && <span style={{ fontSize: '0.78rem', color: msg.startsWith('Error') ? 'var(--error, #ef4444)' : 'var(--success, #10b981)' }}>{msg}</span>}
      </div>
    </div>
  )
}
