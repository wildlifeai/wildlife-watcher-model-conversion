# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pydantic schemas for the Wildlife Brain (DINOv3 embeddings / clustering)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class EmbedRequest(BaseModel):
    """Request to embed + cluster a deployment.

    ``mode='server'`` enqueues a GPU embedding job. ``mode='client_vectors'``
    accepts vectors computed in-browser (WebGPU); HDBSCAN/UMAP still run server-side.
    """

    mode: Literal["server", "client_vectors"] = "server"
    model_name: Optional[str] = Field(None, description="Embedding variant (defaults to server config)")
    media_ids: Optional[list[str]] = Field(None, description="client_vectors: media ids aligned with vectors")
    vectors: Optional[list[list[float]]] = Field(None, description="client_vectors: 1280-d vectors")


class ConfirmClusterRequest(BaseModel):
    """Confirm an HDBSCAN cluster as a taxon (bulk-labels its member media)."""

    taxon_id: Optional[str] = Field(None, description="Taxon UUID (preferred)")
    scientific_name: Optional[str] = Field(None, description="Denormalised name when taxon_id unknown")
    vernacular_name: Optional[str] = None


class ReprocessRequest(BaseModel):
    """Re-embed a deployment/project with an (optional) different model."""

    model_name: Optional[str] = Field(None, description="Embedding variant (defaults to server config)")


class ReprocessAllRequest(BaseModel):
    """Platform-wide re-embed. Dry-run (default) returns a cost estimate only."""

    model_name: Optional[str] = None
    dry_run: bool = Field(True, description="Estimate cost without executing")
    confirm: bool = Field(False, description="Must be true to actually run a global re-embed")


class ReviewDecisionRequest(BaseModel):
    """A reviewer's decision on a single media item (Review Queue)."""

    decision: Literal["approve", "reassign", "expert"] = "approve"
    scientific_name: Optional[str] = Field(None, description="Confirmed species (AI label for approve; new name for reassign)")
    vernacular_name: Optional[str] = None
    taxon_id: Optional[str] = None
