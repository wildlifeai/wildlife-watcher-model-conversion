"""
CamtrapDP router — HTTP endpoints for importing CamtrapDP packages.

POST /api/camtrapdp/import
  Accepts a multipart ZIP upload, parses it as a CamtrapDP v1.0 package,
  and inserts all data into the Wildlife Watcher database.
"""

import asyncio

import structlog
from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.dependencies import get_current_user, get_privileged_client
from app.domain import camtrapdp as domain
from app.schemas.camtrapdp import CamtrapImportResult
from app.schemas.common import ApiResponse

logger = structlog.get_logger()

router = APIRouter(prefix="/api/camtrapdp", tags=["camtrapdp"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


@router.post("/import", response_model=ApiResponse)
async def import_camtrapdp(
    file: UploadFile,
    user=Depends(get_current_user),
    svc=Depends(get_privileged_client),
):
    """
    Import a CamtrapDP v1.0 ZIP package.

    Creates a new project, placeholder devices for each unique cameraID,
    and inserts all deployments, media, and observations from the package.

    The authenticated user becomes project admin of the new project.
    Placeholder devices are named '[imported] <cameraID>' and are linked
    to the user's primary organisation.
    """
    # ── Validate upload ────────────────────────────────────────────────
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted.")

    if file.size and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // 1_048_576} MB limit.",
        )
    zip_bytes = await file.read()
    if len(zip_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // 1_048_576} MB limit.",
        )

    # ── Resolve user's primary organisation ───────────────────────────
    # Remember: user_roles uses scope_id (not organisation_id) + scope_type
    org_response = await asyncio.to_thread(
        lambda: svc.table("user_roles").select("scope_id, role").eq("user_id", user.id).eq("scope_type", "organisation").limit(1).execute()
    )

    if not org_response.data:
        raise HTTPException(
            status_code=403,
            detail="You must belong to an organisation to import data.",
        )

    org_id = org_response.data[0]["scope_id"]

    # ── Parse ZIP ──────────────────────────────────────────────────────
    try:
        pkg = await asyncio.to_thread(domain.parse_zip, zip_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Light validation (adds warnings, does not block)
    pkg.warnings.extend(domain.validate_package(pkg))

    logger.info(
        "camtrapdp_import_started",
        user_id=user.id,
        org_id=org_id,
        filename=file.filename,
        deployments=len(pkg.deployments),
        media=len(pkg.media),
        observations=len(pkg.observations),
    )

    # ── Run import (blocking I/O — run in thread) ──────────────────────
    try:
        result: CamtrapImportResult = await asyncio.to_thread(domain.import_package, pkg, user.id, org_id, svc)
    except Exception as exc:
        logger.error("camtrapdp_import_failed", error=str(exc))
        raise HTTPException(
            status_code=500,
            detail=f"Import failed: {exc}",
        ) from exc

    return ApiResponse(data=result.model_dump())
