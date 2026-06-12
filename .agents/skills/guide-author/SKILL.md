---

name: guide-author
description: >
Convert source material (Notion exports, Word docs, pasted text, screenshots of
instructions) into a published website guide under frontend/src/content/guides/.
Use whenever someone asks to add, migrate, convert, or update a user guide for
the Wildlife Watcher website.
-----------------------------------------

# Guide Author

Guides are Markdown files in `frontend/src/content/guides/`. Every `.md` there
(except `README.md`) is rendered at `/guides/<filename-without-extension>` on
the next build — merging a PR is the entire publishing workflow. Authoring
conventions live in `frontend/src/content/guides/README.md`; this skill is the
agent workflow for producing a compliant guide from any source.

---

# 1. Output contract

Produce exactly two things:

1. `frontend/src/content/guides/<slug>.md` — kebab-case slug, becomes the URL.
2. `frontend/public/guides/img/<slug>/` — the guide's images (only if it has any).

The file must start with this frontmatter (all five keys):

```markdown
---
title: Focusing the camera for close-range setups
description: One sentence shown on the guides index. No trailing period needed.
category: Setup
order: 10
updated: 2026-06-12
---
```

* `category` — reuse an existing category before inventing one. Check current
  guides: `grep -h --exclude=README.md "^category:" frontend/src/content/guides/*.md | sort -u`.
  Intended taxonomy: `Setup`, `Field work`, `Analysis` — prefer these before
  introducing a new category, and confirm any new one with the user.
* `order` — controls sorting within the category (lower = first). Read the
  sibling guides in the same category and slot sensibly (gaps of 10).
* `updated` — today's date, `YYYY-MM-DD`.

# 2. Content rules

* **Markdown only, GitHub-flavoured.** Tables, task lists, fenced code blocks
  work. Raw HTML is never rendered — strip any HTML from the source rather
  than carrying it over.
* **No top-level `# heading`** — the page renders the frontmatter title.
  Start with a short intro paragraph, then `##` sections.
* Voice: second person ("you"), present tense, plain language for
  conservation field workers — not developers. Spell out jargon on first use.
* Keep steps numbered and actionable; one action per step. Use `>` blockquotes
  for warnings and tips.
* Link to related pages with absolute site paths: `/resources`, `/faq`,
  `/guides/<other-slug>`.

# 3. Accuracy guardrails (non-negotiable)

* **Never invent product facts.** Hardware specs, battery life, AI behaviour,
  and feature availability must come from the source material or from the
  site's existing canon (`frontend/src/pages/FaqPage.tsx`,
  `ResourcesPage.tsx`, existing guides). If the source claims something that
  contradicts the canon (e.g. solar power, live LoRaWAN telemetry — both NOT
  shipped), flag it to the user instead of publishing it.
* Use the canonical wordings: SD card = "FAT32-formatted microSD card,
  32–64 GB (Class 10 or higher)"; battery = "about one month on 4× AA";
  LoRaWAN = "in development".
* If the source is incomplete or ambiguous, leave a `> **TODO (team):** …`
  blockquote rather than guessing — reviewers can fill it in on the PR.

# 4. Images

1. One folder per guide: `frontend/public/guides/img/<slug>/`.
2. Web-compress before committing — target ≤ 200 KB per image. With Python:
   `python -c "from PIL import Image; im = Image.open(r'<in>'); im.thumbnail((1400, 1400)); im.save(r'<out>', quality=80)"`.
3. Reference with absolute paths and meaningful alt text:
   `![Live preview showing a sharp platform](/guides/img/<slug>/preview.png)`
4. Notion exports name images with long hashes — rename them to short
   descriptive names.

# 5. Source-specific notes

* **Notion export** (Export → Markdown & CSV): strip Notion artefacts —
  the duplicated H1 title, `aside`/callout HTML, trailing UUID in the
  filename, and absolute notion.so links (convert to plain text or proper
  external links). Move images per §4.
* **Word / PDF / screenshots**: extract the text faithfully; reproduce tables
  as GFM tables. Do not summarise away steps.

# 6. Validate before finishing

From `frontend/`:

```bash
npx vite build
```

* Build must pass, and the guide must appear in the output
  (`grep -rl "<guide title>" dist/assets`).
* Self-check: frontmatter has all five keys; no `# h1` in the body; no raw
  HTML; every image path resolves to a file in `public/guides/img/<slug>/`;
  category matches an existing one (or the user approved a new one).

Then commit the guide + images together. PR title: `docs(guides): add <title>`.
