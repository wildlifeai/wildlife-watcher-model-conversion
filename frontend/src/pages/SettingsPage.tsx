// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// SettingsPage — configuration surface (opened from the avatar menu). Holds ONLY
// configuration: account, projects & members (moved here from Results in P2), and —
// later — capture defaults, default model, and notification rules (P5–P6).
// Tools stay in Toolkit; monitoring stays in Field.
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProjectSelection } from '../hooks/useProjectSelection'
import { supabase } from '../config/supabase'
import { DataTable, type Column } from '../components/ui/DataTable'
import { NAV_BTN } from '../components/data/DeploymentActionRow'
import { CreateProjectModal, type CreatedProject } from '../components/data/CreateProjectModal'
import { ProjectMembersPanel } from '../components/data/ProjectMembersPanel'
import { NotificationRulesPanel } from '../components/settings/NotificationRulesPanel'
import { ProjectDefaultsPanel } from '../components/settings/ProjectDefaultsPanel'

interface ProjectRow {
  id: string
  name: string
  description: string | null
  created_at: string
  deployment_count: number
  organisation_id: string
}

function formatDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : '—'
}

function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.0625rem' }}>{title}</h3>
      {description && <p style={{ margin: '0 0 0.875rem 0', opacity: 0.65, fontSize: '0.85rem' }}>{description}</p>}
      {children}
    </section>
  )
}

export function SettingsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { clearAll, toggleProject } = useProjectSelection()
  const [searchParams] = useSearchParams()

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auto-open Create Project when arrived with ?create=true (zero-project empty state)
  const [createOpen, setCreateOpen] = useState(() => searchParams.get('create') === 'true')
  const [membersProject, setMembersProject] = useState<{ id: string; name: string; org_id: string } | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('projects')
      .select('id, name, description, organisation_id, created_at, deployments(id)')
      .is('deployments.deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err.message); setLoading(false); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: ProjectRow[] = (data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          organisation_id: p.organisation_id,
          created_at: p.created_at,
          deployment_count: Array.isArray(p.deployments) ? p.deployments.length : 0,
        }))
        setProjects(rows)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [user])

  const projectColumns = useMemo<Column<ProjectRow>[]>(() => [
    { key: 'name', label: 'Name', cellStyle: { fontWeight: 500 } },
    {
      key: 'description', label: 'Description',
      render: r => r.description || <span style={{ opacity: 0.4 }}>—</span>,
      getValue: r => r.description ?? '',
    },
    {
      key: 'deployment_count', label: 'Deployments', cellStyle: { width: '100px' },
      getValue: r => String(r.deployment_count), render: r => r.deployment_count,
    },
    {
      key: 'created_at', label: 'Created', cellStyle: { width: '110px', fontSize: '0.75rem' },
      render: r => formatDate(r.created_at),
    },
    {
      key: '_actions', label: 'Actions', sortable: false, hideable: false, cellStyle: { width: '210px' },
      render: r => (
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          <button
            style={NAV_BTN}
            onClick={e => { e.stopPropagation(); clearAll(); toggleProject(r.id); navigate('/insights?tab=deployments') }}
            title="View this project's deployments"
          >
            📍 Open
          </button>
          <button
            style={NAV_BTN}
            onClick={e => { e.stopPropagation(); navigate(`/intelligence/${r.id}`) }}
            title="Dataset health dashboard"
          >
            📊 Health
          </button>
          <button
            style={{ ...NAV_BTN, color: 'var(--text-color)' }}
            onClick={e => { e.stopPropagation(); setMembersProject({ id: r.id, name: r.name, org_id: r.organisation_id }) }}
            title="Manage project members"
          >
            👥 Members
          </button>
        </div>
      ),
    },
  ], [clearAll, toggleProject, navigate])

  return (
    <div style={{ maxWidth: 960 }}>
      <h2 style={{ margin: '0 0 0.375rem 0' }}>⚙ Settings</h2>
      <p style={{ opacity: 0.65, fontSize: '0.9rem', margin: '0 0 1.75rem 0' }}>
        Manage your account, projects and members. Capture defaults, the default AI model, and
        notification preferences are coming next.
      </p>

      {error && <p style={{ color: 'var(--error)', marginBottom: '1rem' }}>⚠ {error}</p>}

      <Section
        title="Projects & members"
        description="Create projects and manage who can access them. Per-project capture defaults and the default AI model will appear here soon."
      >
        <div style={{ marginBottom: '0.75rem' }}>
          <button className="btn" onClick={() => setCreateOpen(true)} title="Create a new project">
            + New Project
          </button>
        </div>
        {loading ? (
          <p style={{ opacity: 0.5 }}>Loading projects…</p>
        ) : (
          <DataTable<ProjectRow>
            columns={projectColumns}
            rows={projects}
            rowKey={r => r.id}
            searchable
            searchPlaceholder="Search projects…"
            exportFilename="projects"
            emptyMessage="No projects yet. Create one here, or in the Wildlife Watcher mobile app."
            onRowClick={r => { clearAll(); toggleProject(r.id); navigate('/insights?tab=deployments') }}
            pageSize={50}
          />
        )}
      </Section>

      <Section
        title="Project defaults"
        description="Set the default triggering method and AI model applied to a project's deployments. Requires the Project Admin role."
      >
        <ProjectDefaultsPanel />
      </Section>

      <Section
        title="Notifications"
        description="Choose which alerts you receive per project, and how. In-app works now; email activates once a provider is configured; mobile push is delivered by the app."
      >
        <NotificationRulesPanel />
      </Section>

      <Section title="Account" description="Your sign-in details.">
        <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div><span style={{ opacity: 0.6 }}>Email:</span> <strong>{user?.email ?? '—'}</strong></div>
          <div>
            <Link to="/reset-password" className="btn" style={{ textDecoration: 'none', width: 'fit-content', display: 'inline-block' }}>
              Change password →
            </Link>
          </div>
        </div>
      </Section>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(p: CreatedProject) => {
          setProjects(prev => [{
            id: p.id, name: p.name, description: null, organisation_id: '',
            created_at: new Date().toISOString(), deployment_count: 0,
          }, ...prev])
          setCreateOpen(false)
        }}
      />

      {membersProject && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setMembersProject(null)} />
          <div style={{
            position: 'relative', zIndex: 1, width: 'min(520px, 100vw)', height: '100%',
            backgroundColor: 'var(--surface)', boxShadow: '-4px 0 24px rgba(0,0,0,0.18)', overflowY: 'auto', padding: '1.5rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: '1.0625rem' }}>Project Members</span>
              <button
                onClick={() => setMembersProject(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1, color: 'var(--text-color)', opacity: 0.6 }}
                title="Close"
              >✕</button>
            </div>
            <ProjectMembersPanel
              projectId={membersProject.id}
              projectName={membersProject.name}
              organisationId={membersProject.org_id}
            />
          </div>
        </div>
      )}
    </div>
  )
}
