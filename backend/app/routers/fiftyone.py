# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""FiftyOne integration router — thin HTTP layer.

Provides endpoints for syncing deployments to FiftyOne datasets,
writing back annotations, and launching the FiftyOne App for visual review.

All heavy lifting is delegated to services/fiftyone_service.py.
"""

import structlog
from fastapi import APIRouter, Depends, Request

from app.dependencies import get_current_user
from app.schemas.common import ApiError, ApiMeta, ApiResponse
from app.services.fiftyone_service import (
    launch_fiftyone_session,
    sync_deployment_to_fiftyone,
    writeback_annotations,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/api/fiftyone", tags=["fiftyone"])


@router.post("/sync/{deployment_id}")
async def sync_to_fiftyone(
    request: Request,
    deployment_id: str,
    overwrite: bool = True,
    user=Depends(get_current_user),
):
    """Sync a deployment's media and observations to a FiftyOne dataset.

    Creates an ephemeral FiftyOne dataset with all media as samples
    and observations mapped to Detection labels with bounding boxes.

    Requires authentication. FiftyOne must be installed.
    """
    req_id = getattr(request.state, "request_id", None)

    try:
        result = await sync_deployment_to_fiftyone(
            deployment_id=deployment_id,
            overwrite=overwrite,
        )
        return ApiResponse(data=result, meta=ApiMeta(request_id=req_id))
    except RuntimeError as e:
        # FiftyOne not installed
        return ApiResponse(
            error=ApiError(
                code="FIFTYONE_NOT_AVAILABLE",
                message=str(e),
            ),
            meta=ApiMeta(request_id=req_id),
        )
    except Exception as e:
        logger.error("fiftyone_sync_error", error=str(e), deployment_id=deployment_id)
        return ApiResponse(
            error=ApiError(
                code="FIFTYONE_SYNC_ERROR",
                message=f"FiftyOne sync failed: {e}",
                retryable=True,
            ),
            meta=ApiMeta(request_id=req_id),
        )


@router.post("/writeback/{deployment_id}")
async def writeback_to_supabase(
    request: Request,
    deployment_id: str,
    dataset_name: str | None = None,
    user=Depends(get_current_user),
):
    """Write human annotations from FiftyOne back to Supabase.

    Scans the FiftyOne dataset for relabeled or reviewed detections
    and updates the corresponding observation rows in the database.

    Requires authentication.
    """
    req_id = getattr(request.state, "request_id", None)
    ds_name = dataset_name or f"ww-{deployment_id[:8]}"

    try:
        result = await writeback_annotations(
            dataset_name=ds_name,
            deployment_id=deployment_id,
            user_id=user.id,
        )
        return ApiResponse(data=result, meta=ApiMeta(request_id=req_id))
    except RuntimeError as e:
        return ApiResponse(
            error=ApiError(code="FIFTYONE_NOT_AVAILABLE", message=str(e)),
            meta=ApiMeta(request_id=req_id),
        )
    except ValueError as e:
        return ApiResponse(
            error=ApiError(code="DATASET_NOT_FOUND", message=str(e)),
            meta=ApiMeta(request_id=req_id),
        )
    except Exception as e:
        logger.error("fiftyone_writeback_error", error=str(e), deployment_id=deployment_id)
        return ApiResponse(
            error=ApiError(
                code="FIFTYONE_WRITEBACK_ERROR",
                message=f"Writeback failed: {e}",
                retryable=True,
            ),
            meta=ApiMeta(request_id=req_id),
        )


@router.post("/launch/{deployment_id}")
async def launch_session(
    request: Request,
    deployment_id: str,
    port: int = 5151,
    user=Depends(get_current_user),
):
    """Launch a FiftyOne App session for reviewing a deployment.

    Syncs the deployment data to an ephemeral FiftyOne dataset and
    starts the FiftyOne App server. Returns the session URL.

    Requires authentication. FiftyOne must be installed.
    """
    req_id = getattr(request.state, "request_id", None)

    try:
        result = await launch_fiftyone_session(
            deployment_id=deployment_id,
            port=port,
            remote=True,
        )
        if result.get("error"):
            return ApiResponse(
                error=ApiError(code="NO_MEDIA", message=result["error"]),
                meta=ApiMeta(request_id=req_id),
            )
        return ApiResponse(data=result, meta=ApiMeta(request_id=req_id))
    except RuntimeError as e:
        return ApiResponse(
            error=ApiError(code="FIFTYONE_NOT_AVAILABLE", message=str(e)),
            meta=ApiMeta(request_id=req_id),
        )
    except Exception as e:
        logger.error("fiftyone_launch_error", error=str(e), deployment_id=deployment_id)
        return ApiResponse(
            error=ApiError(
                code="FIFTYONE_LAUNCH_ERROR",
                message=f"FiftyOne launch failed: {e}",
                retryable=True,
            ),
            meta=ApiMeta(request_id=req_id),
        )
