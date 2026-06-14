# Wildlife Watcher v4 — Cost Model

> **Status:** 🕰️ Historical snapshot — point-in-time design/roadmap; **not** kept current with the code.

What the embedding/intelligence stack costs at scale. **Originals stay in Google
Drive (free, 100 TB)** — the costs below are only the small derivatives, vectors,
and one-off GPU embedding.

Assumptions: DINOv3 ViT-H/16+ ≈ 75 ms/image on an A100 (~$3/hr, one-off embed);
Supabase Storage for renditions + Qdrant snapshots; Qdrant self-hosted (infra
only); 1280-d float32 vectors ≈ 5.1 KB each (+ payload/index overhead ≈ 6.4 GB/1M).

| Scale | Renditions (Supabase) | Qdrant vectors | GPU (1× embed) | Est. total /month |
|-------|----------------------|----------------|----------------|-------------------|
| 10K images | ~0.3 GB | ~64 MB | ~$0.02 one-off | ~$25–30 |
| 100K images | ~3 GB | ~0.64 GB | ~$6 one-off | ~$35–50 |
| 1M images | ~30 GB | ~6.4 GB | ~$63 one-off | ~$80–120 |
| 10M images | ~300 GB | ~64 GB (Qdrant Cloud) | ~$630 one-off | ~$300–500 |

Notes:
- **Renditions** = thumbnail (~30 KB) + preview (~120 KB) + animal crop (~60 KB) ≈ ~210 KB/image in the public `media-renditions` bucket. The 10M row uses ~2 TB if all three are kept; prune previews/crops for cold deployments to control this.
- **GPU** is a one-off per embed; amortised over the deployment's lifetime. Reprocessing (DINOv3 → DINOv4) repeats it — use `POST /api/brain/reprocess/all` (dry-run) to estimate before executing. The estimate uses `estimate_embedding_cost()` (75 ms/image, $3/hr).
- **Qdrant DR**: daily snapshot → private `qdrant-backups` Supabase bucket, 7-day retention (~7× the vector size). Qdrant is fully rebuildable from Drive + Supabase, so this is convenience, not the source of truth.
- **Local (WebGPU) embedding** shifts GPU cost to the user's device (ViT-S/16+), at $0 server GPU for those runs.

This table replaces the roadmap's Azure-based figures — v4 is consolidated on Supabase Storage + Google Drive (no Azure object storage; Azure is GPU compute only).
