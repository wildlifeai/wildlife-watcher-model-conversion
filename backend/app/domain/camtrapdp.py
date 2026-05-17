"""
CamtrapDP import domain — pure business logic, no HTTP imports.

Parses a CamtrapDP v1.0 ZIP package and inserts the data into the
Wildlife Watcher database, creating a new project and placeholder
devices for each unique camera in the package.
"""

import csv
import io
import json
import uuid
import zipfile
from dataclasses import dataclass, field
from typing import Optional

import structlog

from app.schemas.camtrapdp import CamtrapImportResult

logger = structlog.get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# In-memory parsed representation
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class CamtrapPackage:
    metadata: dict
    deployments: list[dict] = field(default_factory=list)
    media: list[dict] = field(default_factory=list)
    observations: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Parsing
# ─────────────────────────────────────────────────────────────────────────────


def parse_zip(zip_bytes: bytes) -> CamtrapPackage:
    """
    Unzip a CamtrapDP package in-memory and parse all CSVs.
    Raises ValueError for invalid packages.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as exc:
        raise ValueError("Uploaded file is not a valid ZIP archive.") from exc

    names = zf.namelist()

    # Locate datapackage.json (may be at root or inside a folder)
    dp_path = next((n for n in names if n.endswith("datapackage.json")), None)
    if not dp_path:
        raise ValueError("No datapackage.json found in the ZIP. Is this a CamtrapDP package?")

    metadata = json.loads(zf.read(dp_path).decode("utf-8"))

    # Determine base directory (in case files are inside a folder)
    base = dp_path.replace("datapackage.json", "")

    def read_csv(filename: str) -> list[dict]:
        path = base + filename
        if path not in names:
            # Try without subfolder
            flat = next((n for n in names if n.endswith(filename)), None)
            if not flat:
                return []
            path = flat
        content = zf.read(path).decode("utf-8-sig")  # strip BOM if present
        reader = csv.DictReader(io.StringIO(content))
        return [row for row in reader]

    pkg = CamtrapPackage(metadata=metadata)
    pkg.deployments = read_csv("deployments.csv")
    pkg.media = read_csv("media.csv")
    pkg.observations = read_csv("observations.csv")

    if not pkg.deployments:
        pkg.warnings.append("deployments.csv is empty or missing.")

    return pkg


def validate_package(pkg: CamtrapPackage) -> list[str]:
    """Light validation — returns warnings (not errors) for missing optional fields."""
    warnings: list[str] = []

    required_dep_cols = {"deploymentID", "deploymentStart"}
    if pkg.deployments:
        missing = required_dep_cols - set(pkg.deployments[0].keys())
        if missing:
            warnings.append(f"deployments.csv is missing columns: {', '.join(missing)}")

    # Check GPS coverage
    no_gps = sum(
        1 for d in pkg.deployments
        if not d.get("latitude") or not d.get("longitude")
    )
    if no_gps:
        warnings.append(
            f"{no_gps} of {len(pkg.deployments)} deployment(s) have no GPS coordinates "
            "and will not appear on the map."
        )

    return warnings


# ─────────────────────────────────────────────────────────────────────────────
# Import
# ─────────────────────────────────────────────────────────────────────────────


def _str(val: Optional[str]) -> Optional[str]:
    """Convert empty CSV strings to None."""
    if val is None:
        return None
    stripped = val.strip()
    return stripped if stripped else None


def _float(val: Optional[str]) -> Optional[float]:
    try:
        return float(val) if val and val.strip() else None
    except (ValueError, TypeError):
        return None


def _int(val: Optional[str]) -> Optional[int]:
    try:
        return int(val) if val and val.strip() else None
    except (ValueError, TypeError):
        return None


# CamtrapDP v1.0 vocab → WW check-constraint vocab mapping
_BAIT_USE_MAP = {
    "none": "none", "scent": "scent", "food": "food",
    "visual": "visual", "acoustic": "acoustic", "other": "other",
    # CamtrapDP uses boolean-style values
    "false": "none", "true": "other",
}

_FEATURE_TYPE_MAP = {
    "roadTrail": "roadTrail", "waterSource": "waterSource",
    "burrow": "burrow", "nestSite": "nestSite", "other": "other",
    # CamtrapDP additional values → best-fit WW mapping
    "trailGame": "roadTrail", "trailHiking": "roadTrail",
    "road": "roadTrail", "culvert": "other", "bridge": "other",
}


def _map_bait_use(val: Optional[str]) -> Optional[str]:
    s = _str(val)
    if s is None:
        return None
    return _BAIT_USE_MAP.get(s, "other")


def _map_feature_type(val: Optional[str]) -> Optional[str]:
    s = _str(val)
    if s is None:
        return None
    return _FEATURE_TYPE_MAP.get(s, "other")


def import_package(
    pkg: CamtrapPackage,
    user_id: str,
    org_id: str,
    svc,  # Supabase service-role client
) -> CamtrapImportResult:
    """
    Insert a parsed CamtrapDP package into the WW database.

    Strategy:
    1. Create a new project from the package title.
    2. For each unique cameraID, create a placeholder device named
       "[imported] <cameraID>" linked to the user's organisation.
    3. Insert deployments, media, and observations.

    All operations use the service-role client (RLS bypassed).
    Auth check is done in the router before calling this function.
    """
    warnings: list[str] = list(pkg.warnings)
    meta = pkg.metadata

    project_title = (
        meta.get("title")
        or meta.get("name")
        or "Imported CamtrapDP Dataset"
    )
    project_description = meta.get("description") or ""

    # ── 1. Create project ──────────────────────────────────────────────
    project_id = str(uuid.uuid4())
    svc.table("projects").insert({
        "id": project_id,
        "name": project_title,
        "description": project_description,
        "organisation_id": org_id,
        "modified_by": user_id,
    }).execute()

    # Add the importing user as a project admin
    svc.table("user_roles").insert({
        "user_id": user_id,
        "scope_type": "project",
        "scope_id": project_id,
        "role": "project_admin",
        "modified_by": user_id,
    }).execute()

    logger.info("camtrapdp_import_project_created", project_id=project_id, title=project_title)

    # ── 2. Create placeholder devices per unique cameraID ──────────────
    camera_ids = {
        d.get("cameraID", "").strip()
        for d in pkg.deployments
        if d.get("cameraID", "").strip()
    }

    device_map: dict[str, str] = {}  # cameraID → ww device UUID

    for camera_id in camera_ids:
        device_uuid = str(uuid.uuid4())
        device_name = f"[imported] {camera_id}"[:100]  # truncate if needed
        try:
            svc.table("devices").insert({
                "id": device_uuid,
                "name": device_name,
                "organisation_id": org_id,
                "modified_by": user_id,
                # bluetooth_id is NOT NULL in WW schema; generate a stable
                # placeholder so imported cameras don't conflict with real devices.
                "bluetooth_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"imported-{device_name}")),
            }).execute()
            device_map[camera_id] = device_uuid
        except Exception as e:
            warnings.append(f"Could not create placeholder device for camera '{camera_id}': {e}")

    logger.info("camtrapdp_import_devices_created", count=len(device_map))

    # ── 3. Insert deployments ──────────────────────────────────────────
    dep_id_map: dict[str, str] = {}  # camtrapDP deploymentID → ww UUID
    deps_inserted = 0

    for dep in pkg.deployments:
        cdp_id = dep.get("deploymentID", "").strip()
        if not cdp_id:
            warnings.append("Skipped a deployment row with no deploymentID.")
            continue

        dep_start = _str(dep.get("deploymentStart"))
        if not dep_start:
            warnings.append(f"Deployment '{cdp_id}' has no deploymentStart — skipped.")
            continue

        camera_id = dep.get("cameraID", "").strip()
        device_uuid = device_map.get(camera_id)

        if not device_uuid:
            # Create on-the-fly if missing
            device_uuid = str(uuid.uuid4())
            try:
                fallback_name = f"[imported] {camera_id or 'unknown'}"[:100]
                svc.table("devices").insert({
                    "id": device_uuid,
                    "name": fallback_name,
                    "organisation_id": org_id,
                    "modified_by": user_id,
                    "bluetooth_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"imported-{fallback_name}")),
                }).execute()
                device_map[camera_id] = device_uuid
            except Exception as e:
                warnings.append(f"Could not create device for deployment '{cdp_id}': {e}")
                continue

        ww_id = str(uuid.uuid4())
        dep_id_map[cdp_id] = ww_id

        row = {
            "id": ww_id,
            "project_id": project_id,
            "device_id": device_uuid,
            "setup_by": user_id,
            "name": _str(dep.get("locationName")) or cdp_id,
            "location_name": _str(dep.get("locationName")) or cdp_id,
            "deployment_start": dep_start,
            "deployment_end": _str(dep.get("deploymentEnd")),
            "latitude": _float(dep.get("latitude")),
            "longitude": _float(dep.get("longitude")),
            "accuracy": _float(dep.get("coordinateUncertainty")),
            "camera_height": _float(dep.get("cameraHeight")),
            "camera_tilt": _float(dep.get("cameraTilt")),
            "camera_model": _str(dep.get("cameraModel")),
            "bait_use": _map_bait_use(dep.get("baitUse")),
            "feature_type": _map_feature_type(dep.get("featureType")),
            "habitat": _str(dep.get("habitat")) or _str(dep.get("habitatType")),
            "detection_distance": _float(dep.get("detectionDistance")),
            "start_deployment_comments": _str(dep.get("deploymentComments")),
        }
        # Remove None values to let DB defaults apply
        row = {k: v for k, v in row.items() if v is not None}

        try:
            svc.table("deployments").insert(row).execute()
            deps_inserted += 1
        except Exception as e:
            # Fail-fast on first deployment error so misconfiguration is caught immediately
            raise RuntimeError(
                f"Failed to insert deployment '{cdp_id}': {e}\n"
                "Hint: check that the deployments table exists in your target project "
                "and all required columns are present."
            ) from e

    logger.info("camtrapdp_import_deployments", inserted=deps_inserted)

    # ── 4. Insert media ────────────────────────────────────────────────
    media_id_map: dict[str, str] = {}  # camtrapDP mediaID → ww UUID
    media_inserted = 0

    for m in pkg.media:
        cdp_dep_id = m.get("deploymentID", "").strip()
        ww_dep_id = dep_id_map.get(cdp_dep_id)
        if not ww_dep_id:
            continue  # deployment was skipped

        cdp_media_id = m.get("mediaID", "").strip()
        file_path = _str(m.get("filePath")) or ""
        file_name = _str(m.get("fileName")) or file_path.split("/")[-1] or "unknown"
        mime = _str(m.get("fileMediatype")) or "image/jpeg"

        ww_id = str(uuid.uuid4())
        if cdp_media_id:
            media_id_map[cdp_media_id] = ww_id

        row = {
            "id": ww_id,
            "deployment_id": ww_dep_id,
            "file_path": file_path,
            "file_name": file_name,
            "file_mediatype": mime,
            "timestamp": _str(m.get("timestamp")),
            "favorite": m.get("favorite", "").lower() == "true",
            "media_comments": _str(m.get("mediaComments")),
        }
        row = {k: v for k, v in row.items() if v is not None}

        try:
            svc.table("media").insert(row).execute()
            media_inserted += 1
        except Exception as e:
            warnings.append(f"Failed to insert media '{cdp_media_id}': {e}")

    logger.info("camtrapdp_import_media", inserted=media_inserted)

    # ── 5. Insert observations ─────────────────────────────────────────
    obs_inserted = 0

    for o in pkg.observations:
        cdp_dep_id = o.get("deploymentID", "").strip()
        ww_dep_id = dep_id_map.get(cdp_dep_id)
        if not ww_dep_id:
            continue

        cdp_media_id = o.get("mediaID", "").strip()
        ww_media_id = media_id_map.get(cdp_media_id) if cdp_media_id else None

        obs_type = _str(o.get("observationType"))
        valid_obs_types = {"animal", "human", "vehicle", "blank", "unknown"}
        if obs_type and obs_type not in valid_obs_types:
            obs_type = "unknown"

        life_stage = _str(o.get("lifeStage"))
        valid_life_stages = {"adult", "subadult", "juvenile", "hatchling", "unknown"}
        if life_stage and life_stage not in valid_life_stages:
            life_stage = None

        sex = _str(o.get("sex"))
        valid_sexes = {"male", "female", "unknown"}
        if sex and sex not in valid_sexes:
            sex = None

        cls_method = _str(o.get("classificationMethod"))
        valid_cls = {"human", "machine"}
        if cls_method and cls_method not in valid_cls:
            cls_method = None

        row = {
            "id": str(uuid.uuid4()),
            "deployment_id": ww_dep_id,
            "media_id": ww_media_id,
            "event_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, o.get("eventID", ""))) if _str(o.get("eventID")) else None,
            "observation_level": _str(o.get("observationLevel")),
            "observation_type": obs_type,
            "scientific_name": _str(o.get("scientificName")),
            "count": _int(o.get("count")),
            "life_stage": life_stage,
            "sex": sex,
            "behavior": _str(o.get("behavior")),
            "individual_id": _str(o.get("individualID")),
            "classification_method": cls_method,
            "classified_by": _str(o.get("classifiedBy")),
            "classification_probability": _float(o.get("classificationProbability")),
            "gbif_taxon_key": _int(o.get("taxonID")),
            "observation_comments": _str(o.get("observationComments")),
        }
        row = {k: v for k, v in row.items() if v is not None}

        try:
            svc.table("observations").insert(row).execute()
            obs_inserted += 1
        except Exception as e:
            warnings.append(f"Failed to insert observation: {e}")

    logger.info(
        "camtrapdp_import_complete",
        project_id=project_id,
        deployments=deps_inserted,
        media=media_inserted,
        observations=obs_inserted,
    )

    return CamtrapImportResult(
        project_id=project_id,
        project_name=project_title,
        deployments_imported=deps_inserted,
        media_imported=media_inserted,
        observations_imported=obs_inserted,
        warnings=warnings,
    )
