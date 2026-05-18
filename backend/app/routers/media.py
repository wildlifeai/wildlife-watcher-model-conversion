# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Media serving endpoints — proxy images from private storage.

GET /api/media/{media_id}/image?size=thumb → low-res thumbnail (grid)
GET /api/media/{media_id}/image?size=full  → full resolution (detail panel)
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.dependencies import get_current_user
from app.domain.media_resolver import resolve_media
from app.services import supabase_client

router = APIRouter(prefix="/api/media", tags=["media"])


@router.get("/{media_id}/image")
async def get_media_image(
    media_id: str,
    size: Literal["thumb", "full"] = Query("thumb", description="Image size: thumb (grid) or full (detail)"),
    user=Depends(get_current_user),
):
    """Serve a media image by resolving its file_path through the provider registry.

    - ``size=thumb``: fast low-res preview for the thumbnail grid
    - ``size=full``: high-res download for the detail panel (on-demand)

    Uses the authenticated user's Supabase client so RLS enforces
    project membership — users can only view media they have access to.
    """
    client = supabase_client.create_anon_client()

    result = client.table("media").select("file_path").eq("id", media_id).maybe_single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Media record not found")

    file_path = result.data.get("file_path", "")

    resolved = await resolve_media(file_path, size=size)
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail={
                "message": "Image not available — the file path cannot be resolved to a hosted image.",
                "file_path": file_path,
                "suggestions": [
                    "Upload the original images via the Upload Data page.",
                    "Update the media record's file_path with a public URL (https://...).",
                    "If stored in Google Drive, prefix with gdrive:// followed by the file ID.",
                ],
            },
        )

    image_bytes, content_type = resolved
    # Thumbnails cache longer (10min), full-res shorter (5min) since they're on-demand
    cache_ttl = 600 if size == "thumb" else 300
    return Response(
        content=image_bytes,
        media_type=content_type,
        headers={"Cache-Control": f"private, max-age={cache_ttl}"},
    )
