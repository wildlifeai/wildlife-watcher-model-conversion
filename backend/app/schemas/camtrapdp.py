"""
Pydantic schemas for CamtrapDP import/export operations.
"""

from typing import Any, Optional

from pydantic import BaseModel


class PendingDriveUpload(BaseModel):
    """A media file extracted from the zip that needs uploading to Google Drive."""

    filename: str
    mime_type: str
    file_bytes: bytes  # raw bytes — excluded from JSON serialisation
    media_id: str  # ww media UUID — used to patch file_path back to gdrive://<id>
    deployment_id: str
    deployment_start: Optional[str] = None
    deployment_end: Optional[str] = None
    location_name: Optional[str] = None
    project_id: str
    project_name: str

    model_config = {"arbitrary_types_allowed": True}


class CamtrapImportResult(BaseModel):
    project_id: str
    project_name: str
    deployments_imported: int
    media_imported: int
    observations_imported: int
    warnings: list[str]
    # Files inside the zip that need a Google Drive upload (stripped before
    # returning to the client — handled inside the router).
    pending_drive_uploads: list[PendingDriveUpload] = []
    drive_uploads: Optional[dict[str, Any]] = None  # summary after upload
    ai_job_id: Optional[str] = None  # set when run_ai enqueued a SpeciesNet/Brain job
