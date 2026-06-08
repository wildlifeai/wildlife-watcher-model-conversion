/* eslint-disable react-hooks/set-state-in-effect */
/**
 * AnnotationsPage — /annotations
 *
 * WS5: MediaBrowser with a branded Ribbon (deployment/species/status filters,
 *      thumbnail size), StatusBadge overlays, advanced-settings popup
 *      (date range, day/night), and URL-based deployment
 *      pre-selection for upload→annotations handoff (WS5-T6).
 */
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProjectSelection } from '../hooks/useProjectSelection'
import { MediaBrowser } from '../components/data/MediaBrowser'
import { supabase } from '../config/supabase'

interface Deployment {
  id: string
  project_id: string
  location_name: string | null
}

export function AnnotationsPage() {
  const { user } = useAuth()
  const { selectedProjectIds } = useProjectSelection()
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)

  // WS5-T6: read ?deployment=<id> placed by the upload dock "View Annotations" link
  const [searchParams] = useSearchParams()
  const initialDeploymentId = searchParams.get('deployment') ?? undefined

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)

    let query = supabase
      .from('deployments')
      .select('id, project_id, location_name')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (selectedProjectIds.length > 0) {
      query = query.in('project_id', selectedProjectIds)
    }

    query.then(({ data }) => {
      if (cancelled) return
      setDeployments(data || [])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [user, selectedProjectIds])

  return (
    <div>
      {loading ? (
        <p style={{ opacity: 0.5 }}>Loading deployments…</p>
      ) : (
        <MediaBrowser
          deployments={deployments}
          initialDeploymentId={initialDeploymentId}
        />
      )}
    </div>
  )
}

