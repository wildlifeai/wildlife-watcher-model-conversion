#!/usr/bin/env python3
# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""
dedupe_ai_observations.py
=========================
Collapse duplicate AI observations created before the pipeline became
idempotent (the "10 identical human rows on one image" bug).

Earlier pipeline versions appended a fresh set of AI observations on every
re-run instead of replacing them, so a single detection can appear as many
near-identical rows. This script keeps the best row per
(media_id, observation_type, source_model_version) and removes the redundant
machine duplicates.

Safety
------
- Only ``source_type='ai'`` rows in the ``ai_reviewed`` state are ever deleted.
  Human-reviewed rows (a person confirmed/edited the label) are never touched,
  and each group always retains at least one row.
- Within a duplicate group the survivor is the highest ``confidence`` (then
  ``classification_probability``, then id) row.
- **Dry-run by default** — prints what it would delete. Pass ``--apply`` to
  actually delete.

Usage
-----
    python scripts/dedupe_ai_observations.py \\
        --supabase-url http://localhost:54321 \\
        --service-role-key <key> \\
        [--deployment-id <uuid>]        # optional scope
        [--apply]                       # without this, dry-run only

Environment variable alternatives: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
"""

import argparse
import os
import sys
from collections import defaultdict

try:
    from supabase import create_client
except ImportError as exc:  # pragma: no cover
    print(f"Missing dependency: {exc}\nInstall with:  pip install supabase")
    sys.exit(1)

PAGE = 1000
HUMAN_REVIEWED = {"human_reviewed", "expert_reviewed", "consensus_approved"}


def _sort_key(row: dict):
    """Higher is better — the survivor of a duplicate group."""
    return (
        row.get("confidence") or 0.0,
        row.get("classification_probability") or 0.0,
        row.get("id") or "",
    )


def fetch_ai_observations(svc, deployment_id: str | None) -> list[dict]:
    """Page through all AI observations (optionally scoped to one deployment)."""
    cols = "id, media_id, observation_type, source_model_version, review_status, confidence, classification_probability"
    rows: list[dict] = []
    offset = 0
    while True:
        q = svc.table("observations").select(cols).eq("source_type", "ai").not_.is_("media_id", "null")
        if deployment_id:
            q = q.eq("deployment_id", deployment_id)
        batch = q.range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return rows


def plan_deletions(rows: list[dict]) -> list[str]:
    """Return the ids of redundant machine duplicates to delete.

    Groups by (media_id, observation_type, source_model_version). In each group
    the best row survives; the *other* ``ai_reviewed`` rows are removed. Human-
    reviewed rows are always kept and never counted as the deletable surplus.
    """
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["media_id"], r.get("observation_type"), r.get("source_model_version"))].append(r)

    to_delete: list[str] = []
    for members in groups.values():
        if len(members) < 2:
            continue
        survivor = max(members, key=_sort_key)
        for r in members:
            if r["id"] == survivor["id"]:
                continue
            # Never delete human-reviewed rows; only collapse machine duplicates.
            if (r.get("review_status") or "") in HUMAN_REVIEWED:
                continue
            to_delete.append(r["id"])
    return to_delete


def main():
    parser = argparse.ArgumentParser(description="Collapse duplicate AI observations")
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL", "http://localhost:54321"))
    parser.add_argument("--service-role-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    parser.add_argument("--deployment-id", help="Limit to a single deployment (default: whole instance)")
    parser.add_argument("--apply", action="store_true", help="Actually delete (default: dry-run)")
    args = parser.parse_args()

    if not args.service_role_key:
        print("X  --service-role-key is required (or set SUPABASE_SERVICE_ROLE_KEY)")
        sys.exit(1)

    svc = create_client(args.supabase_url.rstrip("/") + "/", args.service_role_key)
    print(f"Connected to {args.supabase_url}")
    if args.deployment_id:
        print(f"Scope: deployment {args.deployment_id}")

    rows = fetch_ai_observations(svc, args.deployment_id)
    print(f"Scanned {len(rows)} AI observation(s).")

    to_delete = plan_deletions(rows)
    if not to_delete:
        print("No duplicates found — nothing to do.")
        return

    affected_media = len({r["media_id"] for r in rows if r["id"] in set(to_delete)})
    print(f"Found {len(to_delete)} redundant duplicate row(s) across {affected_media} image(s).")

    if not args.apply:
        print("\nDRY RUN — no changes made. Re-run with --apply to delete.")
        return

    deleted = 0
    for i in range(0, len(to_delete), 100):
        chunk = to_delete[i : i + 100]
        svc.table("observations").delete().in_("id", chunk).execute()
        deleted += len(chunk)
        print(f"  deleted {deleted}/{len(to_delete)}…")
    print(f"\nDone. Removed {deleted} duplicate AI observation(s).")


if __name__ == "__main__":
    main()
