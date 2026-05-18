# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Media resolver — pluggable storage backend for serving media files.

Resolves a media ``file_path`` to raw image bytes by dispatching to the
appropriate storage provider based on the path prefix.

Supported providers (extensible via ``RESOLVERS`` dict):

- ``https://`` / ``http://`` — Public URL, fetched directly
- ``gdrive://`` — Google Drive file ID, fetched via service account
- ``supabase://`` — Supabase Storage bucket/path (placeholder)
- ``s3://`` — AWS S3 bucket/key (placeholder)
- Relative paths — unresolved local files (returns None)

To add a new provider, implement an async function matching the
``Resolver`` signature and register it in the ``RESOLVERS`` dict.
"""

from typing import Callable, Coroutine, Optional, Tuple

import httpx
import structlog

logger = structlog.get_logger()

# Type alias for a resolver function
# Takes the path (without prefix) and returns (bytes, content_type) or None
Resolver = Callable[[str], Coroutine[None, None, Optional[Tuple[bytes, str]]]]


# ── Provider implementations ────────────────────────────────────────


async def _resolve_public_url(url: str) -> Optional[Tuple[bytes, str]]:
    """Fetch an image from a public HTTP(S) URL."""
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning("media_resolve_http_error", url=url, status=resp.status_code)
                return None
            content_type = resp.headers.get("content-type", "image/jpeg")
            return resp.content, content_type
    except Exception as exc:
        logger.warning("media_resolve_http_failed", url=url, error=str(exc))
        return None


async def _resolve_gdrive(file_id: str) -> Optional[Tuple[bytes, str]]:
    """Fetch an image from Google Drive using the service account."""
    try:
        from app.services.google_drive import GoogleDriveService

        svc = GoogleDriveService()
        # Use the Drive API to download file content
        import asyncio

        def _download():
            request = svc._service.files().get_media(fileId=file_id)
            import io

            from googleapiclient.http import MediaIoBaseDownload

            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return buffer.getvalue()

        content = await asyncio.to_thread(_download)
        return content, "image/jpeg"
    except Exception as exc:
        logger.warning("media_resolve_gdrive_failed", file_id=file_id, error=str(exc))
        return None


async def _resolve_supabase(path: str) -> Optional[Tuple[bytes, str]]:
    """Placeholder for Supabase Storage resolution."""
    # Future: download from Supabase Storage bucket
    logger.info("media_resolve_supabase_not_implemented", path=path)
    return None


async def _resolve_s3(path: str) -> Optional[Tuple[bytes, str]]:
    """Placeholder for AWS S3 resolution."""
    # Future: download from S3 using boto3
    logger.info("media_resolve_s3_not_implemented", path=path)
    return None


# ── Resolver registry ───────────────────────────────────────────────

# Maps prefix → (strip_prefix, resolver_fn)
# If strip_prefix is True, the prefix is removed before passing to the resolver
RESOLVERS: dict[str, tuple[bool, Resolver]] = {
    "https://": (False, _resolve_public_url),
    "http://": (False, _resolve_public_url),
    "gdrive://": (True, _resolve_gdrive),
    "supabase://": (True, _resolve_supabase),
    "s3://": (True, _resolve_s3),
}


async def resolve_media(file_path: str) -> Optional[Tuple[bytes, str]]:
    """Resolve a file_path to (bytes, content_type) using the appropriate provider.

    Returns None if the path cannot be resolved (e.g. local relative path
    with no matching provider).
    """
    if not file_path:
        return None

    for prefix, (strip, resolver) in RESOLVERS.items():
        if file_path.startswith(prefix):
            key = file_path[len(prefix):] if strip else file_path
            return await resolver(key)

    # No matching prefix — unresolvable local path
    logger.debug("media_resolve_no_provider", file_path=file_path)
    return None
