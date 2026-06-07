import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

export interface SpeciesCoverage {
  scientific_name: string
  count: number
  under_represented: boolean
}

export interface DatasetHealth {
  project_id: string
  deployments: number
  species: SpeciesCoverage[]
  species_count: number
  review_funnel: Record<string, number>
  outlier_rate: number | null
  total_observations: number
}

export function useDatasetHealth(projectId?: string) {
  return useQuery({
    queryKey: ['intelligence', 'health', projectId],
    queryFn: async () => {
      const r = (await apiClient.get(`/api/intelligence/health/${projectId}`)) as any
      return r.data as DatasetHealth
    },
    enabled: !!projectId,
  })
}

export interface ConservationAlert {
  id: string
  alert_type: string
  severity: 'info' | 'warning' | 'critical'
  deployment_id: string | null
  details: Record<string, any> | null
  first_seen: string | null
}

export function useAlerts(projectId?: string) {
  return useQuery({
    queryKey: ['intelligence', 'alerts', projectId],
    queryFn: async () => {
      const r = (await apiClient.get(`/api/intelligence/alerts/${projectId}`)) as any
      return r.data as { alerts: ConservationAlert[]; count: number }
    },
    enabled: !!projectId,
  })
}
