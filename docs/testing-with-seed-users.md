# Testing the Website with Seed User Accounts

> **Last updated:** May 18, 2026

## Overview

The Wildlife Watcher development environment includes **17 pre-seeded user accounts** with different organisational roles and project assignments. These accounts are designed to let developers manually test and automatically validate role-based access control (RBAC), multi-tenant isolation, and feature visibility across the website.

## Where Are the Test Users Defined?

| What | Location |
|------|----------|
| **User emails, roles, org/project assignments, and UUIDs** | [`ww-backend/supabase/seeds/USER-CREDENTIALS-REFERENCE.md`](https://github.com/wildlifeai/ww-backend/blob/dev/supabase/seeds/USER-CREDENTIALS-REFERENCE.md) |
| **SQL that creates them** | `ww-backend/supabase/seeds/dev/data.sql` (development seed) |
| **SQL that creates the core Apps Manager** | `ww-backend/supabase/seeds/seed.sql` (production-safe seed) |
| **Password** | Set via `SEED_USER_PASSWORD` env var. Stored as a GitHub Secret and available to developers on request. Never hardcoded in source. |

> [!IMPORTANT]
> The **canonical reference** for all test user credentials, organisation assignments, role mappings, and UUIDs is `USER-CREDENTIALS-REFERENCE.md` in the `ww-backend` repository. Always consult that file — do not hardcode credentials or assume role mappings.

## Password Access

All 17 test users share the same password, configured via the `SEED_USER_PASSWORD` environment variable:

- **Local development:** Set `SEED_USER_PASSWORD` in `.env.test`, then run `bash scripts/seed-local.sh` after `supabase db reset`.
- **CI / Cloud dev:** Set `SEED_USER_PASSWORD` in GitHub → Settings → Environments → `dev`.
- **Developers needing access:** Request the password from the team. It is stored as a GitHub Actions secret in both the `ww-backend` and `ww-website` repositories.

## Role Hierarchy and Website Feature Mapping

The seed data covers four distinct permission levels. Each level unlocks different website capabilities:

| Role | Example User | Website Capabilities |
|------|-------------|---------------------|
| **Platform Admin** (`ww_admin`) | `alice@ww.org` | Full platform access. Can see cross-org data. Admin tooling (if implemented). |
| **Organisation Manager** | `laura@ww.org`, `bob@ww.org` | View/edit org details. Add/remove org members. Create projects. **Upload Model** page visible. |
| **Project Admin** | `nancy@ww.org`, `oliver@ww.org` | Edit project details. Add/remove project members. Manage deployments within assigned projects. |
| **Project Member** | `mark@ww.org`, `carol@ww.org` | View-only access to assigned projects and their deployments, media, and observations. |
| **Unassigned Member** | `emma@ww.org`, `henry@ww.org` | Authenticated but no project assignments — sees empty My Data. |

### Feature Visibility by Role

| Website Feature | Platform Admin | Org Manager | Project Admin | Project Member | Unassigned |
|----------------|:-:|:-:|:-:|:-:|:-:|
| **Login / Logout** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **My Data → Projects tab** | All projects | Org projects | Assigned projects | Assigned projects | Empty |
| **My Data → Deployments tab** | All | Org deployments | Project deployments | Project deployments | Empty |
| **My Data → Map tab** | All locations | Org locations | Project locations | Project locations | Empty |
| **My Data → Reports tab** | All | Org data | Project data | Project data | Empty |
| **My Data → CamtrapDP Import** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Analyse Images** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Prepare SD Card (Manifest)** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Upload Model** (nav visible) | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Edit project details** | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Add/remove project members** | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Edit org details** | ✓ | ✓ | ✗ | ✗ | ✗ |

## Automated Validation Strategy

These seed users enable two tiers of automated testing against the dev Supabase instance.

### Tier 1: API-Level Role Validation (Backend)

Using `pytest` + the Supabase client, you can authenticate as each test user and verify that the API enforces role boundaries. These tests authenticate against the **real dev Supabase** (not mocks) and validate RLS policies end-to-end.

**What to validate:**

| Test Scenario | Login As | API Call | Expected Result |
|--------------|----------|----------|-----------------|
| Org manager sees own org projects | `laura@ww.org` | `GET /api/projects` | Returns Tiger Tracking, Bird Migration only |
| Org manager cannot see other org projects | `laura@ww.org` | `GET /api/projects` | Does NOT return Marine Life, Forest Patrol |
| Project member sees assigned project | `carol@ww.org` | `GET /api/projects` | Returns Tiger Tracking only |
| Project member cannot see unassigned project | `carol@ww.org` | `GET /api/projects` | Does NOT return Bird Migration |
| Unassigned user sees no projects | `emma@ww.org` | `GET /api/projects` | Returns empty list |
| Upload Model blocked for non-managers | `mark@ww.org` | `POST /api/models/convert` | Returns `403` |
| CamtrapDP import succeeds for any authenticated user | `carol@ww.org` | `POST /api/camtrapdp/import` | Returns `200` with valid ZIP |

**Implementation approach:**

```python
# tests/test_role_based_access.py (sketch)
import os
import pytest
from supabase import create_client

DEV_URL = os.environ["SUPABASE_URL"]
DEV_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SEED_PASSWORD = os.environ["SEED_USER_PASSWORD"]

def login_as(email: str):
    """Authenticate as a seed user and return an authed Supabase client."""
    client = create_client(DEV_URL, DEV_ANON_KEY)
    client.auth.sign_in_with_password({"email": email, "password": SEED_PASSWORD})
    return client

@pytest.mark.integration
def test_org_manager_sees_own_projects():
    client = login_as("laura@ww.org")
    projects = client.table("projects").select("name").execute()
    names = [p["name"] for p in projects.data]
    assert "Tiger Tracking Program" in names
    assert "Marine Life Documentation" not in names

@pytest.mark.integration
def test_unassigned_user_sees_no_projects():
    client = login_as("emma@ww.org")
    projects = client.table("projects").select("name").execute()
    assert projects.data == []
```

> [!WARNING]
> These integration tests require a running dev Supabase instance with seeded data. They should be tagged with `@pytest.mark.integration` and excluded from the standard CI pipeline (which uses mock env vars). Run them manually or in a dedicated CI job that targets the dev environment.

### Tier 2: Browser-Level UI Validation (Frontend)

Using Playwright or Cypress against `http://localhost:5173` (with the backend pointed at dev Supabase), you can validate UI-level access control:

**What to validate:**

| Test Scenario | Login As | Check |
|--------------|----------|-------|
| Upload Model nav item visible for managers | `bob@ww.org` | `Upload Model` link present in header nav |
| Upload Model nav item hidden for members | `mark@ww.org` | `Upload Model` link NOT in header nav |
| My Data shows correct project count | `carol@ww.org` | Projects tab shows exactly 1 project |
| My Data is empty for unassigned users | `emma@ww.org` | Projects tab shows "No projects" or empty state |
| Map tab shows pins only for visible deployments | `oliver@ww.org` | Map markers correspond to Marine Life Documentation only |
| Edit button visible for project admins | `nancy@ww.org` | Edit controls visible on Bird Migration Study |
| Edit button hidden for project members | `frank@ww.org` | Edit controls NOT visible on Bird Migration Study |

**Implementation approach:**

```typescript
// e2e/role-visibility.spec.ts (Playwright sketch)
import { test, expect } from '@playwright/test';

const SEED_PASSWORD = process.env.SEED_USER_PASSWORD!;

async function loginAs(page, email: string) {
  await page.goto('/login');
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', SEED_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('/my-data');
}

test('org manager sees Upload Model nav link', async ({ page }) => {
  await loginAs(page, 'bob@ww.org');
  await expect(page.locator('nav >> text=Upload Model')).toBeVisible();
});

test('project member does NOT see Upload Model nav link', async ({ page }) => {
  await loginAs(page, 'mark@ww.org');
  await expect(page.locator('nav >> text=Upload Model')).not.toBeVisible();
});

test('unassigned user sees empty projects', async ({ page }) => {
  await loginAs(page, 'emma@ww.org');
  await expect(page.locator('[data-testid="projects-list"]')).toBeEmpty();
});
```

> [!NOTE]
> Playwright tests require both the frontend dev server and the backend running locally, pointed at the dev Supabase instance. They are NOT part of the standard CI pipeline.

## Recommended Test Users by Scenario

For quick manual testing during feature development, use these users:

| I want to test… | Use this user | Why |
|-----------------|--------------|-----|
| Full admin capabilities | `alice@ww.org` | Platform admin (`ww_admin`) with cross-org visibility |
| Org management features | `laura@ww.org` | Org manager + project admin in Wildlife Research |
| Cross-org isolation | `oliver@ww.org` | Manager of Conservation Society — should NOT see Wildlife Research data |
| Project-scoped editing | `nancy@ww.org` | Project admin (Bird Migration) but only org member — cannot manage the org itself |
| Read-only project access | `mark@ww.org` | Project member — can view Tiger Tracking but cannot edit |
| Cross-org project membership | `carol@ww.org` | General org member assigned to a Wildlife Research project |
| Empty state / onboarding | `emma@ww.org` | Authenticated but unassigned — tests empty dashboards |
| CI/CD model uploads | `apps@wildlife.ai` | System manager account used by deployment pipelines |

## Multi-Tenant Isolation Quick Checks

The seed data creates 4 organisations and 4 projects specifically to test data isolation:

```
General                         Wildlife Research Institute
├── alice (ww_admin)            ├── laura (manager, Tiger admin)
├── bob (manager)               ├── mark (member, Tiger member)
├── carol → Tiger Tracking      ├── nancy (member, Bird admin)
├── frank → Bird Migration      │
├── david → Marine Life         Conservation Society
├── grace → Marine Life         ├── oliver (manager, Marine admin)
├── emma (unassigned)           ├── paula (member, Marine member)
├── henry (unassigned)          │
├── iris (unassigned)           Park Rangers Network
├── jack (unassigned)           ├── quinn (manager, Forest admin)
└── apps@wildlife.ai (manager)  └── rachel (member, Forest member)
```

When logged in as **Laura**, the RLS policies should ensure:
- ✅ Tiger Tracking Program and Bird Migration Study are visible
- ✅ Wildlife Research Institute org details are editable
- ❌ Marine Life Documentation is NOT visible
- ❌ Forest Patrol System is NOT visible
- ❌ Conservation Society org details are NOT accessible

## Adding New Test Users

If you need additional test personas:

1. Add the user to `ww-backend/supabase/seeds/dev/data.sql`
2. Update `ww-backend/supabase/seeds/USER-CREDENTIALS-REFERENCE.md` with the new user's details
3. Re-run `bash scripts/seed-local.sh` after `supabase db reset`
4. Update this document if the new user covers a new role or test scenario
