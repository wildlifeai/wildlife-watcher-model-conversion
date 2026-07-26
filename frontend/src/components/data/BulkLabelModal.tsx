/**
 * BulkLabelModal — annotate every selected image with one classification.
 *
 * Pick a species (search) or "Nothing (blank)" to apply a single human label to
 * all selected media at once. The actual write lives in MediaBrowser (which has
 * the media/deployment context); this component only collects the choice.
 */
import { Modal } from '../ui/Modal'
import { SpeciesPicker, type SpeciesSelection } from './SpeciesPicker'

interface Props {
  count: number
  busy: boolean
  /** species selection, or null for "nothing" (blank). */
  onApply: (selection: SpeciesSelection | null) => void
  onClose: () => void
}

export function BulkLabelModal({ count, busy, onApply, onClose }: Props) {
  return (
    <Modal open={true} onClose={onClose} title={`🏷️ Label ${count} image${count !== 1 ? 's' : ''}`}>
      <p style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: 0 }}>
        Apply the same classification to all {count} selected image{count !== 1 ? 's' : ''}. This
        records a human-reviewed observation on each.
      </p>

      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.35rem' }}>Species</div>
        <SpeciesPicker
          autoFocus
          placeholder="Search species (e.g. Eurasian blackbird)…"
          disabled={busy}
          onSelect={(s) => onApply(s)}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
        <button
          className="btn btn-outline"
          disabled={busy}
          onClick={() => onApply(null)}
          style={{ backgroundColor: 'transparent', border: '1px solid var(--border)', fontSize: '0.8rem' }}
          title="Mark every selected image as empty / no animal"
        >
          🚫 Nothing (blank)
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-color)', opacity: 0.6 }}
        >
          Cancel
        </button>
      </div>

      {busy && <p style={{ fontSize: '0.78rem', opacity: 0.6, marginBottom: 0 }}>Applying…</p>}
    </Modal>
  )
}
