import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default icon paths broken by bundlers
import L from 'leaflet'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
L.Marker.prototype.options.icon = L.icon({ iconUrl, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] })

interface Deployment {
  id: string
  location_name: string | null
  latitude: number | null
  longitude: number | null
  deployment_start: string | null
  deployment_end: string | null
  project_name?: string
  observation_count?: number
  // Optional analytics, supplied by the Insights Map tab. When omitted (e.g. the
  // Field page) markers fall back to the plain project-coloured / count behaviour.
  metricValue?: number   // value used for circle sizing (total or per-day)
  perDay?: number        // detections per active day
  activeDays?: number    // deployment duration in days (min 1)
  present?: boolean      // is the filtered species present here? undefined ⇒ n/a
  speciesCounts?: Record<string, number>  // species → detection count, for the default pie markers
}

interface DeploymentMapProps {
  deployments: Deployment[]
  onSelectDeployment?: (id: string) => void
  selectedDeploymentId?: string | null
  metric?: 'total' | 'perDay'
  speciesLabel?: string | null   // when set, the map is in present/absent mode
  defaultFocusId?: string | null // centre here on load (e.g. last finished deployment)
  showSpeciesPie?: boolean        // opt-in: render species pie markers (Insights). Other pages keep plain circles.
}

const PROJECT_COLOURS = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
]

// A distinct palette for species pie wedges; species beyond it fall back to grey ("Other").
const SPECIES_COLOURS = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0',
  '#00bcd4', '#ffc107', '#795548', '#3f51b5', '#8bc34a',
]
const OTHER_COLOUR = '#9e9e9e'

// ── Pie-marker SVG helpers ───────────────────────────────────────────────────
function polar(cx: number, cy: number, r: number, frac: number): [number, number] {
  const a = 2 * Math.PI * frac - Math.PI / 2 // start at 12 o'clock
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
function wedge(cx: number, cy: number, r: number, start: number, end: number): string {
  const [x0, y0] = polar(cx, cy, r, start)
  const [x1, y1] = polar(cx, cy, r, end)
  const large = end - start > 0.5 ? 1 : 0
  return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`
}
function pieMarkerHtml(
  counts: Record<string, number>,
  colourOf: (sp: string) => string,
  size: number,
  selected: boolean,
): string {
  const r = size / 2
  const stroke = selected ? '#111' : '#fff'
  const sw = selected ? 2 : 1
  const entries = Object.entries(counts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, c]) => s + c, 0)
  let inner: string
  if (total === 0) {
    // No detections (yet) — small hollow grey ring.
    inner = `<circle cx="${r}" cy="${r}" r="${r - 2}" fill="${OTHER_COLOUR}" fill-opacity="0.12" stroke="${OTHER_COLOUR}" stroke-width="1.5"/>`
  } else if (entries.length === 1) {
    inner = `<circle cx="${r}" cy="${r}" r="${r - sw}" fill="${colourOf(entries[0][0])}" fill-opacity="0.9" stroke="${stroke}" stroke-width="${sw}"/>`
  } else {
    let acc = 0
    inner = entries.map(([sp, c]) => {
      const start = acc / total; acc += c; const end = acc / total
      return `<path d="${wedge(r, r, r - sw, start, end)}" fill="${colourOf(sp)}" fill-opacity="0.9" stroke="${stroke}" stroke-width="${sw}"/>`
    }).join('')
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
}

// Pans/zooms the map to the default deployment once it's known (and again if the project
// selection changes the default). Doesn't fight the user afterwards — only re-fires when the
// target coordinates actually change.
function FocusController({ focus }: { focus: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (focus) map.setView(focus, Math.max(map.getZoom(), 9), { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.[0], focus?.[1]])
  return null
}

export function DeploymentMap({ deployments, onSelectDeployment, selectedDeploymentId, metric = 'total', speciesLabel = null, defaultFocusId = null, showSpeciesPie = false }: DeploymentMapProps) {
  const mapped = deployments.filter(d => d.latitude != null && d.longitude != null)
  // Pie markers only when explicitly enabled (Insights) AND not in single-species present/absent mode.
  const pieMode = showSpeciesPie && speciesLabel == null

  // A site counts as "absent" only when we're filtering by a species and it has
  // no detections there. Without a species filter every site is just "shown".
  const sizeValue = (d: Deployment) => d.metricValue ?? d.observation_count ?? 0
  const isAbsent = (d: Deployment) => speciesLabel != null && d.present === false
  const metricLabel = metric === 'perDay' ? 'detections / active day' : 'detection count'

  // Build a colour index by project name (used in species-filter / present-absent mode)
  const projectNames = [...new Set(deployments.map(d => d.project_name ?? ''))]
  const colourOfProject = (name: string) => PROJECT_COLOURS[projectNames.indexOf(name) % PROJECT_COLOURS.length]

  // Species → colour, ranked by total detections across all sites (stable legend + wedge order).
  const { speciesColour, rankedSpecies, overflowSpecies } = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const d of mapped) for (const [sp, c] of Object.entries(d.speciesCounts ?? {})) totals[sp] = (totals[sp] ?? 0) + c
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([sp]) => sp)
    const map: Record<string, string> = {}
    ranked.forEach((sp, i) => { map[sp] = i < SPECIES_COLOURS.length ? SPECIES_COLOURS[i] : OTHER_COLOUR })
    return {
      speciesColour: (sp: string) => map[sp] ?? OTHER_COLOUR,
      rankedSpecies: ranked.slice(0, SPECIES_COLOURS.length),
      overflowSpecies: ranked.length > SPECIES_COLOURS.length,
    }
  }, [mapped])

  // Compute centre of all markers
  const centre: [number, number] = mapped.length > 0
    ? [
        mapped.reduce((s, d) => s + d.latitude!, 0) / mapped.length,
        mapped.reduce((s, d) => s + d.longitude!, 0) / mapped.length,
      ]
    : [20, 0] // world default

  // Default focus coordinates (last finished deployment), if it has GPS.
  const focusCoords = useMemo<[number, number] | null>(() => {
    const d = mapped.find(m => m.id === defaultFocusId)
    return d ? [d.latitude!, d.longitude!] : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFocusId, deployments])

  // Size scale is driven by the present sites only, so a swarm of absent
  // (zero) sites can't flatten the contrast between the present ones.
  const maxVal = Math.max(...mapped.filter(d => !isAbsent(d)).map(sizeValue), 1)
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

  // Suppress SSR hydration issue with dynamic import
  useEffect(() => { /* trigger re-render once CSS is loaded */ }, [])

  if (mapped.length === 0) {
    return (
      <div style={{
        height: '420px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--surface)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        opacity: 0.6,
        fontSize: '0.875rem',
      }}>
        No deployments with GPS coordinates to display.
      </div>
    )
  }

  return (
    <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
      {/* Strip the default white box/border Leaflet puts on divIcon markers */}
      <style>{`.ww-pie-marker { background: none; border: none; }`}</style>
      <MapContainer
        center={focusCoords ?? centre}
        zoom={focusCoords ? 9 : mapped.length === 1 ? 10 : 5}
        style={{ height: '420px', width: '100%' }}
        scrollWheelZoom={true}
      >
        <FocusController focus={focusCoords} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mapped.map(d => {
          const isSelected = d.id === selectedDeploymentId

          // ── Default: species pie-chart marker ──────────────────────────────
          if (pieMode) {
            const counts = d.speciesCounts ?? {}
            const size = 22 + Math.round((sizeValue(d) / maxVal) * 22) // 22–44px
            const icon = L.divIcon({
              html: pieMarkerHtml(counts, speciesColour, size, isSelected),
              className: 'ww-pie-marker',
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
            })
            const topSpecies = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
            const obsCount = d.observation_count ?? 0
            return (
              <Marker
                key={d.id}
                position={[d.latitude!, d.longitude!]}
                icon={icon}
                eventHandlers={{ click: () => onSelectDeployment?.(d.id) }}
              >
                <Tooltip>
                  <strong>{d.location_name ?? 'Unnamed'}</strong><br />
                  {d.project_name && <span style={{ opacity: 0.8 }}>{d.project_name}<br /></span>}
                  {obsCount === 0 ? (
                    <em>No detections yet</em>
                  ) : (
                    <>
                      <span>{obsCount} detection{obsCount !== 1 ? 's' : ''}
                        {metric === 'perDay' && d.perDay != null && <> · {fmt(d.perDay)} / day</>}</span>
                      {topSpecies.length > 0 && (
                        <span>
                          {topSpecies.map(([sp, c]) => (
                            <span key={sp} style={{ display: 'block', marginTop: 1 }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: speciesColour(sp), marginRight: 4 }} />
                              {sp}: {c}
                            </span>
                          ))}
                        </span>
                      )}
                    </>
                  )}
                </Tooltip>
              </Marker>
            )
          }

          // ── Species filter: present/absent circle marker ───────────────────
          const obsCount = d.observation_count ?? 0
          const absent = isAbsent(d)
          const colour = colourOfProject(d.project_name ?? '')
          const radius = absent ? 5 : 8 + Math.round((sizeValue(d) / maxVal) * 12)
          return (
            <CircleMarker
              key={d.id}
              center={[d.latitude!, d.longitude!]}
              radius={radius}
              pathOptions={{
                color: isSelected ? '#fff' : absent ? '#9e9e9e' : colour,
                fillColor: absent ? '#9e9e9e' : colour,
                fillOpacity: absent ? 0.12 : 0.8,
                weight: isSelected ? 3 : 1.5,
              }}
              eventHandlers={{ click: () => onSelectDeployment?.(d.id) }}
            >
              <Tooltip>
                <strong>{d.location_name ?? 'Unnamed'}</strong><br />
                {d.project_name && <span style={{ opacity: 0.8 }}>{d.project_name}<br /></span>}
                {d.deployment_start && <span>{new Date(d.deployment_start).toLocaleDateString()}</span>}
                {d.deployment_end && <span> → {new Date(d.deployment_end).toLocaleDateString()}</span>}<br />
                {absent ? (
                  <span><em>{speciesLabel}</em>: not detected</span>
                ) : (
                  <span>
                    <em>{speciesLabel}</em>: {obsCount} detection{obsCount !== 1 ? 's' : ''}
                    {d.activeDays != null && <span> over {d.activeDays} day{d.activeDays !== 1 ? 's' : ''}</span>}
                    {d.perDay != null && <><br />{fmt(d.perDay)} / day</>}
                  </span>
                )}
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>

      {/* Legend */}
      <div style={{
        padding: '0.625rem 0.75rem',
        display: 'flex',
        gap: '1rem',
        flexWrap: 'wrap',
        backgroundColor: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        fontSize: '0.75rem',
      }}>
        {pieMode ? (
          <>
            {rankedSpecies.length === 0 && <span style={{ opacity: 0.6 }}>No species detected yet</span>}
            {rankedSpecies.map(sp => (
              <span key={sp} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: speciesColour(sp), display: 'inline-block' }} />
                <em>{sp}</em>
              </span>
            ))}
            {overflowSpecies && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: OTHER_COLOUR, display: 'inline-block' }} />
                Other
              </span>
            )}
            <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
              Pie = species mix · size ∝ {metricLabel} · {mapped.length} of {deployments.length} deployment{deployments.length !== 1 ? 's' : ''} have GPS
            </span>
          </>
        ) : (
          <>
            {projectNames.map((name, i) => (
              <span key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  backgroundColor: PROJECT_COLOURS[i % PROJECT_COLOURS.length],
                  display: 'inline-block',
                }} />
                {name || 'Unknown project'}
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                border: '1.5px solid #9e9e9e', backgroundColor: 'rgba(158,158,158,0.12)',
                display: 'inline-block',
              }} />
              absent ({speciesLabel})
            </span>
            <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
              Circle size ∝ {metricLabel} · {mapped.length} of {deployments.length} deployment{deployments.length !== 1 ? 's' : ''} have GPS
            </span>
          </>
        )}
      </div>
    </div>
  )
}
