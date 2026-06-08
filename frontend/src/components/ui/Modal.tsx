import { useEffect, useRef, useCallback } from 'react'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_WIDTHS: Record<ModalSize, string> = {
  sm: '400px',
  md: '560px',
  lg: '720px',
  xl: '960px',
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: ModalSize
  /** Prevent closing by clicking the backdrop */
  persistent?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  persistent = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus the first focusable element when opened
  useEffect(() => {
    if (!open) return
    const el = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    el?.focus()
  }, [open])

  // Focus trap — keep Tab/Shift+Tab inside the dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return

      const nodes = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      )
      if (nodes.length === 0) return

      const first = nodes[0]
      const last = nodes[nodes.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    },
    [onClose],
  )

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={persistent ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        onKeyDown={handleKeyDown}
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-color)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          width: '100%',
          maxWidth: SIZE_WIDTHS[size],
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        {(title !== undefined) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <span
              id="modal-title"
              style={{ fontWeight: 600, fontSize: '1rem' }}
            >
              {title}
            </span>
            <button
              aria-label="Close"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-color)',
                opacity: 0.5,
                fontSize: '1.25rem',
                lineHeight: 1,
                padding: '0.125rem 0.25rem',
                borderRadius: 'var(--radius)',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
            >
              ✕
            </button>
          </div>
        )}

        {/* Body — scrollable */}
        <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '0.875rem 1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.625rem',
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
