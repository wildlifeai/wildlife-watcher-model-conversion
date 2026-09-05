import { describe, expect, it } from 'vitest'
import { LANDED_SLACK_MS, survivingPending } from './pendingCards'

const DEP = '01e03d10-b53a-4d95-b60e-3f2ec26b96ee'
const OTHER = 'ceb77c85-08bd-4868-8b3a-0f0dd4fad62b'
const SINCE = Date.UTC(2026, 8, 5, 8, 16, 0)
const iso = (offsetMs: number) => new Date(SINCE + offsetMs).toISOString()
const view = new Set([DEP, OTHER])

const ghosts = (n: number, dep = DEP) =>
  Array.from({ length: n }, (_, i) => ({ fileName: `A9BC8${i}0.JPG`, deploymentId: dep }))

describe('survivingPending', () => {
  it('retires one ghost per real row that landed since the upload started', () => {
    // The bench run: ten ghosts, seven renamed rows land ninety seconds later.
    const rows = Array.from({ length: 7 }, (_, i) => ({
      deployment_id: DEP, file_name: `2026090519455${i}_01.jpg`, created_at: iso(90_000),
    }))
    expect(survivingPending(ghosts(10), rows, SINCE, view)).toHaveLength(3)
  })

  it('does not let rows from before the upload retire anything', () => {
    const old = [{ deployment_id: DEP, file_name: 'old.jpg', created_at: iso(-LANDED_SLACK_MS - 1) }]
    expect(survivingPending(ghosts(2), old, SINCE, view)).toHaveLength(2)
  })

  it('allows a little clock slack', () => {
    const early = [{ deployment_id: DEP, file_name: 'x.jpg', created_at: iso(-LANDED_SLACK_MS + 1) }]
    expect(survivingPending(ghosts(2), early, SINCE, view)).toHaveLength(1)
  })

  it('keeps deployments separate', () => {
    const rows = [{ deployment_id: OTHER, file_name: 'o.jpg', created_at: iso(1000) }]
    const out = survivingPending([...ghosts(2), ...ghosts(1, OTHER)], rows, SINCE, view)
    expect(out.map((p) => p.deploymentId)).toEqual([DEP, DEP])
  })

  it('still drops a ghost whose exact file name already exists, and duplicates', () => {
    const rows = [{ deployment_id: DEP, file_name: 'a9bc800.jpg', created_at: null }]
    const out = survivingPending([...ghosts(2), ghosts(1)[0]], rows, null, view)
    expect(out.map((p) => p.fileName)).toEqual(['A9BC810.JPG'])
  })

  it('hides ghosts for deployments not in view and returns nothing for an empty list', () => {
    expect(survivingPending(ghosts(2), [], SINCE, new Set([OTHER]))).toEqual([])
    expect(survivingPending([], [], SINCE, view)).toEqual([])
  })

  it('without a start time only the name match applies', () => {
    const rows = [{ deployment_id: DEP, file_name: 'renamed.jpg', created_at: iso(1000) }]
    expect(survivingPending(ghosts(3), rows, null, view)).toHaveLength(3)
  })
})
