# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""iNaturalist domain — observation management and species identification.

Uses the iNaturalist API v1 (api.inaturalist.org) to:
  - Create observations with photos
  - Poll for community identifications
  - Fetch user profile info

All operations require a valid iNat access token (obtained via OAuth).
"""

from typing import Any, Dict, List, Optional

import httpx
import structlog

from app.services.inat_oauth import (
    INAT_API_BASE,
    get_api_jwt,
    get_user_token,
)

logger = structlog.get_logger()


class INatDomainError(Exception):
    """Raised on iNaturalist API operation failures."""

    pass


# ── User profile ─────────────────────────────────────────────────────


async def get_inat_user_profile(user_id: str) -> Dict[str, Any]:
    """Fetch the iNat profile for the connected user.

    Args:
        user_id: The Wildlife Watcher user UUID (looks up stored token).

    Returns:
        iNat user profile dict (login, name, icon, etc.).
    """
    token = await get_user_token(user_id)
    if not token:
        raise INatDomainError("Not connected to iNaturalist")

    api_jwt = await get_api_jwt(token["access_token"])

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{INAT_API_BASE}/users/me",
            headers={"Authorization": api_jwt},
        )

    if response.status_code != 200:
        raise INatDomainError("Failed to fetch iNat user profile")

    results = response.json().get("results", [])
    if not results:
        raise INatDomainError("No user profile returned")

    return results[0]


# ── Observation creation ─────────────────────────────────────────────


async def create_observation(
    user_id: str,
    species_guess: str,
    latitude: float,
    longitude: float,
    observed_on: str,
    description: Optional[str] = None,
    geoprivacy: str = "obscured",
) -> Dict[str, Any]:
    """Create a new iNaturalist observation.

    Args:
        user_id: Wildlife Watcher user UUID.
        species_guess: Initial species identification (from AI model).
        latitude: GPS latitude.
        longitude: GPS longitude.
        observed_on: ISO date string (YYYY-MM-DD).
        description: Optional observation notes.
        geoprivacy: 'open', 'obscured', or 'private'. Default 'obscured'.

    Returns:
        The created observation record from iNat.
    """
    token = await get_user_token(user_id)
    if not token:
        raise INatDomainError("Not connected to iNaturalist")

    api_jwt = await get_api_jwt(token["access_token"])

    observation_data = {
        "observation": {
            "species_guess": species_guess,
            "latitude": latitude,
            "longitude": longitude,
            "observed_on_string": observed_on,
            "geoprivacy": geoprivacy,
        }
    }

    if description:
        observation_data["observation"]["description"] = description

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{INAT_API_BASE}/observations",
            json=observation_data,
            headers={"Authorization": api_jwt},
        )

    if response.status_code not in (200, 201):
        logger.error(
            "inat_create_observation_failed",
            status=response.status_code,
            body=response.text[:500],
        )
        raise INatDomainError(f"Failed to create observation: {response.status_code}")

    result = response.json()
    logger.info("inat_observation_created", id=result.get("id"))
    return result


async def upload_observation_photo(
    user_id: str,
    observation_id: int,
    photo_bytes: bytes,
    filename: str = "photo.jpg",
) -> Dict[str, Any]:
    """Attach a photo to an existing iNat observation.

    Args:
        user_id: Wildlife Watcher user UUID.
        observation_id: The iNat observation ID.
        photo_bytes: Raw image bytes.
        filename: Original filename.

    Returns:
        The created photo record from iNat.
    """
    token = await get_user_token(user_id)
    if not token:
        raise INatDomainError("Not connected to iNaturalist")

    api_jwt = await get_api_jwt(token["access_token"])

    files = {
        "file": (filename, photo_bytes, "image/jpeg"),
    }
    data = {
        "observation_photo[observation_id]": str(observation_id),
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{INAT_API_BASE}/observation_photos",
            files=files,
            data=data,
            headers={"Authorization": api_jwt},
        )

    if response.status_code not in (200, 201):
        raise INatDomainError(f"Failed to upload photo: {response.status_code}")

    result = response.json()
    logger.info("inat_photo_uploaded", observation_id=observation_id)
    return result


# ── Observation polling ──────────────────────────────────────────────


async def get_observation_status(
    observation_id: int,
) -> Dict[str, Any]:
    """Fetch current status/identifications for an observation.

    This is a public endpoint — no auth required for public observations.

    Returns:
        Dict with quality_grade, community_taxon, identifications, etc.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{INAT_API_BASE}/observations/{observation_id}",
        )

    if response.status_code != 200:
        raise INatDomainError(f"Failed to fetch observation {observation_id}")

    data = response.json()
    results = data.get("results", [])
    if not results:
        raise INatDomainError(f"Observation {observation_id} not found")

    obs = results[0]

    return {
        "id": obs.get("id"),
        "quality_grade": obs.get("quality_grade"),
        "community_taxon": obs.get("community_taxon", {}).get("name") if obs.get("community_taxon") else None,
        "species_guess": obs.get("species_guess"),
        "identifications_count": obs.get("identifications_count", 0),
        "identifications": [
            {
                "taxon_name": ident.get("taxon", {}).get("name"),
                "taxon_rank": ident.get("taxon", {}).get("rank"),
                "user": ident.get("user", {}).get("login"),
                "category": ident.get("category"),
                "created_at": ident.get("created_at"),
            }
            for ident in obs.get("identifications", [])
        ],
        "observed_on": obs.get("observed_on"),
        "uri": obs.get("uri"),
    }


async def batch_poll_observations(
    observation_ids: List[int],
) -> List[Dict[str, Any]]:
    """Poll status for multiple observations at once.

    Uses the iNat batch endpoint for efficiency (up to 200 per request).
    """
    if not observation_ids:
        return []

    # iNat allows comma-separated IDs
    ids_str = ",".join(str(i) for i in observation_ids[:200])

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            f"{INAT_API_BASE}/observations",
            params={"id": ids_str, "per_page": 200},
        )

    if response.status_code != 200:
        raise INatDomainError("Failed to batch fetch observations")

    data = response.json()
    results = []

    for obs in data.get("results", []):
        results.append(
            {
                "id": obs.get("id"),
                "quality_grade": obs.get("quality_grade"),
                "community_taxon": obs.get("community_taxon", {}).get("name") if obs.get("community_taxon") else None,
                "species_guess": obs.get("species_guess"),
                "identifications_count": obs.get("identifications_count", 0),
                "uri": obs.get("uri"),
            }
        )

    return results


async def search_and_fetch_inat_taxon(scientific_name: str) -> Optional[Dict[str, Any]]:
    """Search for a taxon by scientific name and fetch its complete lineage.

    Returns a dictionary matching the `taxa` table schema, or None if not found
    or if the iNat API request fails.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        # Step 1: Search for the taxon ID
        search_res = await client.get(
            f"{INAT_API_BASE}/taxa/autocomplete",
            params={"q": scientific_name, "per_page": 1},
        )
        if search_res.status_code != 200 or not search_res.json().get("results"):
            return None

        taxon_id = search_res.json()["results"][0].get("id")
        if not taxon_id:
            return None

        # Step 2: Fetch the full taxon details
        detail_res = await client.get(f"{INAT_API_BASE}/taxa/{taxon_id}")
        if detail_res.status_code != 200 or not detail_res.json().get("results"):
            return None

        taxon = detail_res.json()["results"][0]

    rank = taxon.get("rank")
    allowed_ranks = {'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'subspecies'}
    if rank not in allowed_ranks:
        return None

    lineage = {
        "kingdom": None,
        "phylum": None,
        "class": None,
        "order_name": None,
        "family": None,
        "genus": None,
        "species": None
    }

    for ancestor in taxon.get("ancestors", []):
        a_rank = ancestor.get("rank")
        a_name = ancestor.get("name")
        if a_rank == "kingdom":
            lineage["kingdom"] = a_name
        elif a_rank == "phylum":
            lineage["phylum"] = a_name
        elif a_rank == "class":
            lineage["class"] = a_name
        elif a_rank == "order":
            lineage["order_name"] = a_name
        elif a_rank == "family":
            lineage["family"] = a_name
        elif a_rank == "genus":
            lineage["genus"] = a_name

    name = taxon.get("name")
    if rank == "kingdom":
        lineage["kingdom"] = name
    elif rank == "phylum":
        lineage["phylum"] = name
    elif rank == "class":
        lineage["class"] = name
    elif rank == "order":
        lineage["order_name"] = name
    elif rank == "family":
        lineage["family"] = name
    elif rank == "genus":
        lineage["genus"] = name
    elif rank in ("species", "subspecies"):
        lineage["species"] = name

    conservation_status = None
    cs_obj = taxon.get("conservation_status")
    if cs_obj and isinstance(cs_obj, dict):
        conservation_status = cs_obj.get("status")
    else:
        cs_list = taxon.get("conservation_statuses", [])
        if cs_list and isinstance(cs_list, list):
            conservation_status = cs_list[0].get("status")

    return {
        "scientific_name": name,
        "common_name": taxon.get("preferred_common_name") or taxon.get("name"),
        "rank": rank,
        "kingdom": lineage["kingdom"],
        "phylum": lineage["phylum"],
        "class": lineage["class"],
        "order_name": lineage["order_name"],
        "family": lineage["family"],
        "genus": lineage["genus"],
        "species": lineage["species"],
        "gbif_taxon_id": str(taxon.get("gbif_id")) if taxon.get("gbif_id") else None,
        "inat_taxon_id": str(taxon_id),
        "nzor_id": None,
        "conservation_status": conservation_status,
        "invasive_status": False,
    }
