from typing import Any, Dict, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies import get_current_user, get_user_client
from app.services.supabase_client import create_service_client

router = APIRouter(prefix="/api/deployments", tags=["deployments"])

class ValidateDeploymentsRequest(BaseModel):
    deployment_ids: List[str]

@router.post("/validate")
async def validate_deployments(
    request: ValidateDeploymentsRequest,
    user: Any = Depends(get_current_user),
    user_client: Any = Depends(get_user_client)
) -> Dict[str, str]:
    """
    Given a list of deployment IDs (or 8-char prefixes), determine their state:
    - 'valid': exists and user has access
    - 'no_access': exists but user does not belong to project
    - 'not_found': does not exist
    """
    if not request.deployment_ids:
        return {}

    results = {dep_id: "not_found" for dep_id in request.deployment_ids}

    admin_client = create_service_client()

    full_uuids = [d for d in request.deployment_ids if len(d) > 8]
    prefixes = [d for d in request.deployment_ids if len(d) == 8]

    user_found_ids = set()
    admin_found_ids = set()

    # 1. Check full UUIDs
    if full_uuids:
        # Admin check
        try:
            admin_res = admin_client.table("deployments").select("id").in_("id", full_uuids).execute()
            admin_found_ids.update(r["id"].lower() for r in admin_res.data)
        except Exception:
            pass

        # User check
        try:
            user_res = user_client.table("deployments").select("id").in_("id", full_uuids).execute()
            user_found_ids.update(r["id"].lower() for r in user_res.data)
        except Exception:
            pass

    # 2. Check prefixes
    if prefixes:
        for prefix in prefixes:
            # Admin check
            try:
                admin_res = admin_client.table("deployments").select("id").ilike("id", f"{prefix}%").limit(1).execute()
                if admin_res.data:
                    admin_found_ids.add(prefix.lower())
            except Exception:
                pass

            # User check
            try:
                user_res = user_client.table("deployments").select("id").ilike("id", f"{prefix}%").limit(1).execute()
                if user_res.data:
                    user_found_ids.add(prefix.lower())
            except Exception:
                pass

    # 3. Compile results
    for dep_id in request.deployment_ids:
        lower_id = dep_id.lower()
        if lower_id in user_found_ids:
            results[dep_id] = "valid"
        elif lower_id in admin_found_ids:
            results[dep_id] = "no_access"
        else:
            results[dep_id] = "not_found"

    return results


@router.post("/backfill-timezones")
async def backfill_timezones(
    user: Any = Depends(get_current_user),
) -> Dict[str, int]:
    """Resolve and persist ``deployments.timezone`` for deployments that lack it.

    Idempotent maintenance task: for every deployment with coordinates but no
    timezone, derive the IANA zone from latitude/longitude (timezonefinder) and
    store it so the UI can render capture times in local time. Run once after the
    timezone column is deployed; new CamtrapDP imports populate it automatically.
    """
    from app.domain.photo_preprocessing import resolve_timezone

    svc = create_service_client()
    rows = (
        svc.table("deployments")
        .select("id, latitude, longitude, timezone")
        .is_("timezone", "null")
        .not_.is_("latitude", "null")
        .not_.is_("longitude", "null")
        .execute()
        .data
        or []
    )
    updated = 0
    for dep in rows:
        tz = resolve_timezone(dep.get("latitude"), dep.get("longitude"))
        if not tz:
            continue
        svc.table("deployments").update({"timezone": tz}).eq("id", dep["id"]).execute()
        updated += 1
    return {"candidates": len(rows), "updated": updated}
