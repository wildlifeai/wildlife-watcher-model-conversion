/**
 * FaqItem — collapsible question/answer accordion row.
 *
 * Used by the FAQ page (/faq), which serves both prospects and existing
 * users. Pass `id` to make a question deep-linkable (e.g. /faq#buy).
 */
export function FaqItem({ q, id, children }: { q: string; id?: string; children: React.ReactNode }) {
  return (
    <details id={id} style={{
      marginBottom: '0.75rem',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'var(--surface)',
    }}>
      <summary style={{
        padding: '0.875rem 1rem',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '0.9375rem',
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}>
        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>▶</span>
        {q}
      </summary>
      <div style={{
        padding: '0 1rem 1rem',
        fontSize: '0.9375rem',
        lineHeight: 1.7,
        color: 'var(--text-color)',
        opacity: 0.85,
      }}>
        {children}
      </div>
    </details>
  )
}
