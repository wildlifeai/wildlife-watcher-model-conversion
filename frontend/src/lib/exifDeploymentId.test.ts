import { describe, expect, it } from 'vitest'
import { findDeploymentIdInJpeg, readDeploymentIds } from './exifDeploymentId'

const UUID = 'e10f7c43-9b90-4f59-bef5-f35b8e698517'

/**
 * A minimal JPEG: SOI, one APP1 Exif segment holding a TIFF header and a single
 * IFD0, then EOI. `entries` become IFD0 entries; string values are written
 * out-of-line after the IFD so the offset path is exercised.
 */
function jpegWith(
  entries: { tag: number; type?: number; value: string }[],
  opts: { bigEndian?: boolean; exifIfd?: { tag: number; value: string }[] } = {},
): ArrayBuffer {
  const little = !opts.bigEndian
  const bytes: number[] = []
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff])
  const u32 = (v: number) =>
    little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff] : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]

  // TIFF block, offsets relative to its start.
  const tiff: number[] = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)]
  const ifd0Entries = [...entries]
  const hasExifIfd = !!opts.exifIfd
  const ifd0Count = ifd0Entries.length + (hasExifIfd ? 1 : 0)
  const ifd0Start = 8
  const ifd0End = ifd0Start + 2 + ifd0Count * 12 + 4
  let dataCursor = ifd0End
  const data: number[] = []
  const writeString = (s: string) => {
    const at = dataCursor
    const enc = Array.from(s, (c) => c.charCodeAt(0)).concat([0])
    data.push(...enc)
    dataCursor += enc.length
    return { at, len: enc.length }
  }

  const ifd0: number[] = [...u16(ifd0Count)]
  for (const e of ifd0Entries) {
    const { at, len } = writeString(e.value)
    ifd0.push(...u16(e.tag), ...u16(e.type ?? 2), ...u32(len), ...u32(at))
  }
  let exifIfdBytes: number[] = []
  if (hasExifIfd) {
    // Reserve the ExifIFD after the string data.
    const exifIfdStart = dataCursor + 0 // filled after strings; compute below
    const exifEntries = opts.exifIfd as { tag: number; value: string }[]
    const exifIfdLen = 2 + exifEntries.length * 12 + 4
    const exifStrings: { at: number; len: number }[] = []
    let cursor = exifIfdStart + exifIfdLen
    const exifData: number[] = []
    for (const e of exifEntries) {
      const enc = Array.from(e.value, (c) => c.charCodeAt(0)).concat([0])
      exifStrings.push({ at: cursor, len: enc.length })
      exifData.push(...enc)
      cursor += enc.length
    }
    exifIfdBytes = [...u16(exifEntries.length)]
    exifEntries.forEach((e, i) => {
      exifIfdBytes.push(...u16(e.tag), ...u16(7), ...u32(exifStrings[i].len), ...u32(exifStrings[i].at))
    })
    exifIfdBytes.push(...u32(0), ...exifData)
    ifd0.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdStart))
  }
  ifd0.push(...u32(0)) // next IFD: none
  tiff.push(...ifd0, ...data, ...exifIfdBytes)

  const app1Payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff] // "Exif\0\0"
  const app1Len = app1Payload.length + 2
  bytes.push(0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, ...app1Payload, 0xff, 0xd9)
  return new Uint8Array(bytes).buffer
}

describe('findDeploymentIdInJpeg', () => {
  it('reads the WW500 Deployment_ID tag (0xF200) from IFD0', () => {
    expect(findDeploymentIdInJpeg(jpegWith([{ tag: 0xf200, value: UUID }]))).toBe(UUID)
  })

  it('handles big-endian TIFF too', () => {
    expect(findDeploymentIdInJpeg(jpegWith([{ tag: 0xf200, value: UUID }], { bigEndian: true }))).toBe(UUID)
  })

  it('lower-cases and ignores surrounding text and NULs', () => {
    const upper = UUID.toUpperCase()
    expect(findDeploymentIdInJpeg(jpegWith([{ tag: 0xf200, value: `id=${upper}\0\0` }]))).toBe(UUID)
  })

  it('falls back to a uuid in UserComment when there is no Deployment_ID tag', () => {
    const jpeg = jpegWith([{ tag: 0x0110, value: 'WW500 HM0360' }], {
      exifIfd: [{ tag: 0x9286, value: `ASCII\0\0\0no person: 46%; person: 54%; ${UUID}` }],
    })
    expect(findDeploymentIdInJpeg(jpeg)).toBe(UUID)
  })

  it('prefers Deployment_ID over a different uuid in UserComment', () => {
    const other = '11111111-2222-4333-8444-555555555555'
    const jpeg = jpegWith([{ tag: 0xf200, value: UUID }], { exifIfd: [{ tag: 0x9286, value: other }] })
    expect(findDeploymentIdInJpeg(jpeg)).toBe(UUID)
  })

  it('returns null for a JPEG without the tag', () => {
    expect(findDeploymentIdInJpeg(jpegWith([{ tag: 0x0110, value: 'WW500 HM0360' }]))).toBeNull()
  })

  it('returns null for a JPEG with no APP1 and for non-JPEG bytes', () => {
    expect(findDeploymentIdInJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBeNull()
    expect(findDeploymentIdInJpeg(new Uint8Array([0x42, 0x4d, 0x00, 0x00]).buffer)).toBeNull()
    expect(findDeploymentIdInJpeg(new ArrayBuffer(0))).toBeNull()
  })

  it('does not read past a truncated file', () => {
    const full = new Uint8Array(jpegWith([{ tag: 0xf200, value: UUID }]))
    expect(findDeploymentIdInJpeg(full.slice(0, 40).buffer)).toBeNull()
  })
})

describe('readDeploymentIds', () => {
  it('returns ids aligned to the input files, null where absent', async () => {
    const withId = new File([jpegWith([{ tag: 0xf200, value: UUID }])], 'a.jpg', { type: 'image/jpeg' })
    const without = new File([jpegWith([{ tag: 0x0110, value: 'x' }])], 'b.jpg', { type: 'image/jpeg' })
    const junk = new File(['not a jpeg'], 'c.txt')
    expect(await readDeploymentIds([withId, without, junk, withId], 2)).toEqual([UUID, null, null, UUID])
  })

  it('handles an empty batch', async () => {
    expect(await readDeploymentIds([])).toEqual([])
  })
})
