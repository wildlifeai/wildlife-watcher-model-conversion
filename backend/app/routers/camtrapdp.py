"""
CamtrapDP router — HTTP endpoints for importing CamtrapDP packages.

POST /api/camtrapdp/import
  Accepts a multipart ZIP upload, parses it as a CamtrapDP v1.0 package,
  and inserts all data into the Wildlife Watcher database.
"""

import asyncio

import structlog
from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.dependencies import get_current_user, get_privileged_client, get_user_client
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
    user_client=Depends(get_user_client),
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

    # ── Register missing taxa ──────────────────────────────────────────
    unique_names = {
        obs.get("scientificName", "").strip() 
        for obs in pkg.observations 
        if obs.get("scientificName", "").strip()
    }

    if unique_names:
        def get_existing_taxa():
            return svc.table("taxa").select("scientific_name").in_("scientific_name", list(unique_names)).execute()

        try:
            existing_res = await asyncio.to_thread(get_existing_taxa)
            existing_names = {row["scientific_name"] for row in existing_res.data}
            missing_names = unique_names - existing_names

            from app.domain.inaturalist import search_and_fetch_inat_taxon

            for name in missing_names:
                try:
                    new_taxon = await search_and_fetch_inat_taxon(name)
                    if new_taxon:
                        resolved_name = new_taxon.get("scientific_name", "")
                        # iNat may resolve a synonym to a different accepted name that
                        # already exists in the DB (e.g. Anas strepera → Mareca strepera).
                        # Re-check with the resolved name to avoid a duplicate key error.
                        def check_resolved(rn=resolved_name):
                            return svc.table("taxa").select("scientific_name").eq("scientific_name", rn).limit(1).execute()
                        resolved_res = await asyncio.to_thread(check_resolved)
                        if resolved_res.data:
                            logger.info(
                                "camtrapdp_import_taxon_already_exists_as_synonym",
                                queried=name,
                                resolved=resolved_name,
                            )
                        else:
                            def insert_taxon(t=new_taxon):
                                return svc.table("taxa").insert(t).execute()
                            await asyncio.to_thread(insert_taxon)
                            logger.info(
                                "camtrapdp_import_registered_taxon",
                                name=name,
                                resolved=resolved_name,
                                inat_id=new_taxon.get("inat_taxon_id"),
                            )
                    else:
                        logger.warning("camtrapdp_import_taxon_not_found_on_inat", name=name)
                        pkg.warnings.append(f"Could not find a valid iNaturalist taxon for '{name}'.")
                except Exception as e:
                    logger.error("camtrapdp_import_taxon_insert_failed", name=name, error=str(e))
                    pkg.warnings.append(f"Failed to register taxon '{name}': {e}")
        except Exception as e:
            logger.error("camtrapdp_import_taxa_check_failed", error=str(e))
            pkg.warnings.append(f"Failed to verify existing taxa: {e}")

    # ── Run import (blocking I/O — run in thread) ──────────────────────
    try:
        result: CamtrapImportResult = await asyncio.to_thread(domain.import_package, pkg, user.id, org_id, svc, user_client)
    except Exception as exc:
        logger.error("camtrapdp_import_failed", error=str(exc))
        raise HTTPException(
            status_code=500,
            detail=f"Import failed: {exc}",
        ) from exc

    # ── Google Drive upload for zip-embedded images ────────────────────
    # Files with a public URL are already stored as-is. Only images that
    # were physically inside the zip need uploading to Drive.
    if result.pending_drive_uploads:
        from app.config import settings as app_settings
        if not app_settings.GOOGLE_DRIVE_ENABLED:
            result.warnings.append(
                f"{len(result.pending_drive_uploads)} image(s) found in zip but "
                "Google Drive upload is disabled (GOOGLE_DRIVE_ENABLED=false). "
                "Files stored with their original relative paths."
            )
        else:
            try:
                from app.services.google_drive import GoogleDriveService, sanitize_filename, slugify

                drive = GoogleDriveService()

                # Build the file list in the format upload_analysis_images expects
                drive_files = []
                for p in result.pending_drive_uploads:
                    dep_date = p.deployment_start[:10] if p.deployment_start else "unknown-date"
                    drive_files.append({
                        "file_bytes": p.file_bytes,
                        "filename": p.filename,
                        "timestamp": p.deployment_start,
                        "mime_type": p.mime_type,
                        "project": {"id": p.project_id, "name": p.project_name},
                        "deployment": {
                            "id": p.deployment_id,
                            "date": dep_date,
                            "location_name": p.location_name or "",
                        },
                        "_project_folder": f"{slugify(p.project_name)}_{p.project_id[:8]}",
                        "_deployment_folder": f"{dep_date}_{p.deployment_id[:8]}",
                        "drive_filename": sanitize_filename(p.deployment_start, p.filename),
                    })

                stats = await drive.upload_analysis_images(drive_files)
                result.drive_uploads = stats
                logger.info("camtrapdp_drive_upload_complete", **stats)

            except Exception as exc:
                logger.error("camtrapdp_drive_upload_failed", error=str(exc))
                result.warnings.append(f"Google Drive upload failed: {exc}")

    # Strip raw bytes before serialising the response
    result.pending_drive_uploads = []

    return ApiResponse(data=result.model_dump())
