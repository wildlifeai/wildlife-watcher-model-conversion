#!/usr/bin/env python3
"""
seed_camtrapdp_example.py
=========================
Downloads the official CamtrapDP MICA example dataset and imports it
into a local (or remote) Wildlife Watcher Supabase instance.

This gives you real Belgian/Netherlands deployment locations and species
observations (Vulpes vulpes, Rattus norvegicus, etc.) to test the
Map and Reports tabs immediately.

Usage
-----
    python scripts/seed_camtrapdp_example.py \\
        --supabase-url  http://localhost:54321 \\
        --service-role-key <local-service-role-key> \\
        --user-email    alice.smith@wildlife-research.org

The --user-email must already exist in the target Supabase instance.
For local dev, use any email from ww-backend/supabase/seeds/USER-CREDENTIALS-REFERENCE.md

Requirements
------------
    pip install supabase requests

Environment variable alternative (avoids passing secrets as flags):
    SUPABASE_URL            — overrides --supabase-url
    SUPABASE_SERVICE_ROLE_KEY — overrides --service-role-key
"""

import argparse
import io
import os
import sys
import zipfile

# Try to import dependencies, give friendly error if missing
try:
    import requests
    from supabase import create_client
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with:  pip install supabase requests")
    sys.exit(1)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from app.domain.camtrapdp import import_package, parse_zip, validate_package  # noqa: E402

# ─────────────────────────────────────────────────────────────────────────────
# Official MICA example — released under CC0 by INBO
# Source: https://camtrap-dp.tdwg.org/example/
# ─────────────────────────────────────────────────────────────────────────────
EXAMPLE_URLS = [
    "https://github.com/tdwg/camtrap-dp/raw/1.0/example/datapackage.json",
    "https://github.com/tdwg/camtrap-dp/raw/1.0/example/deployments.csv",
    "https://github.com/tdwg/camtrap-dp/raw/1.0/example/media.csv",
    "https://github.com/tdwg/camtrap-dp/raw/1.0/example/observations.csv",
]


def download_as_zip() -> bytes:
    """Downloads the MICA example files and bundles them into an in-memory ZIP."""
    print("⬇  Downloading MICA example dataset from GitHub…")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for url in EXAMPLE_URLS:
            filename = url.split("/")[-1]
            print(f"   {filename}")
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            zf.writestr(filename, r.content)
    buf.seek(0)
    print("✓  Download complete")
    return buf.read()


def resolve_user(svc, email: str) -> tuple[str, str]:
    """Return (user_id, org_id) for the given email."""
    # Look up user by email in auth.users via service role
    resp = svc.auth.admin.list_users()
    user = next((u for u in resp if u.email == email), None)
    if not user:
        print(f"✗  User '{email}' not found. Check the email and try again.")
        sys.exit(1)

    # Get their org via user_roles (remember: scope_id, not organisation_id)
    roles = svc.table("user_roles") \
        .select("scope_id") \
        .eq("user_id", user.id) \
        .eq("scope_type", "organisation") \
        .limit(1) \
        .execute()

    if not roles.data:
        print(f"✗  User '{email}' has no organisation. Assign them to one first.")
        sys.exit(1)

    return user.id, roles.data[0]["scope_id"]


def main():
    parser = argparse.ArgumentParser(description="Seed CamtrapDP MICA example into Wildlife Watcher")
    parser.add_argument("--supabase-url", default=os.getenv("SUPABASE_URL", "http://localhost:54321"))
    parser.add_argument("--service-role-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    parser.add_argument("--user-email", required=True, help="Email of user who will own the imported project")
    parser.add_argument("--local-zip", help="Path to a local CamtrapDP ZIP (skip download)")
    args = parser.parse_args()

    if not args.service_role_key:
        print("✗  --service-role-key is required (or set SUPABASE_SERVICE_ROLE_KEY)")
        sys.exit(1)

    # ── Connect ────────────────────────────────────────────────────────
    url = args.supabase_url.rstrip("/") + "/"
    svc = create_client(url, args.service_role_key)
    print(f"🔌 Connected to {args.supabase_url}")

    # ── Resolve user + org ─────────────────────────────────────────────
    user_id, org_id = resolve_user(svc, args.user_email)
    print(f"👤 User  : {args.user_email} ({user_id})")
    print(f"🏢 Org   : {org_id}")

    # ── Get ZIP bytes ──────────────────────────────────────────────────
    if args.local_zip:
        print(f"📦 Using local ZIP: {args.local_zip}")
        with open(args.local_zip, "rb") as f:
            zip_bytes = f.read()
    else:
        zip_bytes = download_as_zip()

    # ── Parse + validate ───────────────────────────────────────────────
    pkg = parse_zip(zip_bytes)
    warnings = validate_package(pkg)
    if warnings:
        print("⚠  Validation warnings:")
        for w in warnings:
            print(f"   {w}")

    print(f"\n📊 Package: {pkg.metadata.get('title', 'Untitled')}")
    print(f"   Deployments  : {len(pkg.deployments)}")
    print(f"   Media records: {len(pkg.media)}")
    print(f"   Observations : {len(pkg.observations)}")

    # ── Import ─────────────────────────────────────────────────────────
    print("\n🚀 Importing…")
    result = import_package(pkg, user_id, org_id, svc)

    # ── Report ─────────────────────────────────────────────────────────
    print("\n✅ Import complete!")
    print(f"   Project ID        : {result.project_id}")
    print(f"   Project name      : {result.project_name}")
    print(f"   Deployments       : {result.deployments_imported}")
    print(f"   Media records     : {result.media_imported}")
    print(f"   Observations      : {result.observations_imported}")

    if result.warnings:
        print(f"\n⚠  {len(result.warnings)} warning(s):")
        for w in result.warnings:
            print(f"   {w}")

    print(f"\n🗺  Open the website → My Data → Map, and select project '{result.project_name}'")
    print(f"    to see the Belgian/Netherlands deployment locations.")


if __name__ == "__main__":
    main()
