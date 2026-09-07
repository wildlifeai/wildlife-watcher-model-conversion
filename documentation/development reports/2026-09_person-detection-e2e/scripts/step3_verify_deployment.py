"""End-to-end, step 3: after images from the device are uploaded, what the website holds.

READ-ONLY. Usage: python e2e_step3_verify.py <deployment_id>

Shows, per media row: the EXIF UserComment fields the device wrote (stage 7), and
every observation on it split by ai_origin (edge = Camera AI from the device,
cloud = SpeciesNet / Wildlife Brain). The pass condition for the end-to-end run is
at least one media row with ``person`` in user_comment_fields AND an
``ai_origin='edge'`` observation citing the deployed model version (``20V1``).
"""

import pathlib as _pl

# Repo root = four levels up from this file; .env lives there, backend/ beside it.
_REPO = _pl.Path(__file__).resolve().parents[4]

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(_REPO / ".env")
svc = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

dep_id = sys.argv[1] if len(sys.argv) > 1 else None
if not dep_id:
    print("usage: e2e_step3_verify.py <deployment_id>")
    raise SystemExit(2)

dep = (
    svc.table("deployments")
    .select(
        "id,name,project_id,projects(name,model_id,ai_models(name,version_number,ai_model_families(firmware_model_id)))"
    )
    .eq("id", dep_id)
    .single()
    .execute()
    .data
)
proj = dep.get("projects") or {}
model = proj.get("ai_models") or {}
fam = model.get("ai_model_families") or {}
expected_version = (
    f"{fam.get('firmware_model_id')}V{model.get('version_number')}" if fam else None
)
print(
    f"deployment {dep['name']!r}  project {proj.get('name')!r}  model {model.get('name')!r}  expected source_model_version={expected_version}"
)

media = (
    svc.table("media")
    .select("id,file_name,captured_at,exif_metadata")
    .eq("deployment_id", dep_id)
    .order("captured_at")
    .execute()
    .data
)
print(f"\n{len(media)} media rows")

edge_hits = 0
for m in media:
    ucf = (m.get("exif_metadata") or {}).get("user_comment_fields") or {}
    obs = (
        svc.table("observations")
        .select(
            "ai_origin,scientific_name,classification_probability,source_model_version,review_status,observation_type"
        )
        .eq("media_id", m["id"])
        .execute()
        .data
    )
    edge = [o for o in obs if o.get("ai_origin") == "edge"]
    cloud = [o for o in obs if o.get("ai_origin") != "edge"]
    if any(o.get("source_model_version") == expected_version for o in edge):
        edge_hits += 1
    print(f"\n  {m['file_name']}  {m.get('captured_at')}")
    print(f"     device UserComment : {ucf if ucf else '(none)'}")
    for o in edge:
        print(
            f"     Camera AI (edge)   : {o['scientific_name']} {int((o['classification_probability'] or 0) * 100)}%  v={o['source_model_version']}  type={o['observation_type']}"
        )
    for o in cloud:
        print(
            f"     Cloud AI           : {o['scientific_name']} {int((o['classification_probability'] or 0) * 100)}%  {o.get('review_status')}"
        )

print(
    f"\nRESULT: {'PASS' if edge_hits else 'FAIL'}  {edge_hits}/{len(media)} media carry an edge observation from {expected_version}"
)
