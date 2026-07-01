# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Soft-delete cascade + restore helpers (photos → deployments → projects).

All operations set/clear ``deleted_at`` — nothing is hard-deleted, so every delete is reversible.
A single shared timestamp ``ts`` scopes one delete operation: restoring by that exact ``ts`` reverses
only that delete and never resurrects rows that were already deleted earlier. Cascade order mirrors
the ops cleanup script (observations → media → deployments → project).

Callers pass a service-role client (the endpoint runs the access guard first) and run these inside
``asyncio.to_thread`` — they're synchronous Supabase calls.
"""

from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Delete ───────────────────────────────────────────────────────────────────


def soft_delete_deployments(svc, dep_ids: list[str], ts: str) -> None:
    """Soft-delete deployments and everything under them (media + observations)."""
    if not dep_ids:
        return
    svc.table("observations").update({"deleted_at": ts}).in_("deployment_id", dep_ids).is_("deleted_at", "null").execute()
    svc.table("media").update({"deleted_at": ts}).in_("deployment_id", dep_ids).is_("deleted_at", "null").execute()
    svc.table("deployments").update({"deleted_at": ts}).in_("id", dep_ids).is_("deleted_at", "null").execute()


def soft_delete_project(svc, project_id: str, ts: str) -> None:
    """Soft-delete a project and its whole tree (deployments → media → observations)."""
    resp = svc.table("deployments").select("id").eq("project_id", project_id).is_("deleted_at", "null").execute()
    dep_ids = [r["id"] for r in (resp.data or [])]
    soft_delete_deployments(svc, dep_ids, ts)
    svc.table("projects").update({"deleted_at": ts}).eq("id", project_id).is_("deleted_at", "null").execute()


# ── Restore (undo) — scoped to the exact delete timestamp ────────────────────


def restore_deployments(svc, dep_ids: list[str], ts: str) -> None:
    if not dep_ids:
        return
    svc.table("observations").update({"deleted_at": None}).in_("deployment_id", dep_ids).eq("deleted_at", ts).execute()
    svc.table("media").update({"deleted_at": None}).in_("deployment_id", dep_ids).eq("deleted_at", ts).execute()
    svc.table("deployments").update({"deleted_at": None}).in_("id", dep_ids).eq("deleted_at", ts).execute()


def restore_project(svc, project_id: str, ts: str) -> None:
    # Only the deployments that were deleted as part of *this* project delete (deleted_at == ts).
    resp = svc.table("deployments").select("id").eq("project_id", project_id).eq("deleted_at", ts).execute()
    dep_ids = [r["id"] for r in (resp.data or [])]
    restore_deployments(svc, dep_ids, ts)
    svc.table("projects").update({"deleted_at": None}).eq("id", project_id).eq("deleted_at", ts).execute()
