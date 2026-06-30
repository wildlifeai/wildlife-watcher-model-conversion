/**
 * Guides loader — turns the markdown files in src/content/guides/ into a
 * typed, sorted list at build time.
 *
 * Publishing workflow: merge a .md file (with the frontmatter below) into
 * src/content/guides/ and the next build renders it at /guides/<slug>.
 * Images live in public/guides/img/<slug>/ and are referenced from the
 * markdown as /guides/img/<slug>/name.png. See the README in the guides
 * folder for authoring conventions.
 *
 * Frontmatter:
 *   ---
 *   title: Machine Learning Models
 *   description: One-line summary shown on the guides index.
 *   category: Analysis
 *   order: 10
 *   updated: 2026-06-12
 *   ---
 */

export interface Guide {
  slug: string
  title: string
  description: string
  category: string
  order: number
  updated: string
  body: string
}

// Eagerly import every guide as raw text. Guides are KB-scale markdown, so
// this stays cheap; revisit with lazy globs if the folder grows past dozens.
// The folder README documents authoring conventions and is excluded from the
// glob so its text never ships in the bundle.
const modules = import.meta.glob(['../content/guides/*.md', '!**/README.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { meta: {}, body: raw }

  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { meta, body: raw.slice(match[0].length) }
}

function buildGuides(): Guide[] {
  const guides: Guide[] = []
  for (const [path, raw] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? ''
    const slug = filename.replace(/\.md$/, '')
    const { meta, body } = parseFrontmatter(raw)
    guides.push({
      slug,
      title: meta.title || slug,
      description: meta.description || '',
      category: meta.category || 'General',
      order: Number(meta.order) || 999,
      updated: meta.updated || '',
      body,
    })
  }
  guides.sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order || a.title.localeCompare(b.title))
  return guides
}

export const guides: Guide[] = buildGuides()

export function getGuide(slug: string): Guide | undefined {
  return guides.find(g => g.slug === slug)
}

/** Guides grouped by category, preserving the sorted order. */
export function guidesByCategory(): Map<string, Guide[]> {
  const map = new Map<string, Guide[]>()
  for (const g of guides) {
    const list = map.get(g.category) ?? []
    list.push(g)
    map.set(g.category, list)
  }
  return map
}
