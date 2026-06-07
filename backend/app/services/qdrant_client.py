# Copyright (c) 2026
# SPDX-License-Identifier: GPL-3.0-or-later
"""Qdrant vector-store adapter — infrastructure layer for the Wildlife Brain.

Owns the ``media_embeddings`` collection: bootstrap, upsert, similarity search,
vector retrieval, count/health, and snapshots (Phase 5.5 disaster recovery).

Design notes (per the backend agent skill — services do infra only, no business
logic, no FastAPI):

- The ``qdrant_client`` dependency is imported **lazily** inside methods so this
  module (and anything importing it) loads even where qdrant-client isn't
  installed (e.g. the lean API image, or before ``pip install``). The pure
  helpers below have no third-party imports and are unit-testable without a
  running Qdrant.
- Collection geometry (dim, distance, HNSW params) and the payload shape come
  from ``registries.embedding_registry`` so server and client never disagree.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence

import structlog

from app.config import settings
from app.registries.embedding_registry import (
    EMBEDDING_DIM,
    QDRANT_HNSW_EF_CONSTRUCT,
    QDRANT_HNSW_M,
)

logger = structlog.get_logger()


# ── Pure helpers (no qdrant_client import — unit-testable) ────────────


@dataclass(frozen=True)
class SimilarPoint:
    """A single nearest-neighbour result."""

    id: str
    score: float
    payload: dict[str, Any]


def validate_vector_dim(vector: Sequence[float], expected: int = EMBEDDING_DIM) -> None:
    """Ensure a vector has the expected dimensionality.

    Guards the shared 1280-d space — both server (ViT-H) and WebGPU client
    (ViT-S) vectors must match before they touch the collection.

    Raises:
        ValueError: if the length differs from ``expected``.
    """
    n = len(vector)
    if n != expected:
        raise ValueError(f"Embedding dim mismatch: got {n}, expected {expected}")


def validate_vectors(vectors: Sequence[Sequence[float]], expected: int = EMBEDDING_DIM) -> None:
    """Validate a batch of vectors (see :func:`validate_vector_dim`)."""
    for i, v in enumerate(vectors):
        if len(v) != expected:
            raise ValueError(f"Embedding dim mismatch at index {i}: got {len(v)}, expected {expected}")


def build_match_conditions(**fields: Any) -> dict[str, Any]:
    """Build an equality-filter spec, dropping ``None`` values.

    Returns a plain ``{field: value}`` dict (translated to a Qdrant filter inside
    :meth:`QdrantService.search`). Kept pure so filter construction is testable.
    """
    return {k: v for k, v in fields.items() if v is not None}


def build_payload(
    *,
    deployment_id: str,
    embedding_run_id: str,
    org_id: Optional[str] = None,
    taxon_id: Optional[str] = None,
    cluster_id: Optional[int] = None,
    review_status: Optional[str] = None,
) -> dict[str, Any]:
    """Canonical Qdrant point payload (matches the ww-backend schema comment).

    Only non-null fields are stored. ``deployment_id`` and ``embedding_run_id``
    are always present so vectors are traceable and scopeable.
    """
    payload: dict[str, Any] = {"deployment_id": deployment_id, "embedding_run_id": embedding_run_id}
    if org_id is not None:
        payload["org_id"] = org_id
    if taxon_id is not None:
        payload["taxon_id"] = taxon_id
    if cluster_id is not None:
        payload["cluster_id"] = cluster_id
    if review_status is not None:
        payload["review_status"] = review_status
    return payload


# ── Service ──────────────────────────────────────────────────────────


class QdrantService:
    """Async adapter over a Qdrant collection of DINOv3 vectors."""

    def __init__(
        self,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        collection: Optional[str] = None,
        dim: Optional[int] = None,
    ) -> None:
        self._url = url or settings.QDRANT_URL
        self._api_key = api_key or settings.QDRANT_API_KEY or None
        self.collection = collection or settings.QDRANT_COLLECTION
        self.dim = dim or EMBEDDING_DIM  # per-variant (1280 ViT-H, 384 ViT-S)
        self._client = None  # lazily constructed AsyncQdrantClient

    def _get_client(self):
        if self._client is None:
            from qdrant_client import AsyncQdrantClient

            self._client = AsyncQdrantClient(url=self._url, api_key=self._api_key)
        return self._client

    async def ensure_collection(self) -> bool:
        """Create the collection if it does not exist. Returns True if created."""
        from qdrant_client import models

        client = self._get_client()
        if await client.collection_exists(self.collection):
            return False

        await client.create_collection(
            collection_name=self.collection,
            vectors_config=models.VectorParams(size=self.dim, distance=models.Distance.COSINE),
            hnsw_config=models.HnswConfigDiff(m=QDRANT_HNSW_M, ef_construct=QDRANT_HNSW_EF_CONSTRUCT),
        )
        logger.info("qdrant_collection_created", collection=self.collection, dim=self.dim)
        return True

    async def upsert(
        self,
        ids: Sequence[str],
        vectors: Sequence[Sequence[float]],
        payloads: Sequence[dict[str, Any]],
    ) -> int:
        """Upsert points (id + 1280-d vector + payload). Returns the count written."""
        if not (len(ids) == len(vectors) == len(payloads)):
            raise ValueError(f"ids/vectors/payloads length mismatch: {len(ids)}/{len(vectors)}/{len(payloads)}")
        validate_vectors(vectors, self.dim)

        from qdrant_client import models

        client = self._get_client()
        points = [models.PointStruct(id=pid, vector=list(vec), payload=payload) for pid, vec, payload in zip(ids, vectors, payloads)]
        await client.upsert(collection_name=self.collection, points=points, wait=True)
        logger.debug("qdrant_upserted", collection=self.collection, count=len(points))
        return len(points)

    async def search(
        self,
        vector: Sequence[float],
        limit: int = 20,
        conditions: Optional[dict[str, Any]] = None,
    ) -> list[SimilarPoint]:
        """Nearest-neighbour search, optionally filtered by payload equality."""
        validate_vector_dim(vector, self.dim)

        from qdrant_client import models

        client = self._get_client()
        query_filter = None
        if conditions:
            query_filter = models.Filter(must=[models.FieldCondition(key=k, match=models.MatchValue(value=v)) for k, v in conditions.items()])

        results = await client.search(
            collection_name=self.collection,
            query_vector=list(vector),
            limit=limit,
            query_filter=query_filter,
            with_payload=True,
        )
        return [SimilarPoint(id=str(p.id), score=float(p.score), payload=p.payload or {}) for p in results]

    async def retrieve_vector(self, point_id: str) -> Optional[list[float]]:
        """Fetch a stored vector by point id (for 'find similar to media X')."""
        client = self._get_client()
        records = await client.retrieve(
            collection_name=self.collection,
            ids=[point_id],
            with_vectors=True,
            with_payload=False,
        )
        if not records:
            return None
        return records[0].vector

    async def delete(self, ids: Sequence[str]) -> None:
        """Delete points by id (e.g. when media is hard-deleted)."""
        from qdrant_client import models

        client = self._get_client()
        await client.delete(
            collection_name=self.collection,
            points_selector=models.PointIdsList(points=list(ids)),
            wait=True,
        )

    async def count(self) -> int:
        """Exact vector count in the collection."""
        client = self._get_client()
        result = await client.count(collection_name=self.collection, exact=True)
        return result.count

    async def create_snapshot(self) -> Optional[str]:
        """Create a Qdrant snapshot of the collection (Phase 5.5 DR). Returns its name."""
        client = self._get_client()
        info = await client.create_snapshot(collection_name=self.collection)
        name = getattr(info, "name", None)
        logger.info("qdrant_snapshot_created", collection=self.collection, snapshot=name)
        return name

    async def health(self) -> dict[str, Any]:
        """Lightweight health probe for the admin page."""
        try:
            return {"status": "ok", "collection": self.collection, "vectors": await self.count()}
        except Exception as exc:  # noqa: BLE001 — health must never raise
            logger.warning("qdrant_health_failed", error=str(exc))
            return {"status": "error", "collection": self.collection, "error": str(exc)}

    async def close(self) -> None:
        """Close the underlying client (if constructed)."""
        if self._client is not None:
            await self._client.close()
            self._client = None


# Per-collection service cache (each variant has its own collection + dim).
_services: dict[str, QdrantService] = {}


def get_qdrant_service(model_name: Optional[str] = None) -> QdrantService:
    """Return a QdrantService for a variant's collection + dim.

    No ``model_name`` → the default (server / ViT-H, ``settings.QDRANT_COLLECTION``,
    1280-d). Otherwise the variant's collection + dim from the embedding registry
    (e.g. ViT-S → ``media_embeddings_vits`` @ 384-d).
    """
    if model_name is None:
        collection, dim = settings.QDRANT_COLLECTION, EMBEDDING_DIM
    else:
        from app.registries.embedding_registry import get_collection, get_embedding_dim

        collection, dim = get_collection(model_name), get_embedding_dim(model_name)

    svc = _services.get(collection)
    if svc is None:
        svc = QdrantService(collection=collection, dim=dim)
        _services[collection] = svc
    return svc
