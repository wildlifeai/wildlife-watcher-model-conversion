// Copyright (c) 2026
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Instant local thumbnails for just-uploaded images.
 *
 * Server renditions (Supabase thumbnails) can take seconds-to-minutes after an
 * upload — and for `gdrive://` originals they're the *only* thing the grid can
 * render. So the user otherwise stares at "Processing…" placeholders right after
 * uploading their own photos.
 *
 * The browser already holds the `File` objects the user selected, so we mint an
 * `URL.createObjectURL()` per file (keyed by filename) the moment the upload
 * starts. The Annotations grid uses it as the thumbnail until the real rendition
 * lands — giving sub-second visual feedback, fully decoupled from the backend.
 *
 * Object URLs pin the file blob in memory, so we TTL-evict (and cap) and always
 * `revokeObjectURL` what we drop.
 */

type Entry = { url: string; ts: number }

const previews = new Map<string, Entry>() // key: filename.toLowerCase()
// Camera-trap images are 2–8 MB each, and an object URL pins its File blob in memory
// until revoked — so the cap is the real OOM guard. The grid only pages 100 at a time,
// so 200 comfortably covers the visible page + a buffer.
const TTL_MS = 10 * 60 * 1000 // 10 min — outlives typical (even CPU) rendition delays
const MAX_ENTRIES = 200

function evict(): void {
  const now = Date.now()
  for (const [key, e] of previews) {
    if (now - e.ts > TTL_MS) {
      URL.revokeObjectURL(e.url)
      previews.delete(key)
    }
  }
  // Cap: drop oldest first. Capture the excess BEFORE the loop — `previews.size`
  // shrinks as we delete, so re-evaluating it in the condition would stop halfway.
  if (previews.size > MAX_ENTRIES) {
    const oldest = [...previews.entries()].sort((a, b) => a[1].ts - b[1].ts)
    const excess = previews.size - MAX_ENTRIES
    for (let i = 0; i < excess; i++) {
      const [key, e] = oldest[i]
      URL.revokeObjectURL(e.url)
      previews.delete(key)
    }
  }
}

/** Mint instant-preview object URLs for a batch of just-selected files. */
export function registerLocalPreviews(files: File[]): void {
  evict()
  for (const f of files) {
    // Only browser-renderable images; HEIC/BMP may not render but the <img>
    // onError gracefully falls back to the placeholder, so we still register them.
    if (f.type && !f.type.startsWith('image/')) continue
    const key = f.name.toLowerCase()
    const existing = previews.get(key)
    if (existing) URL.revokeObjectURL(existing.url) // replace a same-named earlier upload
    previews.set(key, { url: URL.createObjectURL(f), ts: Date.now() })
  }
  evict() // enforce the cap on THIS batch too, not just on the next call
}

/** Look up an instant preview by a media record's `file_name`. */
export function getLocalPreview(fileName: string | null | undefined): string | null {
  if (!fileName) return null
  return previews.get(fileName.toLowerCase())?.url ?? null
}

/** Revoke everything (e.g. on logout). */
export function clearLocalPreviews(): void {
  for (const e of previews.values()) URL.revokeObjectURL(e.url)
  previews.clear()
}
