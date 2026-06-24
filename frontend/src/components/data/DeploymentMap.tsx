import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
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
}

interface DeploymentMapProps {
  deployments: Deployment[]
  onSelectDeployment?: (id: string) => void
  selectedDeploymentId?: string | null
  metric?: 'total' | 'perDay'
  speciesLabel?: string | null   // when set, the map is in present/absent mode
}

const PROJECT_COLOURS = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
]

export function DeploymentMap({ deployments, onSelectDeployment, selectedDeploymentId, metric = 'total', speciesLabel = null }: DeploymentMapProps) {
  const mapped = deployments.filter(d => d.latitude != null && d.longitude != null)

  // A site counts as "absent" only when we're filtering by a species and it has
  // no detections there. Without a species filter every site is just "shown".
  const sizeValue = (d: Deployment) => d.metricValue ?? d.observation_count ?? 0
  const isAbsent = (d: Deployment) => speciesLabel != null && d.present === false
  const metricLabel = metric === 'perDay' ? 'detections / active day' : 'detection count'

  // Build a colour index by project name
  const projectNames = [...new Set(deployments.map(d => d.project_name ?? ''))]
  const colourOf = (name: string) => PROJECT_COLOURS[projectNames.indexOf(name) % PROJECT_COLOURS.length]

  // Compute centre of all markers
  const centre: [number, number] = mapped.length > 0
    ? [
        mapped.reduce((s, d) => s + d.latitude!, 0) / mapped.length,
        mapped.reduce((s, d) => s + d.longitude!, 0) / mapped.length,
      ]
    : [20, 0] // world default

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
      <MapContainer
        center={centre}
        zoom={mapped.length === 1 ? 10 : 5}
        style={{ height: '420px', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mapped.map(d => {
          const isSelected = d.id === selectedDeploymentId
          const obsCount = d.observation_count ?? 0
          const absent = isAbsent(d)
          const colour = colourOf(d.project_name ?? '')
          // Absent sites: small hollow grey ring. Present/plain sites: filled,
          // colour by project, radius scaled by the chosen metric.
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
                {speciesLabel != null ? (
                  absent ? (
                    <span><em>{speciesLabel}</em>: not detected</span>
                  ) : (
                    <span>
                      <em>{speciesLabel}</em>: {obsCount} detection{obsCount !== 1 ? 's' : ''}
                      {d.activeDays != null && <span> over {d.activeDays} day{d.activeDays !== 1 ? 's' : ''}</span>}
                      {d.perDay != null && <><br />{fmt(d.perDay)} / day</>}
                    </span>
                  )
                ) : (
                  obsCount > 0 && (
                    <span>
                      {obsCount} detection{obsCount !== 1 ? 's' : ''}
                      {metric === 'perDay' && d.perDay != null && <> · {fmt(d.perDay)} / day</>}
                    </span>
                  )
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
        {speciesLabel != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              border: '1.5px solid #9e9e9e', backgroundColor: 'rgba(158,158,158,0.12)',
              display: 'inline-block',
            }} />
            absent ({speciesLabel})
          </span>
        )}
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
          Circle size ∝ {metricLabel} · {mapped.length} of {deployments.length} deployment{deployments.length !== 1 ? 's' : ''} have GPS
        </span>
      </div>
    </div>
  )
}
