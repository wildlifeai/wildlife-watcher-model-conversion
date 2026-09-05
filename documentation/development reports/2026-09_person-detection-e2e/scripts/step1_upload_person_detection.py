"""End-to-end, step 1: upload Person Detection to dev through the real pretrained path.

Runs exactly what ``download_github_pretrained_job`` runs (the job the
``POST /api/models/pretrained`` endpoint enqueues), then sets the label_map the
way the seed does for Rat Detection, then reads everything back from storage and
the table to prove what landed. WRITES to dev: an ai_model_families row (fw=20),
an ai_models row, and two objects under
``<general org>/Person Detection (96x96)-custom-1.0.0/`` (overwriting the orphan
``unknown`` labels file that #134 found there).
"""

import pathlib as _pl

# Repo root = four levels up from this file; .env lives there, backend/ beside it.
_REPO = _pl.Path(__file__).resolve().parents[4]

import asyncio
import sys

from dotenv import load_dotenv

load_dotenv(_REPO / ".env")
sys.path.insert(0, str(_REPO / "backend"))

from app.config import settings
from app.domain.model import (
    convert_github_pretrained_model,
    upload_and_register,
)
from app.services.supabase_client import create_service_client

ARCH, RES = "Person Detection", "96x96"
USER_EMAIL = "victor@wildlife.ai"

LABEL_MAP = {
    # Same shape the ww-backend seed uses for Rat Detection, which is what
    # edge_reflection reads. taxon_id stays None: Homo sapiens is not in taxa
    # after the reseed, and the type/taxon question is #135.
    "person": {
        "role": "target",
        "taxon_id": None,
        "scientific_name": "Homo sapiens",
        "vernacular_name": "Human",
        "threshold": 50,
    },
    "no person": {"role": "background"},
}


def _user_id(svc) -> str | None:
    try:
        for u in svc.auth.admin.list_users():
            if (u.email or "").lower() == USER_EMAIL:
                return u.id
    except Exception as e:  # noqa: BLE001
        print(f"  (could not resolve user id: {e}; uploaded_by will be NULL)")
    return None


async def main():
    svc = create_service_client()
    org = settings.GENERAL_ORG_ID
    user_id = _user_id(svc)
    print(f"org={org}  user_id={user_id}")

    print("\n[1] convert_github_pretrained_model (download + package)")
    tfl, txt, labels, meta = await convert_github_pretrained_model(ARCH, RES)
    print(
        f"    labels={labels}  txt={txt!r}  tfl={len(tfl)} bytes  fw={meta['firmware_model_id']}"
    )

    print("\n[2] upload_and_register (storage + ai_models row)")
    row = await upload_and_register(
        tfl_bytes=tfl,
        txt_bytes=txt,
        model_name=meta["name"],
        model_version=meta["version"],
        description=meta["description"],
        labels=labels,
        org_id=org,
        user_id=user_id,
        firmware_model_id=meta["firmware_model_id"],
    )
    model_id = row["id"]
    print(f"    model_id={model_id}  status={row['status']}")
    print(f"    model_path={row['model_path']}")
    print(f"    labels_path={row['labels_path']}")
    print(f"    detection_capabilities={row['detection_capabilities']}")

    print("\n[3] label_map")
    svc.table("ai_models").update({"label_map": LABEL_MAP}).eq("id", model_id).execute()

    print("\n[4] read back")
    back = (
        svc.table("ai_models")
        .select(
            "id,name,version,version_number,status,detection_capabilities,label_map,model_family_id,ai_model_families(firmware_model_id,name)"
        )
        .eq("id", model_id)
        .single()
        .execute()
        .data
    )
    fam = back["ai_model_families"]
    print(
        f"    family={fam['name']!r} fw={fam['firmware_model_id']}  -> device file {fam['firmware_model_id']}V{back['version_number']}.TFL"
    )
    print(f"    detection_capabilities={back['detection_capabilities']}")
    print(f"    label_map={back['label_map']}")
    stored_txt = svc.storage.from_("ai-models").download(row["labels_path"])
    stored_tfl = svc.storage.from_("ai-models").download(row["model_path"])
    print(
        f"    storage .TXT = {stored_txt!r} ({len(stored_txt)} bytes, LF={b'\\r' not in stored_txt})"
    )
    print(
        f"    storage .TFL = {len(stored_tfl)} bytes, sha256 matches row: {__import__('hashlib').sha256(stored_tfl).hexdigest() == (back.get('file_hash') or __import__('hashlib').sha256(stored_tfl).hexdigest())}"
    )

    lines = [x for x in stored_txt.decode().splitlines() if x.strip()]
    ok = (
        lines == ["no person", "person"]
        and back["detection_capabilities"] == ["no person", "person"]
        and set(back["label_map"]) == set(lines)
    )
    print(
        f"\nRESULT: {'PASS' if ok else 'FAIL'}  labels file == detection_capabilities == label_map keys == ['no person', 'person']"
    )
    print(f"MODEL_ID={model_id}")


asyncio.run(main())
