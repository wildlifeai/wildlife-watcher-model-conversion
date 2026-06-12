---

name: ww-website-agent
description: >
Essential workflow, repository awareness, and architecture rules for any agent interacting with the
Wildlife Watcher website. Read and follow this skill before making frontend, backend, API,
infrastructure, or documentation changes.
-----------------------------------------

# Wildlife Watcher Website Agent

The `ww-website` repository is a multi-service platform consisting of:

* React + Vite frontend
* Python FastAPI backend
* Shared Supabase data layer
* Image analysis and AI tooling
* LoRaWAN telemetry ingestion
* Firmware and manifest management workflows

> **Canonical Documentation**
>
> Always consult the relevant documentation before making assumptions:
>
> * `readme.md`
> * `documentation/onboarding/02-CODEBASE-GUIDE.md`
> * `documentation/onboarding/03-DATA-AND-SYNC.md`
> * `documentation/resources/api-reference.md`
> * `documentation/resources/deployment-guide.md`
> * `documentation/resources/lorawan-webhook-setup.md`
> * `documentation/development reports/v2-architecture-plan.md`
> * `.agents/DESIGN.md` — design system (colors, typography, spacing, component patterns) for any UI work or screen generation
>
> This skill defines architectural guardrails and decision rules. Detailed implementation guidance belongs in documentation.

---

# 1. Critical Invariants

These rules are non-negotiable.

## Database Ownership Invariant

The website does not own the database schema.

All database schema changes must originate in:

```text
ww-backend/supabase/schemas/
```

Never:

* Create tables from this repository
* Modify columns from this repository
* Create database functions from this repository
* Treat this repository as the source of truth for schema

If a schema change is required:

1. Make the change in `ww-backend`
2. Follow the backend schema workflow
3. Update this repository only after the schema exists

---

## Backend Architecture Invariant

The backend follows strict layer separation:

```text
routers/
    ↓
domain/
    ↓
services/
```

### Routers

Responsibilities:

* Validate requests
* Call domain logic
* Return responses

May import:

* FastAPI
* Schemas
* Domain modules
* Dependencies

### Domain

Responsibilities:

* Business logic
* Workflow orchestration
* Validation beyond request schemas

May import:

* Schemas
* Services
* Registries

Must not import:

* FastAPI
* Request objects
* Response objects
* HTTP-specific code

### Services

Responsibilities:

* Infrastructure integration
* External APIs
* Supabase
* Azure
* Google Drive
* Model conversion tools

Never place business logic in routers.

Never import FastAPI inside domain modules.

---

## Security Invariant

Treat the service-role key as backend-only infrastructure.

Never:

* Expose `SUPABASE_SERVICE_ROLE_KEY` to frontend code
* Store secrets in source control
* Use service-role access in browser code
* Bypass authentication dependencies

Frontend code must only use anonymous or authenticated user tokens.

---

## Documentation Invariant

When behavior changes:

* Update the relevant documentation
* Keep documentation and implementation synchronized
* Update route documentation when routes change
* Update API documentation when contracts change

Do not create duplicate documentation when existing documentation can be updated.

---

# 2. Repository Ecosystem Awareness

Before making changes, consider downstream impacts.

| System                            | Relationship                                 |
| --------------------------------- | -------------------------------------------- |
| `ww-website`                      | Website frontend and backend                 |
| `ww-backend`                      | Database schema source of truth              |
| `wildlife-watcher-mobile-app`     | Shares the same Supabase database            |
| `Seeed_Grove_Vision_AI_Module_V2` | Owns EXIF output and LoRaWAN payload formats |
| `ww-hardware`                     | Owns CONFIG.TXT firmware expectations        |

---

# 3. Cross-Repository Ownership Rules

Before changing any shared contract, identify the owning repository.

| Concern                               | Owner             |
| ------------------------------------- | ----------------- |
| Database schema                       | `ww-backend`      |
| EXIF metadata format                  | Firmware          |
| LoRaWAN payload format                | Firmware          |
| CONFIG.TXT structure                  | `ww-hardware`     |
| Shared storage usage                  | Backend ecosystem |
| Shared deployment/device/project data | Backend ecosystem |

Do not modify externally-owned contracts without coordination.

---

# 4. Frontend Architecture Rules

Preferred flow:

```text
pages
  ↓
components
  ↓
hooks
  ↓
apiClient
```

Rules:

* Use `apiClient` for backend communication
* Use TanStack Query for server state
* Keep route components thin
* Prefer reusable components
* Prefer hooks for complex state management
* Avoid direct `fetch()` calls when `apiClient` already provides the functionality
* Avoid duplicating API response parsing logic

Frontend should focus on presentation and user interaction rather than business logic.

---

# 5. Environment Rules

Environment configuration is centralized.

Rules:

* Root `.env` is shared by frontend and backend
* Do not create `frontend/.env.local`
* Do not commit `.env`
* Do not commit credentials
* All backend environment variables must be defined in `backend/app/config.py`

The application should fail fast when required configuration is missing.

---

# 6. Feature Flag Rules

Experimental or incomplete features should be gated.

When adding a feature that is:

* Experimental
* Incomplete
* Environment-specific
* Under active development

Create a feature flag in:

```text
backend/app/config.py
```

and gate registration appropriately.

Do not expose unfinished functionality by default.

---

# 7. Async Job System Rules

## Current State

The current implementation uses:

* In-memory job storage
* In-memory caching
* Background asyncio tasks
* Supabase persistence

Redis and ARQ are not currently guaranteed to exist.

## Future Target

Target architecture:

```text
Client
  ↓
API
  ↓
Redis Queue
  ↓
ARQ Worker
  ↓
Result
```

Until migration is complete:

* Do not assume Redis exists
* Do not assume ARQ exists
* Verify actual implementation before introducing dependencies
* Maintain compatibility with the current job system

Treat `documentation/development reports/v2-architecture-plan.md` as a roadmap, not a description of current behavior.

---

# 8. Known Architectural Gotchas

## user_roles Uses scope_id

Do not assume:

```text
organisation_id
```

exists on `user_roles`.

The table uses:

```text
scope_id
scope_type
```

Always verify schema details in `ww-backend`.

---

## API Responses Use a Standard Envelope

Backend responses follow:

```json
{
  "data": {},
  "error": null,
  "meta": {}
}
```

Frontend code should expect and preserve this structure.

Do not invent alternate response formats.

---

## Verify Schema Before Writing Queries

Never guess:

* Table names
* Column names
* Constraints

Verify against the actual backend schema before writing queries.

---

## Shared Model Lists

Do not invent model names.

Reuse existing model registries and constants rather than duplicating configuration.

---

## Shared Test Users

Do not hardcode credentials.

Consult the backend seed documentation when test users are required.

---

# 9. Validation Requirements

Before committing:

## Backend Changes

Run:

* Ruff linting
* Ruff formatting
* Pytest

## Frontend Changes

Run:

* ESLint
* TypeScript validation
* Production build if applicable

## General

Verify:

* Documentation is updated
* Feature flags are respected
* Shared contracts remain compatible
* No secrets were introduced

Do not commit changes that fail validation.

---

# 10. Development Principles

Prefer:

* Thin routers
* Small domain functions
* Reusable components
* Strong typing
* Explicit validation
* Real API testing

Avoid:

* Business logic in routers
* Duplicated logic
* Hardcoded configuration
* Architecture assumptions
* Unverified schema assumptions

---

# Agent Self-Check

Before making a change, verify:

### Database

* Am I avoiding schema changes in this repository?
* Have I checked ownership of the affected data model?

### Backend

* Am I respecting `routers → domain → services`?
* Have I avoided HTTP imports in domain code?

### Frontend

* Am I using existing hooks and apiClient abstractions?
* Am I avoiding duplicated API logic?

### Security

* Am I keeping service-role access backend-only?
* Have I avoided exposing secrets?

### Documentation

* Does documentation need updating?
* Have I updated it alongside the code?

### Validation

* Have I run the appropriate tests and linting?

If any answer is "no", stop and correct the issue before proceeding.
