"""Read-only audit: every labels file in the ai-models bucket vs its model's class count.

Uses the backend's own LM-1 reader, so a classifier ([1, C]) is compared to its
labels and anything else is reported as "not a classifier" rather than as a
bogus count. Exit code 1 when any classifier mismatches, so it can gate.

The two logs beside this script from 2026-09-05 were made with the pre-#139
reading (last dimension of any tensor), which is why they show 6, 7 and 756 for
detection heads.
"""

import pathlib as _pl

# Repo root = four levels up from this file; .env lives there, backend/ beside it.
_REPO = _pl.Path(__file__).resolve().parents[4]

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(_REPO / ".env")
sys.path.insert(0, str(_REPO / "backend"))

from app.domain.model import _classifier_class_count

svc = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
tmp = Path(os.environ.get("TEMP", ".")) / "_audit.tfl"

pairs = []


def walk(prefix="", depth=0):
    for it in svc.storage.from_("ai-models").list(prefix):
        name = it.get("name")
        full = f"{prefix}/{name}" if prefix else name
        if it.get("id") is None:
            if depth < 4:
                walk(full, depth + 1)
        elif name.lower().endswith(".txt"):
            pairs.append(full)


walk()

print(f"{'labels object':62} {'labels':28} {'n':>3} {'classes':>7}  verdict")
print("-" * 118)
failures = 0
for txt in sorted(pairs):
    blob = svc.storage.from_("ai-models").download(txt)
    labels = [ln for ln in blob.decode("utf-8", "replace").splitlines() if ln.strip()]
    tfl = txt[:-4] + (".TFL" if txt.endswith(".TXT") else ".tfl")
    try:
        tmp.write_bytes(svc.storage.from_("ai-models").download(tfl))
        n = _classifier_class_count(tmp)
    except Exception:  # noqa: BLE001 - a missing or unreadable .TFL is reported, not fatal
        n = None
    if n is None:
        verdict = "not a classifier / unreadable (LM-1 does not apply)"
    elif n == len(labels):
        verdict = "OK"
    else:
        verdict = "MISMATCH"
        failures += 1
    if labels == ["unknown"]:
        verdict += "  <-- 'unknown' labels file"
    print(f"{txt[-62:]:62} {str(labels)[:28]:28} {len(labels):>3} {n!s:>7}  {verdict}")

if tmp.exists():
    tmp.unlink()

print(f"\n{failures} classifier mismatch(es)")
raise SystemExit(1 if failures else 0)
