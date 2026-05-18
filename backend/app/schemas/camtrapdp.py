"""
Pydantic schemas for CamtrapDP import/export operations.
"""

from pydantic import BaseModel


class CamtrapImportResult(BaseModel):
    project_id: str
    project_name: str
    deployments_imported: int
    media_imported: int
    observations_imported: int
    warnings: list[str]
