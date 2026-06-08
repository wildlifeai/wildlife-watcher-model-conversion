/**
 * OtherPage — /other
 *
 * WS7: Export dataset, Prepare SD card, Upload Model (gated).
 * GBIF publishing is a follow-on (Appendix A of the roadmap).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { useProjectSelection } from '../hooks/useProjectSelection'
import { apiClient } from '../lib/apiClient'
import { supabase } from '../config/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Section wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  icon, title, description, children, comingSoon = false,
}: {
  icon: string
  title: string
  description: string
  children?: React.ReactNode
  comingSoon?: boolean
}) {
  return (
    <div style={{
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      opacity: comingSoon ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg,rgba(76,175,80,0.25),rgba(76,175,80,0.07))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.375rem',
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>
            {title}
            {comingSoon && (
              <span style={{
                marginLeft: '0.5rem', fontSize: '0.6875rem', fontWeight: 500,
                padding: '0.15rem 0.5rem', borderRadius: '12px',
                border: '1px solid var(--border)', opacity: 0.7,
              }}>
                coming soon
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '0.875rem', opacity: 0.7, lineHeight: 1.5 }}>
            {description}
          </p>
        </div>
      </div>
      {children && <div>{children}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function OtherPage() {
  const { user } = useAuth()
  const { selectedProjectIds } = useProjectSelection()
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState(false)

  // Privilege check — same pattern as App.tsx
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
  const isOrgManager = managedOrgs && managedOrgs.length > 0

  // ── CamtrapDP export (moved from MyDataPage) ────────────────────────────────
  const downloadCamtrapDP = async () => {
    if (selectedProjectIds.length !== 1) return
    setIsExporting(true)
    setExportError(null)
    setExportSuccess(false)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('export-camtrap-dp', {
        body: { project_id: selectedProjectIds[0] },
      })
      if (fnErr) throw new Error(fnErr.message)
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `camtrapdp-${selectedProjectIds[0]}-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setExportSuccess(true)
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  const canExport = selectedProjectIds.length === 1

  return (
    <div>
      <h2 style={{ margin: '0 0 0.375rem 0' }}>Other</h2>
      <p style={{ margin: '0 0 2rem 0', opacity: 0.65, fontSize: '0.9rem' }}>
        Data export, device preparation, and administrative tools.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '720px' }}>

        {/* 1 — Export dataset (CamtrapDP) */}
        <Section
          icon="📦"
          title="Export dataset for R"
          description="Download a CamtrapDP package (ZIP) for the selected project. Open it directly in the camtrapdp R package or any tool that supports the Camera Trap Data Package standard."
        >
          {!canExport && (
            <p style={{ fontSize: '0.8125rem', opacity: 0.65, margin: 0 }}>
              Select exactly one project from the Projects selector at the top of the screen to enable export.
            </p>
          )}
          {exportError && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--error)', margin: 0 }}>⚠ {exportError}</p>
          )}
          {exportSuccess && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--success)', margin: 0 }}>✓ Download started.</p>
          )}
          <button
            id="download-camtrapdp-btn"
            className="btn"
            onClick={downloadCamtrapDP}
            disabled={!canExport || isExporting}
            style={{ opacity: !canExport ? 0.45 : 1, width: 'fit-content' }}
            title={!canExport ? 'Select exactly one project first' : undefined}
          >
            {isExporting ? '⏳ Exporting…' : '📦 Download CamtrapDP'}
          </button>
        </Section>

        {/* 2 — Prepare SD card */}
        <Section
          icon="💾"
          title="Prepare SD card"
          description="Generate a MANIFEST.zip that bundles the camera configuration and AI model binary, ready to write to an SD card for field deployment."
        >
          <Link
            to="/manifest"
            className="btn"
            style={{ textDecoration: 'none', width: 'fit-content', display: 'inline-block' }}
          >
            Open SD card preparation →
          </Link>
        </Section>

        {/* 3 — Upload AI model (org managers only) */}
        {isOrgManager && (
          <Section
            icon="🤖"
            title="Upload AI model"
            description="Upload an Edge Impulse ZIP, run Vela optimisation, and register the new model in the system so projects can select it."
          >
            <Link
              to="/upload-model"
              className="btn"
              style={{ textDecoration: 'none', width: 'fit-content', display: 'inline-block' }}
            >
              Open model upload →
            </Link>
          </Section>
        )}

        {/* 4 — GBIF publishing (coming soon / follow-on) */}
        <Section
          icon="🌍"
          title="Publish to GBIF"
          description="Publish observations from a project or deployment to the Global Biodiversity Information Facility (GBIF) as a Darwin Core Archive."
          comingSoon
        />

      </div>
    </div>
  )
}
