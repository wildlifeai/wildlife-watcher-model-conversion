import { describe, expect, it } from 'vitest'
import { cameraModel, cameraScores } from './cameraScores'

describe('cameraScores', () => {
  it('reads the person-detection scores of a WW500 frame, highest first', () => {
    // A run-2 frame: the camera said "no person", so no Camera AI observation is reflected.
    const exif = { user_comment_fields: { person: '38%', 'no person': '62%' }, Model: 'WW500 HM0360' }
    expect(cameraScores(exif)).toEqual([
      { label: 'no person', pct: 62 },
      { label: 'person', pct: 38 },
    ])
    expect(cameraModel(exif)).toBe('WW500 HM0360')
  })

  it('accepts bare numbers and rounds', () => {
    expect(cameraScores({ user_comment_fields: { rat: 87, 'not rat': '12.6' } })).toEqual([
      { label: 'rat', pct: 87 },
      { label: 'not rat', pct: 13 },
    ])
  })

  it('leaves telemetry and non-numeric fields out', () => {
    const exif = { user_comment_fields: { Temp: '14.5', Batt: '87', kiwi: '80', note: 'n/a' } }
    expect(cameraScores(exif)).toEqual([{ label: 'kiwi', pct: 80 }])
  })

  it('is empty without scores or metadata', () => {
    expect(cameraScores(null)).toEqual([])
    expect(cameraScores({})).toEqual([])
    expect(cameraScores({ user_comment_fields: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })).toEqual([])
    expect(cameraModel({})).toBeNull()
  })
})
