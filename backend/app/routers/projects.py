# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Project endpoints — user-facing project creation (e.g. from the upload flow)."""

import asyncio
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.authz import assert_project_admin
from app.dependencies import get_verified_user, require_not_demo
from app.domain.soft_delete import now_iso, restore_project, soft_delete_project
from app.services.supabase_client import create_service_client

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None


@router.post("")
async def create_project(
    body: CreateProjectRequest,
    user: Any = Depends(get_verified_user),
) -> Dict[str, Any]:
    """Create a project in the caller's organisation.

    The caller becomes ``project_admin`` automatically via the ``handle_new_project`` DB trigger
    (which reads ``created_by``), mirroring the CamtrapDP import. Requires the user to belong to
    an organisation. ``get_verified_user`` blocks the demo/unverified accounts.
    """
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Project name is required.")

    def _create() -> Dict[str, Any]:
        svc = create_service_client()
        # Resolve the user's primary organisation (user_roles uses scope_id + scope_type).
        org_res = svc.table("user_roles").select("scope_id").eq("user_id", user.id).eq("scope_type", "organisation").limit(1).execute()
        if not org_res.data:
            raise HTTPException(status_code=403, detail="You must belong to an organisation to create a project.")
        org_id = org_res.data[0]["scope_id"]

        project_id = str(uuid.uuid4())
        svc.table("projects").insert(
            {
                "id": project_id,
                "name": name,
                "description": body.description or "",
                "organisation_id": org_id,
                "created_by": user.id,
                "modified_by": user.id,
            }
        ).execute()
        return {"id": project_id, "name": name, "organisation_id": org_id}

    return await asyncio.to_thread(_create)


class RestoreProjectRequest(BaseModel):
    deleted_at: str


@router.delete("/{project_id}", dependencies=[Depends(require_not_demo)])
async def delete_project(project_id: str, user: Any = Depends(get_verified_user)) -> Dict[str, Any]:
    """Soft-delete a project and cascade to its deployments → media → observations.

    Admin-only: requires ``project_admin`` on the project (or org-manager / system). A member or
    viewer is refused (404). Returns the shared ``deleted_at`` so the client can offer an Undo.
    """
    await assert_project_admin(user.id, project_id)
    ts = now_iso()
    await asyncio.to_thread(lambda: soft_delete_project(create_service_client(), project_id, ts))
    return {"id": project_id, "deleted_at": ts}


@router.post("/{project_id}/restore", dependencies=[Depends(require_not_demo)])
async def restore_project_endpoint(
    project_id: str,
    body: RestoreProjectRequest,
    user: Any = Depends(get_verified_user),
) -> Dict[str, Any]:
    """Undo a project delete — clears ``deleted_at`` (== the given timestamp) on the project and the
    deployments/media/observations that were deleted with it."""
    await assert_project_admin(user.id, project_id)
    await asyncio.to_thread(lambda: restore_project(create_service_client(), project_id, body.deleted_at))
    return {"id": project_id, "restored": True}
