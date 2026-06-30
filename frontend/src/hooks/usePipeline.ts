import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/apiClient'

/**
 * usePipeline — trigger AI inference on a deployment (AN-10).
 *
 * POST /api/pipeline/run runs synchronously on the backend (MEDIA_PREP →
 * SPECIESNET → ANIMAL_CROP by default) and returns the aggregate result, so the
 * mutation resolves only when the run finishes. For very large deployments this
 * can be a long request; an async job-based variant is a future improvement.
 */

export interface PipelineRunResult {
  deployment_id: string
  annotation_run_id: string | null
  total_media: number
  total_observations: number
  duration_seconds: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: any[]
}

export function useRunPipeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      deploymentId: string
      steps?: string[]
      confidenceThreshold?: number
    }) => {
      const body: Record<string, unknown> = { deployment_id: args.deploymentId }
      if (args.steps) body.steps = args.steps
      if (args.confidenceThreshold != null) body.confidence_threshold = args.confidenceThreshold
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (await apiClient.post('/api/pipeline/run', body)) as any
      return r.data as PipelineRunResult
    },
    onSuccess: (_data, vars) => {
      // Fresh observations/clusters → refetch anything keyed on this deployment.
      qc.invalidateQueries({ queryKey: ['brain', 'clusters', vars.deploymentId] })
    },
  })
}
