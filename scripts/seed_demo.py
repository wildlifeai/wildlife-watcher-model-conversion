#!/usr/bin/env python3
"""
seed_demo.py
============
Seeds the shared read-only demo account behind the website's "Try the demo"
button:

1. Creates (or updates) the demo auth user with app_metadata.is_demo=true —
   the frontend uses this flag for the demo banner; enforcement is RLS.
2. Imports the official CamtrapDP MICA example dataset as the demo project
   (reuses seed_camtrapdp_example.py), unless --project-id points at an
   existing project to expose instead.
3. Grants the demo user a 'viewer' role on the project, so the account can
   browse everything but writes are denied by RLS / role checks.

After seeding, set DEMO_EMAIL / DEMO_PASSWORD in the backend .env to enable
POST /api/auth/demo-session.

Usage
-----
    python scripts/seed_demo.py \\
        --supabase-url      http://localhost:54321 \\
        --service-role-key  <service-role-key> \\
        --demo-email        demo@wildlife.ai \\
        --demo-password     <a-strong-password>

Environment variable alternative (avoids passing secrets as flags):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL, DEMO_PASSWORD
"""

import argparse
import os
import sys

try:
    from supabase import create_client
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with:  pip install supabase requests")
    sys.exit(1)

# NOTE: the MICA dataset import (seed_camtrapdp_example + app.domain.camtrapdp)
# is imported lazily inside main() so the lightweight --ensure-user-only path
# (used by CI on every deploy) needs only the `supabase` package, not the full
# backend dependency tree.


def ensure_demo_user(svc, email: str, password: str) -> str:
    """Create or update the demo auth user; returns its UUID."""
    attributes = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": {"is_demo": True},
    }
    try:
        created = svc.auth.admin.create_user(attributes)
        print(f"✓  Created demo user {email}")
        return created.user.id
    except Exception as exc:
        if "already" not in str(exc).lower():
            raise
    # User exists — find it and refresh password + flag.
    page = 1
    while True:
        users = svc.auth.admin.list_users(page=page, per_page=100)
        if not users:
            print(f"X  Could not find existing user {email}")
            sys.exit(1)
        match = next((u for u in users if u.email == email), None)
        if match:
            svc.auth.admin.update_user_by_id(
                match.id,
                {
                    "password": password,
                    "app_metadata": {"is_demo": True},
                    "email_confirm": True,
                },
            )
            print(f"✓  Updated existing demo user {email}")
            return match.id
        page += 1


def grant_viewer_role(svc, demo_user_id: str, project_id: str, granted_by: str) -> None:
    """Idempotently grant the demo user read-only project access.

    Uses the project_viewer role: RLS grants it SELECT on project data, but no
    write policy accepts project_viewer, so the demo is genuinely read-only at
    the DB level (added in migration add_project_viewer_readonly_role).
    """
    role = "project_viewer"
    # Query WITHOUT the is_active filter: the unique index is on
    # (user_id, role, scope_type, scope_id), so a soft-deactivated row would
    # still collide on insert. Reactivate it instead.
    existing = (
        svc.table("user_roles")
        .select("id, is_active")
        .eq("user_id", demo_user_id)
        .eq("scope_type", "project")
        .eq("scope_id", project_id)
        .eq("role", role)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        if row.get("is_active"):
            print(f"✓  {role} role already granted")
            return
        svc.table("user_roles").update(
            {"is_active": True, "modified_by": granted_by}
        ).eq("id", row["id"]).execute()
        print(f"✓  Reactivated existing {role} role")
        return
    svc.table("user_roles").insert(
        {
            "user_id": demo_user_id,
            "scope_type": "project",
            "scope_id": project_id,
            "role": role,
            "is_active": True,
            "granted_by": granted_by,
            "modified_by": granted_by,
        }
    ).execute()
    print(f"✓  Granted {role} role on demo project")


def main():
    parser = argparse.ArgumentParser(
        description="Seed the shared demo account for Wildlife Watcher"
    )
    parser.add_argument(
        "--supabase-url", default=os.getenv("SUPABASE_URL", "http://localhost:54321")
    )
    parser.add_argument(
        "--service-role-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    )
    parser.add_argument(
        "--demo-email", default=os.getenv("DEMO_EMAIL", "demo@wildlife.ai")
    )
    parser.add_argument("--demo-password", default=os.getenv("DEMO_PASSWORD", ""))
    parser.add_argument(
        "--owner-user-id",
        default="a0000000-0000-0000-0000-000000000012",
        help="UUID of the real user who owns the imported demo project (default: apps@wildlife.ai in dev seed)",
    )
    parser.add_argument(
        "--project-id",
        help="Expose an existing project as the demo instead of importing the MICA dataset",
    )
    parser.add_argument(
        "--ensure-user-only",
        action="store_true",
        help="Only create/refresh the demo auth user from DEMO_EMAIL/DEMO_PASSWORD "
        "(skip the dataset import + viewer grant). Idempotent and safe to run on "
        "every deploy; needs only the `supabase` package.",
    )
    args = parser.parse_args()

    if not args.service_role_key:
        print("✗  --service-role-key is required (or set SUPABASE_SERVICE_ROLE_KEY)")
        sys.exit(1)
    if not args.demo_password:
        print("✗  --demo-password is required (or set DEMO_PASSWORD)")
        sys.exit(1)

    url = args.supabase_url.rstrip("/") + "/"
    svc = create_client(url, args.service_role_key)
    print(f"🔌 Connected to {args.supabase_url}")

    demo_user_id = ensure_demo_user(svc, args.demo_email, args.demo_password)

    if args.ensure_user_only:
        print(
            "\n✅ Demo user ensured (--ensure-user-only). The demo project/data is "
            "seeded separately with a full run."
        )
        return

    # The MICA dataset import pulls in the full backend (camtrapdp domain + the
    # download helper). Imported lazily so the --ensure-user-only path above stays
    # dependency-light (only needs `supabase`).
    # Make this self-contained: put both scripts/ (for seed_camtrapdp_example)
    # and backend/ (for app.*) on the path explicitly, rather than relying on
    # seed_camtrapdp_example's import side-effect to add backend/.
    scripts_dir = os.path.abspath(os.path.dirname(__file__))
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    backend_dir = os.path.abspath(os.path.join(scripts_dir, "..", "backend"))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from seed_camtrapdp_example import download_as_zip, resolve_user  # noqa: E402

    from app.domain.camtrapdp import import_package, parse_zip  # noqa: E402

    if args.project_id:
        project_id = args.project_id
        print(f"📂 Using existing project {project_id}")
    else:
        owner_id, org_id = resolve_user(svc, args.owner_user_id)
        pkg = parse_zip(download_as_zip())
        print("🚀 Importing MICA example as demo project…")
        result = import_package(pkg, owner_id, org_id, svc)
        project_id = result.project_id
        print(f"✓  Imported project '{result.project_name}' ({project_id})")
        print(
            f"   Deployments: {result.deployments_imported}, media: {result.media_imported}, "
            f"observations: {result.observations_imported}"
        )

    grant_viewer_role(svc, demo_user_id, project_id, args.owner_user_id)

    print("\n✅ Demo seeded. Next steps:")
    print(
        f"   1. Set in backend .env:  DEMO_EMAIL={args.demo_email}  DEMO_PASSWORD=<the password>"
    )
    print("   2. Restart the backend — the 'Try the demo' button is now live.")


if __name__ == "__main__":
    main()
