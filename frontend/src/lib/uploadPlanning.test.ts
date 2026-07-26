import { describe, expect, it } from 'vitest'
import { orderFilesBySession, planBatches } from './uploadPlanning'
import type { SessionAssignment } from './uploadPlanning'

describe('planBatches', () => {
  it('reduces to fixed-size chunks with no deployment info', () => {
    const plan = planBatches(25, [], 10)
    expect(plan).toEqual([
      { start: 0, end: 10, assigned: undefined },
      { start: 10, end: 20, assigned: undefined },
      { start: 20, end: 25, assigned: undefined },
    ])
  })

  it('handles zero files', () => {
    expect(planBatches(0, [], 10)).toEqual([])
  })

  // The PR #99 review finding: sorted-then-fixed chunks could still span two
  // deployments, mislabeling the tail of the batch on the server.
  it('never lets a batch span two deployments', () => {
    const deps = ['A', 'A', 'A', 'B', 'B']
    const plan = planBatches(5, deps, 10)
    expect(plan).toEqual([
      { start: 0, end: 3, assigned: 'A' },
      { start: 3, end: 5, assigned: 'B' },
    ])
  })

  it('still caps a single deployment at the batch size', () => {
    const deps = Array.from({ length: 12 }, () => 'A')
    const plan = planBatches(12, deps, 10)
    expect(plan).toEqual([
      { start: 0, end: 10, assigned: 'A' },
      { start: 10, end: 12, assigned: 'A' },
    ])
  })

  it('separates assigned files from unassigned ones', () => {
    const deps: (string | undefined)[] = [undefined, undefined, 'A', 'A']
    const plan = planBatches(4, deps, 10)
    expect(plan).toEqual([
      { start: 0, end: 2, assigned: undefined },
      { start: 2, end: 4, assigned: 'A' },
    ])
  })

  it('covers every file exactly once', () => {
    const deps = ['A', 'B', 'A', 'B', 'A']  // worst case: alternating
    const plan = planBatches(5, deps, 10)
    expect(plan.map((p) => p.end - p.start).reduce((a, b) => a + b, 0)).toBe(5)
    expect(plan[0].start).toBe(0)
    for (let i = 1; i < plan.length; i++) expect(plan[i].start).toBe(plan[i - 1].end)
  })
})

describe('orderFilesBySession', () => {
  it('returns null order when there is nothing to reorder', () => {
    expect(orderFilesBySession(5, undefined)).toEqual({ order: null, perFileDeployment: [] })
    expect(orderFilesBySession(5, [])).toEqual({ order: null, perFileDeployment: [] })
  })

  it('groups files of one deployment contiguously, unassigned first', () => {
    // files: 0,3 → B; 1 → A; 2,4 unassigned
    const sessions: SessionAssignment[] = [
      { deploymentId: 'B', indices: [0, 3] },
      { deploymentId: 'A', indices: [1] },
    ]
    const { order, perFileDeployment } = orderFilesBySession(5, sessions)
    expect(order).toEqual([2, 4, 1, 0, 3])
    expect(perFileDeployment).toEqual([undefined, undefined, 'A', 'B', 'B'])
  })

  it('keeps original order within a group (stable)', () => {
    const sessions: SessionAssignment[] = [{ deploymentId: 'A', indices: [4, 1, 3] }]
    const { order } = orderFilesBySession(5, sessions)
    expect(order).toEqual([0, 2, 1, 3, 4])
  })

  it('composes with planBatches so no batch mixes deployments', () => {
    const sessions: SessionAssignment[] = [
      { deploymentId: 'B', indices: [0, 1, 2] },
      { deploymentId: 'A', indices: [3, 4] },
    ]
    const { perFileDeployment } = orderFilesBySession(5, sessions)
    const plan = planBatches(5, perFileDeployment, 2)
    for (const batch of plan) {
      const inBatch = new Set(perFileDeployment.slice(batch.start, batch.end))
      expect(inBatch.size).toBe(1)
      expect(batch.assigned).toBe([...inBatch][0])
    }
  })
})
