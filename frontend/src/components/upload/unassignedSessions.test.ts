import { describe, expect, it } from 'vitest'
import { buildSessions, SESSION_GAP_MS } from './unassignedSessions'

const T0 = Date.UTC(2026, 6, 20, 8, 0, 0) // 20 Jul 2026 08:00Z

function file(name: string, lastModified: number): File {
  return new File([], name, { type: 'image/jpeg', lastModified })
}

function fixture(entries: { path: string; ms: number }[]) {
  const files = entries.map((e, i) => file(e.path.split('/').pop() ?? `f${i}.jpg`, e.ms))
  const paths = entries.map((e) => e.path)
  return { files, paths }
}

describe('buildSessions', () => {
  it('returns nothing when nothing is unresolved', () => {
    const { files, paths } = fixture([{ path: 'MEDIA/AABBCCDD/A0001.JPG', ms: T0 }])
    expect(buildSessions(files, paths, [])).toEqual([])
  })

  it('groups files of one card folder within the gap into one session', () => {
    const { files, paths } = fixture([
      { path: 'MEDIA/AABBCCDD/A0001.JPG', ms: T0 },
      { path: 'MEDIA/AABBCCDD/A0002.JPG', ms: T0 + 60_000 },
      { path: 'MEDIA/AABBCCDD/A0003.JPG', ms: T0 + 120_000 },
    ])
    const sessions = buildSessions(files, paths, [0, 1, 2])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].indices).toEqual([0, 1, 2])
    expect(sessions[0].cardFolder).toBe('AABBCCDD')
    expect(sessions[0].firstMs).toBe(T0)
    expect(sessions[0].lastMs).toBe(T0 + 120_000)
  })

  it('splits a folder into two sessions across a > 6 h gap', () => {
    const { files, paths } = fixture([
      { path: 'MEDIA/AABBCCDD/A0001.JPG', ms: T0 },
      { path: 'MEDIA/AABBCCDD/A0002.JPG', ms: T0 + SESSION_GAP_MS + 1 },
    ])
    const sessions = buildSessions(files, paths, [0, 1])
    expect(sessions).toHaveLength(2)
    expect(sessions[0].indices).toEqual([0])
    expect(sessions[1].indices).toEqual([1])
  })

  it('keeps a gap of exactly the threshold in one session', () => {
    const { files, paths } = fixture([
      { path: 'MEDIA/AABBCCDD/A0001.JPG', ms: T0 },
      { path: 'MEDIA/AABBCCDD/A0002.JPG', ms: T0 + SESSION_GAP_MS },
    ])
    expect(buildSessions(files, paths, [0, 1])).toHaveLength(1)
  })

  it('separates different card folders even at identical times', () => {
    const { files, paths } = fixture([
      { path: 'MEDIA/AABBCCDD/A0001.JPG', ms: T0 },
      { path: 'MEDIA/EEFF0011/B0001.JPG', ms: T0 },
    ])
    const sessions = buildSessions(files, paths, [0, 1])
    expect(sessions).toHaveLength(2)
    expect(new Set(sessions.map((s) => s.cardFolder))).toEqual(new Set(['AABBCCDD', 'EEFF0011']))
  })

  it('normalises folder case and accepts backslash paths', () => {
    const { files, paths } = fixture([
      { path: 'MEDIA\\aabbccdd\\A0001.JPG', ms: T0 },
      { path: 'MEDIA/AABBCCDD/A0002.JPG', ms: T0 + 1000 },
    ])
    const sessions = buildSessions(files, paths, [0, 1])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].cardFolder).toBe('AABBCCDD')
  })

  it('collects loose files (no MEDIA folder) with a null cardFolder', () => {
    const { files, paths } = fixture([{ path: 'IMG_0001.JPG', ms: T0 }])
    const sessions = buildSessions(files, paths, [0])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].cardFolder).toBeNull()
  })

  it('sorts sessions chronologically and orders indices by time within one', () => {
    const { files, paths } = fixture([
      { path: 'MEDIA/EEFF0011/B0001.JPG', ms: T0 + 3_600_000 },
      { path: 'MEDIA/AABBCCDD/A0002.JPG', ms: T0 + 60_000 },
      { path: 'MEDIA/AABBCCDD/A0001.JPG', ms: T0 },
    ])
    const sessions = buildSessions(files, paths, [0, 1, 2])
    expect(sessions.map((s) => s.cardFolder)).toEqual(['AABBCCDD', 'EEFF0011'])
    expect(sessions[0].indices).toEqual([2, 1]) // time order, not input order
  })

  it('only considers the requested unresolved indices', () => {
    const { files, paths } = fixture([
      { path: 'MEDIA/AABBCCDD/A0001.JPG', ms: T0 },
      { path: 'MEDIA/AABBCCDD/A0002.JPG', ms: T0 + 1000 },
    ])
    const sessions = buildSessions(files, paths, [1])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].indices).toEqual([1])
  })
})
