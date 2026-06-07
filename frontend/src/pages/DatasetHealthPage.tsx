import { useParams } from 'react-router-dom'
import { useDatasetHealth, useAlerts } from '../hooks/useIntelligence'

const SEVERITY_COLOR: Record<string, string> = { info: '#5b9cf6', warning: '#ff9800', critical: '#f44336' }

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card" style={{ padding: '1rem 1.25rem', textAlign: 'center', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>{value}</div>
      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{label}</div>
    </div>
  )
}

export function DatasetHealthPage() {
  const { project_id } = useParams<{ project_id: string }>()
  const { data: health, isLoading } = useDatasetHealth(project_id)
  const { data: alertsData } = useAlerts(project_id)

  if (isLoading) return <div style={{ padding: '2rem' }}>Loading dataset health…</div>
  if (!health) return <div style={{ padding: '2rem' }}>No data.</div>

  const funnelTotal = Object.values(health.review_funnel).reduce((a, b) => a + b, 0) || 1
  const alerts = alertsData?.alerts || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', color: 'var(--text-color)' }}>
      <h3 style={{ margin: 0 }}>Dataset Health</h3>

      {/* Top stats */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Stat label="Deployments" value={health.deployments} />
        <Stat label="Species" value={health.species_count} />
        <Stat label="Observations" value={health.total_observations} />
        <Stat label="Outlier rate" value={health.outlier_rate != null ? `${Math.round(health.outlier_rate * 100)}%` : '—'} />
      </div>

      {/* Conservation alerts */}
      {alerts.length > 0 && (
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <h4 style={{ marginTop: 0 }}>⚠ Conservation Alerts ({alerts.length})</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {alerts.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', padding: '0.5rem', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEVERITY_COLOR[a.severity] || '#888' }} />
                <strong>{a.alert_type.replace(/_/g, ' ')}</strong>
                <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>{a.severity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review funnel */}
      <div className="glass-card" style={{ padding: '1.25rem' }}>
        <h4 style={{ marginTop: 0 }}>Review Funnel</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(health.review_funnel).map(([status, count]) => (
            <div key={status}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', opacity: 0.8 }}>
                <span>{status}</span>
                <span>{count}</span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(count / funnelTotal) * 100}%`, background: 'var(--primary)' }} />
              </div>
            </div>
          ))}
          {Object.keys(health.review_funnel).length === 0 && <span style={{ fontSize: '0.8125rem', opacity: 0.6 }}>No observations yet.</span>}
        </div>
      </div>

      {/* Species coverage */}
      <div className="glass-card" style={{ padding: '1.25rem' }}>
        <h4 style={{ marginTop: 0 }}>Species Coverage</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
          {health.species.map((s) => (
            <div key={s.scientific_name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8125rem', padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontStyle: 'italic' }}>{s.scientific_name}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {s.under_represented && <span title="< 10 observations" style={{ fontSize: '0.65rem', color: '#ff9800', border: '1px solid #ff9800', borderRadius: 10, padding: '0 6px' }}>low</span>}
                <strong>{s.count}</strong>
              </span>
            </div>
          ))}
          {health.species.length === 0 && <span style={{ fontSize: '0.8125rem', opacity: 0.6 }}>No confirmed species yet.</span>}
        </div>
      </div>
    </div>
  )
}
