/**
 * Pure batch planning for the upload pipeline.
 *
 * `assigned_deployment_id` is one value per /api/exif/parse request, so a
 * batch that mixed deployments would file part of itself under the wrong
 * one. These helpers order files by their (triage-)assigned deployment and
 * cut batches so a boundary falls at the size cap *or* at a deployment
 * change, whichever comes first.
 */

export interface SessionAssignment {
  deploymentId: string
  indices: number[]
}

export interface BatchPlanEntry {
  start: number
  end: number
  assigned?: string
}

/**
 * Order file indices so files of one deployment are contiguous (unassigned
 * first, original order preserved within each group). Returns `order: null`
 * when there are no session assignments — callers skip reordering entirely,
 * which keeps the common no-triage path allocation-free.
 */
export function orderFilesBySession(
  count: number,
  sessionAssignments?: SessionAssignment[],
): { order: number[] | null; perFileDeployment: (string | undefined)[] } {
  if (!sessionAssignments?.length) return { order: null, perFileDeployment: [] }

  const byIndex = new Map<number, string>()
  for (const g of sessionAssignments) for (const i of g.indices) byIndex.set(i, g.deploymentId)
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => {
    const da = byIndex.get(a) ?? ''
    const db = byIndex.get(b) ?? ''
    return da === db ? a - b : da < db ? -1 : 1
  })
  return { order, perFileDeployment: order.map((i) => byIndex.get(i)) }
}

/**
 * Cut `count` files (already deployment-ordered) into batches of at most
 * `batchSize` that never span two deployments. With an empty
 * `perFileDeployment` every entry reads as undefined and this reduces to
 * plain fixed-size chunks.
 */
export function planBatches(
  count: number,
  perFileDeployment: (string | undefined)[],
  batchSize: number,
): BatchPlanEntry[] {
  const plan: BatchPlanEntry[] = []
  for (let s = 0; s < count; ) {
    const dep = perFileDeployment[s]
    let e = s + 1
    while (e < count && e - s < batchSize && perFileDeployment[e] === dep) e++
    plan.push({ start: s, end: e, assigned: dep })
    s = e
  }
  return plan
}
