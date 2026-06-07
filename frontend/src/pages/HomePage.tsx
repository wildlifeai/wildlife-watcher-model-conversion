import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProjectSelection } from '../hooks/useProjectSelection'
import { supabase } from '../config/supabase'
import { QRCodeSVG } from 'qrcode.react'

const APP_STORE_URL = 'https://apps.apple.com/app/id6480342929'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.wildlife.wildlifewatcher&pcampaignid=web_share'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectCard {
  id: string
  name: string
  description: string | null
  created_at: string
  deployment_count: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Project card component
// ─────────────────────────────────────────────────────────────────────────────

function ProjectCardTile({
  project,
  onOpen,
  onHealth,
}: {
  project: ProjectCard
  onOpen: () => void
  onHealth: () => void
}) {
  return (
    <div
      className="glass-card"
      onClick={onOpen}
      style={{
        padding: '1.25rem',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        transition: 'transform 0.15s, box-shadow 0.15s',
        minWidth: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-3px)'
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(76,175,80,0.12)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Icon + name */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg,rgba(76,175,80,0.3),rgba(76,175,80,0.08))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem',
        }}>
          📂
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </div>
          {project.description && (
            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.description}
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '1rem' }}>
        <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
          <strong style={{ color: 'var(--text-color)', opacity: 1 }}>{project.deployment_count}</strong>{' '}
          {project.deployment_count === 1 ? 'deployment' : 'deployments'}
        </div>
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }} onClick={e => e.stopPropagation()}>
        <button
          onClick={onOpen}
          className="btn"
          style={{ flex: 1, fontSize: '0.75rem', padding: '0.375rem 0', backgroundColor: 'var(--primary)', color: '#fff', border: 'none' }}
        >
          Open →
        </button>
        <button
          onClick={onHealth}
          style={{
            fontSize: '0.75rem', padding: '0.375rem 0.625rem',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            backgroundColor: 'transparent', color: 'var(--primary)', cursor: 'pointer',
          }}
          title="Dataset health dashboard"
        >
          📊
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Logged-in dashboard
// ─────────────────────────────────────────────────────────────────────────────

function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { clearAll, toggleProject } = useProjectSelection()
  const [projects, setProjects] = useState<ProjectCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select('id, name, description, created_at, deployments(id)')
        .is('deployments.deleted_at', null)
        .order('created_at', { ascending: false })
      if (cancelled) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cards: ProjectCard[] = (data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        created_at: p.created_at,
        deployment_count: Array.isArray(p.deployments) ? p.deployments.length : 0,
      }))
      setProjects(cards)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [user])

  const firstName = user?.email?.split('@')[0] ?? 'there'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Greeting + Upload CTA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.75rem' }}>
            Welcome back, {firstName} 👋
          </h2>
          <p style={{ margin: 0, opacity: 0.65, fontSize: '0.9375rem' }}>
            Your active monitoring projects are below.
          </p>
        </div>
        <Link
          to="/upload-data"
          className="btn"
          style={{
            textDecoration: 'none', padding: '0.75rem 1.75rem',
            fontSize: '1rem', fontWeight: 600,
            boxShadow: '0 4px 14px rgba(76,175,80,0.3)',
          }}
        >
          ⬆ Upload Data
        </Link>
      </div>

      {/* Project cards */}
      {loading ? (
        <div style={{ opacity: 0.5, fontSize: '0.9rem' }}>Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📷</div>
          <h3 style={{ marginTop: 0 }}>No projects yet</h3>
          <p style={{ opacity: 0.7, fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Create a project in the mobile app, then upload your first deployment here.
          </p>
          <Link to="/upload-data" className="btn" style={{ textDecoration: 'none' }}>
            ⬆ Upload your first data
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {projects.map(p => (
            <ProjectCardTile
              key={p.id}
              project={p}
              onOpen={() => { clearAll(); toggleProject(p.id); navigate('/my-data') }}
              onHealth={() => navigate(`/intelligence/${p.id}`)}
            />
          ))}
        </div>
      )}

      {/* Quick links bar */}
      <div style={{
        display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '1rem 1.25rem',
        background: 'rgba(76,175,80,0.05)', borderRadius: 'var(--radius)',
        border: '1px solid rgba(76,175,80,0.15)',
      }}>
        <span style={{ fontSize: '0.8125rem', opacity: 0.6, alignSelf: 'center' }}>Quick links:</span>
        {[
          { to: '/my-data', label: '📍 My Data' },
          { to: '/upload-data', label: '⬆ Upload' },
          { to: '/manifest', label: '📋 Prepare SD Card' },
        ].map(link => (
          <Link key={link.to} to={link.to} style={{
            fontSize: '0.8125rem', color: 'var(--primary)',
            textDecoration: 'none', padding: '0.3rem 0.7rem',
            border: '1px solid rgba(76,175,80,0.3)', borderRadius: 'var(--radius)',
          }}>
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Marketing hero (logged-out)
// ─────────────────────────────────────────────────────────────────────────────

function MarketingHero() {
  return (
    <div>
      <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto', padding: '0 0 3rem 0' }}>
        <h1 style={{ fontSize: '3rem', color: 'var(--primary)', marginBottom: '1rem' }}>
          Monitor wildlife the right way!
        </h1>
        <p style={{ fontSize: '1.25rem', opacity: 0.8 }}>
          Analyse photos from your Wildlife Watchers, upload new models, visualise your data and get the devices ready to set them up in the field.
        </p>
        <Link
          to="/login"
          className="btn"
          id="hero-login-button"
          style={{
            display: 'inline-block',
            marginTop: '2rem',
            padding: '0.875rem 2.5rem',
            fontSize: '1.125rem',
            fontWeight: 600,
            textDecoration: 'none',
            borderRadius: 'var(--radius)',
            boxShadow: '0 4px 14px rgba(0,110,28,0.3)',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
        >
          Log in to get started
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', fontWeight: 600 }}>Get the Mobile App</h2>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4rem', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '1rem' }}>
              <a href={APP_STORE_URL} target="_blank" rel="noreferrer">
                <img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" style={{ height: '40px' }} />
              </a>
            </div>
            <div style={{ padding: '1rem', backgroundColor: 'white', borderRadius: '12px', display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <QRCodeSVG value={APP_STORE_URL} size={150} />
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '1rem' }}>
              <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
                <img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" alt="Get it on Google Play" style={{ height: '40px' }} />
              </a>
            </div>
            <div style={{ padding: '1rem', backgroundColor: 'white', borderRadius: '12px', display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <QRCodeSVG value={PLAY_STORE_URL} size={150} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────────────────────

export function HomePage() {
  const { user, loading } = useAuth()

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5 }}>Loading…</div>

  return user ? <Dashboard /> : <MarketingHero />
}
