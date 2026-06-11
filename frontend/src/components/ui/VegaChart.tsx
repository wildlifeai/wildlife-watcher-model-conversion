/* eslint-disable react-refresh/only-export-components */
/**
 * VegaChart — thin React wrapper around vega-embed.
 *
 * Pass a plain Vega-Lite spec object and the component renders it inside
 * a div. The spec is re-embedded whenever its reference changes, so callers
 * should memoize specs with useMemo to avoid needless re-renders.
 *
 * Usage:
 *   const spec = useMemo(() => ({ ... }), [data])
 *   <VegaChart spec={spec} />
 *
 * Responsive width: include `"width": "container"` in the spec (Vega-Lite v5+)
 * and make the parent div 100% wide. The chart fills it automatically.
 */
import { useEffect, useRef } from 'react'
import embed from 'vega-embed'

// ─────────────────────────────────────────────────────────────────────────────
// Shared Vega config — matches the app's CSS-variable theme (light-mode first)
// ─────────────────────────────────────────────────────────────────────────────

export const VEGA_CONFIG = {
  background: 'transparent',
  padding: 4,
  view: { stroke: 'transparent', fill: 'transparent' },
  axis: {
    gridColor: '#e5e7eb',
    gridOpacity: 0.8,
    labelColor: '#555',
    labelFontSize: 11,
    titleFontSize: 12,
    titleColor: '#555',
    domainColor: '#ddd',
    tickColor: 'transparent',
  },
  legend: {
    labelFontSize: 11,
    titleFontSize: 11,
    labelColor: '#555',
    titleColor: '#555',
  },
  mark: { tooltip: true },
  arc: {},
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface VegaChartProps {
  /** A Vega-Lite spec. Use `useMemo` in the caller to stabilise the reference. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec: Record<string, any>
  style?: React.CSSProperties
  className?: string
}

export function VegaChart({ spec, style, className }: VegaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
     
    let view: { finalize: () => void } | null = null

    embed(containerRef.current, spec, {
      // Show only the export menu (PNG/SVG) so users can save a chart for a report;
      // hide the source/compiled/editor actions to keep it clean.
      actions: { export: true, source: false, compiled: false, editor: false },
      downloadFileName: 'wildlife-watcher-chart',
      renderer: 'svg',
    })
      .then((result) => {
        if (cancelled) {
          result.view.finalize()
          return
        }
        view = result.view
      })
      .catch((err) => {
        if (!cancelled) console.error('[VegaChart] embed failed', err)
      })

    return () => {
      cancelled = true
      view?.finalize()
    }
  }, [spec])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', ...style }}
    />
  )
}

