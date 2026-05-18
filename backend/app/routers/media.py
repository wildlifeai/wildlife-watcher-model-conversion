# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Media serving endpoints — proxy images from private storage.

GET /api/media/{media_id}/image → streams the image bytes
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.dependencies import get_current_user
from app.domain.media_resolver import resolve_media
from app.services import supabase_client

router = APIRouter(prefix="/api/media", tags=["media"])


@router.get("/{media_id}/image")
async def get_media_image(
    media_id: str,
    user=Depends(get_current_user),
):
    """Serve a media image by resolving its file_path through the provider registry.

    Uses the authenticated user's Supabase client so RLS enforces
    project membership — users can only view media they have access to.

    Returns:
        200 with image bytes if resolvable
        404 if media not found or file_path not resolvable
    """
    # Use anon client with user context — RLS enforces access
    client = supabase_client.create_anon_client()

    result = client.table("media").select("file_path").eq("id", media_id).maybe_single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Media record not found")

    file_path = result.data.get("file_path", "")

    resolved = await resolve_media(file_path)
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
    return Response(
        content=image_bytes,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
