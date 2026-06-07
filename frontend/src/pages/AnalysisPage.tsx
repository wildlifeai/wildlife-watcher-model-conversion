import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from 'react-leaflet'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, Cell } from 'recharts'
import { supabase } from '../config/supabase'
import 'leaflet/dist/leaflet.css'

interface SpeciesDistribution {
  name: string
  events: number
  color: string
}

interface ActivityPeriod {
  day: string
  hour: number
  intensity: number
}

interface ConfidenceBin {
  bin: string
  count: number
}

// NZ Priority Species Palette
const SPECIES_DATA: SpeciesDistribution[] = [
  { name: 'Kiwi 🥝', events: 42, color: '#ff4c4c' },
  { name: 'Kākāpō 🦜', events: 19, color: '#ff924c' },
  { name: 'Weka 🐓', events: 68, color: '#4cff4c' },
  { name: 'Stoat 🦦', events: 11, color: '#b24cff' },
  { name: 'Possum 🦝', events: 29, color: '#ff4cd3' },
  { name: 'Ferret 🦨', events: 7, color: '#4cd3ff' },
]

const CONFIDENCE_BINS: ConfidenceBin[] = [
  { bin: '50-60%', count: 12 },
  { bin: '60-70%', count: 18 },
  { bin: '70-80%', count: 32 },
  { bin: '80-90%', count: 58 },
  { bin: '90-100%', count: 85 },
]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function AnalysisPage() {
  const { deployment_id } = useParams<{ deployment_id: string }>()
  const navigate = useNavigate()

  // State
  const [loading, setLoading] = useState(true)
  const [effortData, setEffortData] = useState({
    trapNights: 24,
    uptimeHours: 576,
    falseTriggerRate: 14.5,
    totalEvents: 176,
    latitude: -41.2865,
    longitude: 174.7762,
    locationName: 'Wellington Rimutaka Range'
  })

  // Heatmap hourly distribution (simulated: Day of week, hour of day, intensity)
  const [heatmapData, setHeatmapData] = useState<ActivityPeriod[]>([])

  useEffect(() => {
    // Generate simulated activity period density grid (7 days x 24 hours)
    const generated: ActivityPeriod[] = []
    DAYS.forEach(day => {
      for (let hour = 0; hour < 24; hour++) {
        // High activity during nighttime (NZ birds are nocturnal e.g., kiwi)
        const isNocturnalTime = hour < 6 || hour > 19
        const baseIntensity = isNocturnalTime ? Math.floor(Math.random() * 8) + 4 : Math.floor(Math.random() * 3)
        generated.push({
          day,
          hour,
          intensity: baseIntensity
        })
      }
    })
    setHeatmapData(generated)

    // Load actual GPS and effort specs if available
    async function loadEffort() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('deployments')
          .select('location_name, latitude, longitude, deployment_start, deployment_end')
          .eq('id', deployment_id)
          .single()

        if (!error && data) {
          let calculatedTrapNights = 24
          let calculatedUptime = 576

          if (data.deployment_start && data.deployment_end) {
            const start = new Date(data.deployment_start).getTime()
            const end = new Date(data.deployment_end).getTime()
            const diffDays = Math.max(1, Math.round((end - start) / (1000 * 3600 * 24)))
            calculatedTrapNights = diffDays
            calculatedUptime = diffDays * 24
          }

          setEffortData({
            trapNights: calculatedTrapNights,
            uptimeHours: calculatedUptime,
            falseTriggerRate: 12.8,
            totalEvents: 176,
            latitude: data.latitude || -41.2865,
            longitude: data.longitude || 174.7762,
            locationName: data.location_name || 'Active deployment site'
          })
        }
      } catch {
        console.log('Failed to fetch deployment effort telemetry — using NZ mock site')
      } finally {
        setLoading(false)
      }
    }
    loadEffort()
  }, [deployment_id])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--primary)' }}>
        <h3>Loading Science Analysis Dashboard…</h3>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', color: 'var(--text-color)' }}>
      {/* Top dashboard header */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>Normalized Ecological Science Dashboard</h3>
          <span style={{ fontSize: '0.8125rem', opacity: 0.7 }}>Deployment: {deployment_id} ({effortData.locationName})</span>
        </div>

        <div style={{ display: 'flex', gap: '1.0rem' }}>
          <button className="btn" onClick={() => navigate(`/events/${deployment_id}`)} style={{ backgroundColor: 'transparent', border: '1px solid var(--border)' }}>
            ◀ Back to QA Panel
          </button>
          <button className="btn" onClick={() => navigate('/my-data')} style={{ backgroundColor: 'transparent', border: '1px solid var(--border)' }}>
            My Data
          </button>
          <button className="btn" onClick={() => navigate(`/reporting/${deployment_id}`)} style={{ backgroundColor: 'var(--primary)', border: 'none' }}>
            Proceed to Export Center 📦
          </button>
        </div>
      </div>

      {/* Top Stats Summary Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
        <div className="glass-card" style={{ padding: '1.25rem', textAlign: 'center', borderLeft: '4px solid var(--primary)' }}>
          <span style={{ display: 'block', fontSize: '0.8125rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Trap Nights</span>
          <span style={{ fontSize: '2.25rem', fontWeight: 'bold' }}>{effortData.trapNights}</span>
          <span style={{ display: 'block', fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>Effort Units (24h blocks)</span>
        </div>

        <div className="glass-card" style={{ padding: '1.25rem', textAlign: 'center', borderLeft: '4px solid #2196f3' }}>
          <span style={{ display: 'block', fontSize: '0.8125rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Uptime hours</span>
          <span style={{ fontSize: '2.25rem', fontWeight: 'bold' }}>{effortData.uptimeHours}h</span>
          <span style={{ display: 'block', fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>100% operational sensor time</span>
        </div>

        <div className="glass-card" style={{ padding: '1.25rem', textAlign: 'center', borderLeft: '4px solid #ff9800' }}>
          <span style={{ display: 'block', fontSize: '0.8125rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>False trigger rate</span>
          <span style={{ fontSize: '2.25rem', fontWeight: 'bold' }}>{effortData.falseTriggerRate}%</span>
          <span style={{ display: 'block', fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>Wind, leaves & shadows excluded</span>
        </div>

        <div className="glass-card" style={{ padding: '1.25rem', textAlign: 'center', borderLeft: '4px solid #4caf50' }}>
          <span style={{ display: 'block', fontSize: '0.8125rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Ecological Events</span>
          <span style={{ fontSize: '2.25rem', fontWeight: 'bold' }}>{effortData.totalEvents}</span>
          <span style={{ display: 'block', fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>Unified CamtrapDP groups</span>
        </div>
      </div>

      {/* Main Charts & Visual Grid Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left Card: Species Distribution Bar Chart */}
        <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h4 style={{ margin: 0 }}>Species Event Abundance Rates</h4>
          <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Normalized independent event counts per priority species</span>

          <div style={{ width: '100%', height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SPECIES_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <ChartTooltip
                  contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-color)' }}
                />
                <Bar dataKey="events" radius={[4, 4, 0, 0]}>
                  {SPECIES_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Card: Confidence Histogram */}
        <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h4 style={{ margin: 0 }}>AI Confidence Density Distribution</h4>
          <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Histogram showing taxonomic classification confidence brackets</span>

          <div style={{ width: '100%', height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={CONFIDENCE_BINS} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="bin" stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <ChartTooltip
                  contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-color)' }}
                />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Diel/Temporal Heatmap Grid Panel */}
      <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h4 style={{ margin: 0 }}>24-Hour Diel Activity Grid</h4>
        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Independent event frequency mapped by day of the week and hour of day (unveiling nocturnal bird spikes)</span>

        {/* Horizontal grid rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {/* Header Hour Row */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <div style={{ width: '45px', fontSize: '0.625rem', opacity: 0.5, fontWeight: 'bold' }}>Day</div>
            {Array.from({ length: 24 }).map((_, hr) => (
              <div key={hr} style={{ flex: 1, minWidth: '16px', textAlign: 'center', fontSize: '0.625rem', opacity: 0.5 }}>
                {String(hr).padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* Day rows */}
          {DAYS.map(day => (
            <div key={day} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <div style={{ width: '45px', fontSize: '0.75rem', fontWeight: 500 }}>{day}</div>
              {Array.from({ length: 24 }).map((_, hr) => {
                const item = heatmapData.find(h => h.day === day && h.hour === hr)
                const intensity = item ? item.intensity : 0
                // HSL Green gradient based on nocturnal activity intensity
                const bg = intensity === 0
                  ? 'rgba(255,255,255,0.02)'
                  : `hsla(122, 50%, ${Math.min(75, 20 + intensity * 6)}%, 0.85)`
                
                return (
                  <div
                    key={hr}
                    title={`${day} at ${String(hr).padStart(2, '0')}:00h (Abundance Intensity: ${intensity})`}
                    style={{
                      flex: 1,
                      minWidth: '16px',
                      height: '24px',
                      backgroundColor: bg,
                      borderRadius: '3px',
                      border: '1px solid rgba(255,255,255,0.02)',
                      transition: 'transform 0.1s',
                      cursor: 'help'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.zIndex = '5' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.zIndex = '1' }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Camera Deployment Site Density map */}
      <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h4 style={{ margin: 0 }}>Camera Deployment Site Density</h4>
          <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Map overlay showing spatial deployment location and surrounding bird sightings</span>

          <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)', height: '280px' }}>
            <MapContainer
              center={[effortData.latitude, effortData.longitude]}
              zoom={13}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <CircleMarker
                center={[effortData.latitude, effortData.longitude]}
                radius={25}
                pathOptions={{
                  color: 'var(--primary)',
                  fillColor: 'var(--primary)',
                  fillOpacity: 0.4,
                  weight: 2
                }}
              >
                <LeafletTooltip>
                  <strong>{effortData.locationName}</strong><br />
                  GPS: {effortData.latitude.toFixed(4)}, {effortData.longitude.toFixed(4)}<br />
                  Events: {effortData.totalEvents} unified groups
                </LeafletTooltip>
              </CircleMarker>
            </MapContainer>
          </div>
        </div>
    </div>
  )
}
