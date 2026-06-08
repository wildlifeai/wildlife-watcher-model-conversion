/**
 * ProjectMembersPanel
 *
 * Lists, adds, and removes members for a project using the same `user_roles`
 * table the mobile app uses. No extra backend endpoint required.
 *
 * Data model (mirrors mobile UserRoleService):
 *   user_roles { id, user_id, scope_type='project', scope_id=project_id,
 *                role, is_active, granted_by, created_at }
 *
 * To list members the RPC `get_organisation_users` is the authoritative source
 * (bypasses per-row RLS). Adding uses a direct insert; removing sets is_active=false.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'

// ── Types ────────────────────────────────────────────────────────────────────

interface Member {
  user_id:    string
  name:       string
  email:      string
  role:       string
  granted_at: string
}

type ProjectRole = 'project_admin' | 'project_member'

interface Props {
  projectId:      string
  projectName:    string
  organisationId: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  project_admin:  'Admin',
  project_member: 'Member',
  viewer:         'Viewer',
  ww_admin:       'WW Admin',
}

const BTN: React.CSSProperties = {
  padding: '0.3rem 0.625rem', fontSize: '0.75rem',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--primary)',
  whiteSpace: 'nowrap',
}

const BTN_DANGER: React.CSSProperties = { ...BTN, color: 'var(--error, #f44336)', borderColor: 'var(--error, #f44336)' }

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectMembersPanel({ projectId, projectName, organisationId }: Props) {
  const { user } = useAuth()
  const [members,  setMembers]  = useState<Member[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // Add-member form
  const [addEmail,  setAddEmail]  = useState('')
  const [addRole,   setAddRole]   = useState<ProjectRole>('project_member')
  const [adding,    setAdding]    = useState(false)
  const [addError,  setAddError]  = useState<string | null>(null)

  // ── Fetch members ─────────────────────────────────────────────────────────
  const fetchMembers = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      // Use the RPC the mobile already uses — bypasses per-row RLS
      const { data, error: rpcErr } = await supabase.rpc('get_organisation_users', {
        p_organisation_id:     organisationId,
        p_requesting_user_id:  user.id,
      })

      if (rpcErr) throw rpcErr

      // Filter to only users who have a project role for this project
      // The RPC returns all org users; filter by is_in_project is for a different context.
      // We need to cross-reference with user_roles for this specific project.
      const { data: roleRows, error: roleErr } = await supabase
        .from('user_roles')
        .select('user_id, role, created_at')
        .eq('scope_type', 'project')
        .eq('scope_id',   projectId)
        .eq('is_active',  true)

      if (roleErr) throw roleErr

      // Build a map of user_id → { role, created_at } from role rows
      const roleMap = new Map<string, { role: string; created_at: string }>(
        (roleRows ?? []).map(r => [r.user_id, { role: r.role, created_at: r.created_at }])
      )

      // Merge: only keep org users who have a role in this project
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projectMembers: Member[] = (data as any[] ?? [])
        .filter(u => roleMap.has(u.id))
        .map(u => ({
          user_id:    u.id,
          name:       u.name || u.email || u.id.slice(0, 8),
          email:      u.email ?? '',
          role:       roleMap.get(u.id)!.role,
          granted_at: roleMap.get(u.id)!.created_at,
        }))

      setMembers(projectMembers)
    } catch {
      // Graceful fallback: query user_roles directly (may be partial if RLS restricts)
      const { data: fallback, error: fbErr } = await supabase
        .from('user_roles')
        .select('user_id, role, created_at')
        .eq('scope_type', 'project')
        .eq('scope_id',   projectId)
        .eq('is_active',  true)

      if (fbErr) {
        setError('Could not load project members.')
      } else {
        setMembers((fallback ?? []).map(r => ({
          user_id:    r.user_id,
          name:       r.user_id.slice(0, 8) + '…',
          email:      '',
          role:       r.role,
          granted_at: r.created_at,
        })))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectId && organisationId) fetchMembers()
  }, [projectId, organisationId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add member ────────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !addEmail.trim()) return
    setAdding(true)
    setAddError(null)

    // 1. Look up the user by email
    const { data: found, error: findErr } = await supabase
      .from('users')
      .select('id')
      .eq('email', addEmail.trim().toLowerCase())
      .maybeSingle()

    if (findErr || !found) {
      setAddError(`No account found for "${addEmail}". They must sign up first.`)
      setAdding(false)
      return
    }

    // 2. Check they're not already a member
    if (members.some(m => m.user_id === found.id)) {
      setAddError('This person is already a member of this project.')
      setAdding(false)
      return
    }

    // 3. Insert into user_roles (same table the mobile writes to)
    const { error: insertErr } = await supabase.from('user_roles').insert({
      user_id:     found.id,
      scope_type:  'project',
      scope_id:    projectId,
      role:        addRole,
      is_active:   true,
      granted_by:  user.id,
    })

    if (insertErr) {
      setAddError(insertErr.message)
    } else {
      setAddEmail('')
      await fetchMembers()
    }
    setAdding(false)
  }

  // ── Remove member ─────────────────────────────────────────────────────────
  const handleRemove = async (memberId: string) => {
    if (!confirm('Remove this member from the project?')) return

    const { error: err } = await supabase
      .from('user_roles')
      .update({ is_active: false })
      .eq('user_id',    memberId)
      .eq('scope_type', 'project')
      .eq('scope_id',   projectId)

    if (err) { alert('Could not remove member: ' + err.message); return }
    setMembers(prev => prev.filter(m => m.user_id !== memberId))
  }

  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.5rem', fontSize: '0.8125rem',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    backgroundColor: 'var(--surface)', color: 'var(--text-color)',
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>
        Members — {projectName}
      </h3>

      {error && <p style={{ color: 'var(--error)', fontSize: '0.875rem' }}>⚠ {error}</p>}

      {/* Members table */}
      {loading ? (
        <p style={{ opacity: 0.5, fontSize: '0.875rem' }}>Loading members…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem', marginBottom: '1.5rem' }}>
          <thead>
            <tr>
              {['Name', 'Email', 'Role', 'Added', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '1rem 0.5rem', opacity: 0.5 }}>No members found.</td>
              </tr>
            )}
            {members.map(m => (
              <tr key={m.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem', fontWeight: 500 }}>
                  {m.name}
                  {m.user_id === user?.id && <span style={{ marginLeft: '0.4rem', opacity: 0.5, fontSize: '0.75rem' }}>(you)</span>}
                </td>
                <td style={{ padding: '0.5rem', opacity: 0.7 }}>{m.email || '—'}</td>
                <td style={{ padding: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.45rem', borderRadius: '4px', backgroundColor: 'rgba(76,175,80,0.12)', color: 'var(--primary)' }}>
                    {ROLE_LABELS[m.role] ?? m.role}
                  </span>
                </td>
                <td style={{ padding: '0.5rem', opacity: 0.6, fontSize: '0.75rem' }}>
                  {new Date(m.granted_at).toLocaleDateString()}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {m.user_id !== user?.id && (
                    <button
                      style={BTN_DANGER}
                      onClick={() => handleRemove(m.user_id)}
                      title="Remove from project"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add member form */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Add member</div>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem' }}>
            <span style={{ opacity: 0.7 }}>Email address</span>
            <input
              type="email"
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              placeholder="member@example.com"
              required
              style={{ ...inputStyle, minWidth: '220px' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem' }}>
            <span style={{ opacity: 0.7 }}>Role</span>
            <select
              value={addRole}
              onChange={e => setAddRole(e.target.value as ProjectRole)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="project_member">Member</option>
              <option value="project_admin">Admin</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={adding || !addEmail.trim()}
            style={{
              ...BTN,
              backgroundColor: 'var(--primary)', color: '#fff',
              border: 'none', padding: '0.5rem 1rem', fontSize: '0.875rem',
              opacity: adding ? 0.6 : 1,
            }}
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
        {addError && (
          <p style={{ color: 'var(--error, #f44336)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>⚠ {addError}</p>
        )}
        <p style={{ fontSize: '0.75rem', opacity: 0.55, marginTop: '0.5rem' }}>
          The person must already have a Wildlife Watcher account.
        </p>
      </div>
    </div>
  )
}
