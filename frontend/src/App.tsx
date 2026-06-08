import React, { useRef, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { useAuth } from './hooks/useAuth'
import { ProjectSelectionProvider } from './hooks/useProjectSelection'
import { GlobalProjectSelector } from './components/common/GlobalProjectSelector'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { MyDataPage } from './pages/MyDataPage'
import { ManifestPage } from './pages/ManifestPage'
import { UploadModelPage } from './pages/UploadModelPage'
import { UploadDataPage } from './pages/UploadDataPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { SupportPage } from './pages/SupportPage'
import { TermsOfServicePage } from './pages/TermsOfServicePage'
import { ResourcesPage } from './pages/ResourcesPage'
import { EventReviewPage } from './pages/EventReviewPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { ReportingPage } from './pages/ReportingPage'
import { ImageExplorerPage } from './pages/ImageExplorerPage'
import { ClusterReviewPage } from './pages/ClusterReviewPage'
import { UmapExplorerPage } from './pages/UmapExplorerPage'
import { ReviewQueuePage } from './pages/ReviewQueuePage'
import { DatasetHealthPage } from './pages/DatasetHealthPage'
import { AnnotationsPage } from './pages/AnnotationsPage'
import { ResultsPage } from './pages/ResultsPage'
import { OtherPage } from './pages/OtherPage'
import { UploadLogsPage } from './pages/UploadLogsPage'
import { UploadProvider, useUploadStore } from './contexts/UploadContext'
import { UploadModal } from './components/upload/UploadModal'
import { ProgressDock } from './components/upload/ProgressDock'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from './lib/apiClient'
import './styles/index.css'

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

// ─────────────────────────────────────────────────────────────────────────────
// AccountMenu — user email dropdown
// ─────────────────────────────────────────────────────────────────────────────

function AccountMenu({ email, isOrgManager, onLogout }: {
  email: string
  isOrgManager: boolean
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.45rem 0.875rem', fontSize: '0.8125rem',
    border: 'none', backgroundColor: 'transparent',
    color: 'var(--text-color)', cursor: 'pointer', width: '100%', textAlign: 'left',
    textDecoration: 'none',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.375rem',
          padding: '0.375rem 0.625rem',
          fontSize: '0.8125rem', fontWeight: 500,
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          backgroundColor: 'var(--surface)', color: 'var(--text-color)',
          cursor: 'pointer', maxWidth: '180px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email}
        </span>
        <span style={{ opacity: 0.5, fontSize: '0.7rem', flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 200,
          backgroundColor: 'var(--bg-color)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          minWidth: '180px', padding: '0.25rem 0',
        }}>
          {isOrgManager && (
            <Link
              to="/upload-model"
              onClick={() => setOpen(false)}
              style={itemStyle}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(76,175,80,0.07)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'transparent')}
            >
              🤖 Upload Model
            </Link>
          )}
          <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '0.25rem 0' }} />
          <button
            onClick={() => { setOpen(false); onLogout() }}
            style={itemStyle}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(76,175,80,0.07)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            ← Logout
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// UploadNavButton — wires the header Upload button to the upload modal
// ─────────────────────────────────────────────────────────────────────────────

function UploadNavButton() {
  const { openModal } = useUploadStore()
  return (
    <button
      className="btn"
      onClick={openModal}
      style={{ padding: '0.375rem 0.875rem', fontSize: '0.875rem', fontWeight: 600, flexShrink: 0 }}
    >
      ⬆ Upload
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────

const USER_TABS = [
  { id: 'annotations', label: '🏷️ Annotations', to: '/annotations' },
  { id: 'results',     label: '📊 Results',     to: '/results' },
  { id: 'other',       label: '⚙ Other',        to: '/other' },
] as const

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const location = useLocation()

  const { data: managedOrgs } = useQuery({
    queryKey: ['managedOrgs', user?.id],
    queryFn: async () => {
      if (!user) return []
      try {
        const res = await apiClient.get('/api/models/managed-orgs')
        return (res as any).data || []
      } catch { return [] }
    },
    enabled: !!user,
  })
  const isOrgManager = !!(managedOrgs && managedOrgs.length > 0)

  // Resolve which top-level tab is active (handles nested routes too)
  const activeTab = USER_TABS.find(t => location.pathname.startsWith(t.to))?.id ?? null

  const tabStyle = (id: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center',
    padding: '0 1rem', height: '100%',
    borderBottom: activeTab === id ? '2px solid var(--primary)' : '2px solid transparent',
    color: activeTab === id ? 'var(--primary)' : 'var(--text-color)',
    fontWeight: activeTab === id ? 600 : 400,
    fontSize: '0.9rem', textDecoration: 'none',
    opacity: activeTab === id ? 1 : 0.72,
    transition: 'color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap',
  })

  return (
    <>
      <header style={{
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        height: '56px',
        display: 'flex',
        alignItems: 'stretch',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div
          className="container"
          style={{ display: 'flex', alignItems: 'stretch', width: '100%', gap: 0 }}
        >
          {/* Logo */}
          <Link
            to="/"
            style={{
              textDecoration: 'none', color: 'var(--text-color)',
              fontWeight: 700, fontSize: '1rem',
              display: 'flex', alignItems: 'center',
              paddingRight: '1.5rem', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Wildlife Watcher
          </Link>

          {/* 3-tab nav (signed-in only) */}
          {user && (
            <nav style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
              {USER_TABS.map(tab => (
                <NavLink key={tab.id} to={tab.to} style={tabStyle(tab.id)}>
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          )}

          {/* Flex spacer */}
          <div style={{ flex: 1 }} />

          {/* Right-side controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
            {!user && (
              <>
                <Link to="/resources" style={{ textDecoration: 'none', color: 'var(--text-color)', fontSize: '0.875rem', opacity: 0.8 }}>
                  Resources
                </Link>
                <Link to="/login" className="btn" style={{ padding: '0.375rem 0.875rem', textDecoration: 'none', fontSize: '0.875rem' }}>
                  Login
                </Link>
              </>
            )}

            {user && (
              <>
                <GlobalProjectSelector />
                <AccountMenu
                  email={user.email ?? ''}
                  isOrgManager={isOrgManager}
                  onLogout={logout}
                />
                <UploadNavButton />
              </>
            )}
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: '2rem 0' }}>
        <div className="container">
          {children}
        </div>
      </main>

      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: '2.5rem 0',
        backgroundColor: 'var(--surface)',
        color: 'var(--text-color)',
        textAlign: 'center',
        opacity: 0.9,
      }}>
        <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div style={{ opacity: 0.7, fontSize: '0.875rem' }}>
            &copy; {new Date().getFullYear()} Wildlife.ai
            {' | '}
            <Link to="/resources" style={{ color: 'inherit', textDecoration: 'underline' }}>Resources</Link>
            {' | '}
            <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</Link>
            {' | '}
            <Link to="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</Link>
            {' | '}
            <Link to="/support" style={{ color: 'inherit', textDecoration: 'underline' }}>Support</Link>
          </div>
        </div>
      </footer>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectSelectionProvider>
        <BrowserRouter>
          <UploadProvider>
            <UploadModal />
            <ProgressDock />
            <Layout>
              <Routes>
              {/* Public */}
              <Route path="/"               element={<HomePage />} />
              <Route path="/login"          element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/privacy"        element={<PrivacyPolicyPage />} />
              <Route path="/support"        element={<SupportPage />} />
              <Route path="/terms"          element={<TermsOfServicePage />} />
              <Route path="/resources"      element={<ResourcesPage />} />

              {/* Primary 3-tab routes (WS2) */}
              <Route path="/annotations" element={<RequireAuth><AnnotationsPage /></RequireAuth>} />
              <Route path="/results"     element={<RequireAuth><ResultsPage /></RequireAuth>} />
              <Route path="/other"       element={<RequireAuth><OtherPage /></RequireAuth>} />

              {/* Legacy /my-data → /results */}
              <Route path="/my-data" element={<Navigate to="/results" replace />} />

              {/* Upload — modal is the primary path; /upload-data kept for direct nav */}
              <Route path="/upload-data"    element={<RequireAuth><UploadDataPage /></RequireAuth>} />
              <Route path="/upload/logs"    element={<RequireAuth><UploadLogsPage /></RequireAuth>} />
              <Route path="/analyse-images" element={<Navigate to="/upload-data" replace />} />

              {/* Toolkit */}
              <Route path="/manifest"     element={<RequireAuth><ManifestPage /></RequireAuth>} />
              <Route path="/upload-model" element={<RequireAuth><UploadModelPage /></RequireAuth>} />

              {/* Annotation workflow deep-links (preserved) */}
              <Route path="/explore/:deployment_id"  element={<RequireAuth><ImageExplorerPage /></RequireAuth>} />
              <Route path="/clusters/:deployment_id" element={<RequireAuth><ClusterReviewPage /></RequireAuth>} />
              <Route path="/umap/:deployment_id"     element={<RequireAuth><UmapExplorerPage /></RequireAuth>} />
              <Route path="/review/:deployment_id"   element={<RequireAuth><ReviewQueuePage /></RequireAuth>} />
              <Route path="/events/:deployment_id"   element={<RequireAuth><EventReviewPage /></RequireAuth>} />

              {/* Analysis / reporting deep-links (preserved) */}
              <Route path="/intelligence/:project_id" element={<RequireAuth><DatasetHealthPage /></RequireAuth>} />
              <Route path="/analysis/:deployment_id"  element={<RequireAuth><AnalysisPage /></RequireAuth>} />
              <Route path="/reporting/:deployment_id" element={<RequireAuth><ReportingPage /></RequireAuth>} />

              {/* MyDataPage kept at a legacy path (internal; /my-data redirects above) */}
              <Route path="/my-data-legacy" element={<RequireAuth><MyDataPage /></RequireAuth>} />
            </Routes>
          </Layout>
          </UploadProvider>
        </BrowserRouter>
      </ProjectSelectionProvider>
    </QueryClientProvider>
  )
}
