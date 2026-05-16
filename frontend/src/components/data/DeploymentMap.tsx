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
}

interface DeploymentMapProps {
  deployments: Deployment[]
  onSelectDeployment?: (id: string) => void
  selectedDeploymentId?: string | null
}

const PROJECT_COLOURS = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
]

export function DeploymentMap({ deployments, onSelectDeployment, selectedDeploymentId }: DeploymentMapProps) {
  const mapped = deployments.filter(d => d.latitude != null && d.longitude != null)

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

  const maxObs = Math.max(...mapped.map(d => d.observation_count ?? 0), 1)

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
          const radius = 8 + Math.round((obsCount / maxObs) * 10)
          const colour = colourOf(d.project_name ?? '')
          return (
            <CircleMarker
              key={d.id}
              center={[d.latitude!, d.longitude!]}
              radius={radius}
              pathOptions={{
                color: isSelected ? '#fff' : colour,
                fillColor: colour,
                fillOpacity: 0.8,
                weight: isSelected ? 3 : 1.5,
              }}
              eventHandlers={{ click: () => onSelectDeployment?.(d.id) }}
            >
              <Tooltip>
                <strong>{d.location_name ?? 'Unnamed'}</strong><br />
                {d.project_name && <span style={{ opacity: 0.8 }}>{d.project_name}<br /></span>}
                {d.deployment_start && <span>{new Date(d.deployment_start).toLocaleDateString()}</span>}
                {d.deployment_end && <span> → {new Date(d.deployment_end).toLocaleDateString()}</span>}<br />
                {obsCount > 0 && <span>{obsCount} observation{obsCount !== 1 ? 's' : ''}</span>}
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
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
          Circle size ∝ observation count · {mapped.length} of {deployments.length} deployment{deployments.length !== 1 ? 's' : ''} have GPS
        </span>
      </div>
    </div>
  )
}
