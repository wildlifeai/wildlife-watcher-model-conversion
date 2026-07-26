# E2E checks — dev website

Browser-level Playwright checks that the deployed (or local) dev stack works
end-to-end. They complement `backend/tests/` (pytest unit/domain tests): these
drive the real UI against a real database.

## What is covered

| Spec | Proves |
|---|---|
| `01-smoke` | Site + API up; public pages (`/`, `/guides`, `/faq`, `/resources`) render clean; seeded user can log in and every authed page (`/toolkit`, `/field`, `/annotations`, `/insights`, `/settings`) renders without errors or auth bounces |
| `02-demo` | "Try the demo" opens a signed-in session via `/api/auth/demo-session`; DemoGuard keeps it read-only (upload gated) |
| `03-upload-exif` | Real SD-card folder upload through the modal (webkitdirectory); EXIF UserComment deployment UUIDs bind exact-match to seeded deployments; a stamped UUID with **no** deployments row is auto-created (#92) so nothing lands unassigned |
| `04-lorawan-realtime` | With the Field page open, a synthetic `lorawan_messages`+`lorawan_parsed_messages` insert appears in the UI **without reload** — verifies both the FieldPage subscription (#94) and that the realtime publication SQL is applied to the dev DB |

## Running

```bash
cd e2e
npm install && npx playwright install chromium
cp .env.example .env   # fill in target + creds
npm run e2e            # or e2e:smoke / e2e:demo / e2e:upload / e2e:lorawan
```

Specs self-skip when their env is missing, so a partial `.env` still gives a
useful (smaller) run. Point `E2E_BASE_URL`/`E2E_API_URL` at either the local
stack (`docker-compose.dev.yml` + `frontend: npm run dev`) or the deployed dev
site. The upload and realtime specs **write to the target database** — run them
against dev only, never production.

First run note: the selectors use roles/text and were written from the source;
if the UI has drifted, expect one calibration pass (traces/screenshots are
retained on failure — `npm run report`).

## Manual checklist (not automatable from here)

- [ ] Realtime publication SQL applied to the **live dev** DB after #94 merges
      (apply manually — a `supabase/**` push to backend dev resets the DB)
- [ ] CF Pages build env still injects the intended Supabase anon key (no
      service-role key in the public bundle)
- [ ] Dev uploads storage account (`wwuploadsae`) reachable from the backend
- [ ] Demo account enabled on the dev backend (`/api/auth/demo-session` 200)
- [ ] After a backend-dev DB reseed: re-run `03-upload-exif` (seeds restore the
      fixture deployment UUIDs) and re-apply the publication SQL if the reset
      dropped it
- [ ] LoRaWAN end-to-end with real hardware: bench WW500 uplink → TTN →
      lorawan-ingest → Field page (the spec only covers DB → UI)
