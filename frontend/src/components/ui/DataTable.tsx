import { useState, useMemo } from 'react'
import { ColumnToggle, SearchInput } from './ControlBar'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string
  label: string
  /** Whether this column can be sorted. Default true. */
  sortable?: boolean
  /** Whether this column can be hidden. Default true. */
  hideable?: boolean
  /** Custom cell renderer. Receives the full row. */
  render?: (row: T) => React.ReactNode
  /** Inline style for <th> and <td>. */
  cellStyle?: React.CSSProperties
  /** Overrides the value used for sorting/searching. Falls back to row[key]. */
  getValue?: (row: T) => string | number | null | undefined
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** Return a stable string key for each row (used as React key + row identity). */
  rowKey: (row: T) => string
  /** Show a search box that filters across all non-hidden columns. */
  searchable?: boolean
  searchPlaceholder?: string
  /** Filename stem (no extension). When provided, CSV + JSON export buttons appear. */
  exportFilename?: string
  emptyMessage?: string
  /** Called when a data row is clicked (not the header). */
  onRowClick?: (row: T) => void
  /** Rows the caller considers "selected" — highlighted with a green tint. */
  selectedKeys?: Set<string>
  /** When set, a leading checkbox column appears and selection changes are reported here
   *  (drives bulk actions). `selectedKeys` holds the current selection. */
  onSelectionChange?: (keys: Set<string>) => void
  /** Extra content rendered to the right of the search box (e.g. a Create button). */
  toolbar?: React.ReactNode
  /** Cap displayed rows (client-side paging). 0 = no limit. Default 0. */
  pageSize?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`
  return [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function getVal<T>(row: T, col: Column<T>): string {
  if (col.getValue) return String(col.getValue(row) ?? '')
  const v = (row as Record<string, unknown>)[col.key]
  return String(v ?? '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  searchable = false,
  searchPlaceholder = 'Search…',
  exportFilename,
  emptyMessage = 'No records found.',
  onRowClick,
  selectedKeys,
  onSelectionChange,
  toolbar,
  pageSize = 0,
}: DataTableProps<T>) {
  const [sortCol, setSortCol] = useState('')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)

  const hideableColumns = columns.filter(c => c.hideable !== false)
  const visibleColumns = columns.filter(c => !hidden.has(c.key))

  const handleSort = (key: string) => {
    if (sortCol === key) setSortAsc(v => !v)
    else { setSortCol(key); setSortAsc(true) }
    setPage(1)
  }

  const toggleHidden = (key: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Filter
  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(row =>
      visibleColumns.some(col => getVal(row, col).toLowerCase().includes(q))
    )
  }, [rows, search, visibleColumns])

  // Sort
  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    const col = columns.find(c => c.key === sortCol)
    if (!col) return filtered
    return [...filtered].sort((a, b) => {
      const va = getVal(a, col)
      const vb = getVal(b, col)
      const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' })
      return sortAsc ? cmp : -cmp
    })
  }, [filtered, sortCol, sortAsc, columns])

  // Page
  const totalPages = pageSize > 0 ? Math.ceil(sorted.length / pageSize) : 1
  const paged = pageSize > 0 ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted

  // Export
  const exportCsv = () => {
    const visKeys = visibleColumns
    const headers = visKeys.map(c => c.label)
    const data = sorted.map(row => visKeys.map(col => getVal(row, col)))
    downloadBlob(new Blob([toCsv(headers, data)], { type: 'text/csv' }), `${exportFilename}.csv`)
  }

  const exportJson = () => {
    const visKeys = visibleColumns
    const data = sorted.map(row =>
      Object.fromEntries(visKeys.map(col => [col.key, getVal(row, col)]))
    )
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `${exportFilename}.json`,
    )
  }

  // Styles
  const thStyle: React.CSSProperties = {
    padding: '0.625rem 0.5rem',
    textAlign: 'left',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    borderBottom: '2px solid var(--border)',
    fontSize: '0.8125rem',
    fontWeight: 600,
  }
  const tdStyle: React.CSSProperties = {
    padding: '0.5rem',
    borderBottom: '1px solid var(--border)',
    fontSize: '0.8125rem',
  }

  return (
    <div>
      {/* Toolbar row */}
      {(searchable || exportFilename || hideableColumns.length > 0 || toolbar) && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '0.875rem',
        }}>
          {searchable && (
            <SearchInput
              value={search}
              onChange={v => { setSearch(v); setPage(1) }}
              placeholder={searchPlaceholder}
              style={{ flex: 1, minWidth: '180px', maxWidth: '320px' }}
            />
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto', alignItems: 'center' }}>
            {toolbar}
            {hideableColumns.length > 0 && (
              <ColumnToggle
                columns={hideableColumns.map(c => ({ key: c.key, label: c.label }))}
                hidden={hidden}
                onToggle={toggleHidden}
              />
            )}
            {exportFilename && (
              <>
                <button
                  onClick={exportCsv}
                  className="btn"
                  style={{
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.8125rem',
                    backgroundColor: 'transparent',
                    color: 'var(--primary)',
                    border: '1px solid var(--primary)',
                  }}
                >
                  ⬇ CSV
                </button>
                <button
                  onClick={exportJson}
                  className="btn"
                  style={{
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.8125rem',
                    backgroundColor: 'transparent',
                    color: 'var(--primary)',
                    border: '1px solid var(--primary)',
                  }}
                >
                  ⬇ JSON
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {onSelectionChange && (
                <th style={{ ...thStyle, width: 36, cursor: 'default', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={paged.length > 0 && paged.every(r => selectedKeys?.has(rowKey(r)))}
                    onChange={e => {
                      const next = new Set(selectedKeys ?? [])
                      if (e.target.checked) paged.forEach(r => next.add(rowKey(r)))
                      else paged.forEach(r => next.delete(rowKey(r)))
                      onSelectionChange(next)
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
              )}
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  style={{
                    ...thStyle,
                    cursor: col.sortable !== false ? 'pointer' : 'default',
                    ...col.cellStyle,
                  }}
                  onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                >
                  {col.label}
                  {col.sortable !== false && (
                    <span style={{
                      opacity: sortCol === col.key ? 1 : 0.3,
                      marginLeft: '4px',
                      fontSize: '0.7rem',
                    }}>
                      {sortCol === col.key ? (sortAsc ? '▲' : '▼') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (onSelectionChange ? 1 : 0)}
                  style={{ ...tdStyle, textAlign: 'center', opacity: 0.5, padding: '2.5rem' }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paged.map(row => {
                const key = rowKey(row)
                const isSelected = selectedKeys?.has(key)
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={{
                      cursor: onRowClick ? 'pointer' : undefined,
                      backgroundColor: isSelected ? 'rgba(76,175,80,0.07)' : undefined,
                      transition: 'background-color 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(76,175,80,0.04)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.backgroundColor = isSelected
                        ? 'rgba(76,175,80,0.07)'
                        : 'transparent'
                    }}
                  >
                    {onSelectionChange && (
                      <td style={{ ...tdStyle, width: 36, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={!!isSelected}
                          onChange={() => {
                            const next = new Set(selectedKeys ?? [])
                            if (next.has(key)) next.delete(key); else next.add(key)
                            onSelectionChange(next)
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                    )}
                    {visibleColumns.map(col => (
                      <td key={col.key} style={{ ...tdStyle, ...col.cellStyle }}>
                        {col.render ? col.render(row) : getVal(row, col)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageSize > 0 && totalPages > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '0.75rem',
          fontSize: '0.8125rem',
          opacity: 0.75,
        }}>
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of{' '}
            {sorted.length}
          </span>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            <button
              disabled={page === 1}
              onClick={() => setPage(v => v - 1)}
              style={{
                padding: '0.2rem 0.5rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                backgroundColor: 'transparent',
                color: 'var(--text-color)',
                cursor: page === 1 ? 'default' : 'pointer',
                opacity: page === 1 ? 0.4 : 1,
              }}
            >
              ‹ Prev
            </button>
            <button
              disabled={page === totalPages}
              onClick={() => setPage(v => v + 1)}
              style={{
                padding: '0.2rem 0.5rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                backgroundColor: 'transparent',
                color: 'var(--text-color)',
                cursor: page === totalPages ? 'default' : 'pointer',
                opacity: page === totalPages ? 0.4 : 1,
              }}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
