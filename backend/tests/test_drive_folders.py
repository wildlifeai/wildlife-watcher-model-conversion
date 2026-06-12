# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the Drive deployment-folder convention.

One folder per deployment, named ``{end-date-or-start-date}_{id[:8]}`` so
folders sort by when the deployment finished, and found again by identity
(appProperties) so re-uploads reuse the folder even after a rename.
"""

import asyncio
from unittest.mock import MagicMock

from app.services.google_drive import GoogleDriveService, build_deployment_folder_name

DEP_ID = "ab12cd34-5678-90ef-0000-000000000000"


# ── Name builder ─────────────────────────────────────────────────────


def test_folder_name_uses_end_date():
    name = build_deployment_folder_name("2026-01-01T08:00:00", "2026-02-15T17:30:00+13:00", DEP_ID)
    assert name == "2026-02-15_ab12cd34"


def test_folder_name_falls_back_to_start_date_while_active():
    name = build_deployment_folder_name("2026-01-01T08:00:00", None, DEP_ID)
    assert name == "2026-01-01_ab12cd34"


def test_folder_name_falls_back_to_today_when_no_dates():
    from datetime import datetime, timezone

    name = build_deployment_folder_name(None, "", DEP_ID)
    assert name == f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}_ab12cd34"


def test_folder_names_sort_by_end_date_then_id():
    a = build_deployment_folder_name("2026-01-01", "2026-03-01", "aaaa1111-x")
    b = build_deployment_folder_name("2026-02-20", "2026-03-01", "bbbb2222-x")
    c = build_deployment_folder_name("2026-01-05", "2026-12-31", "cccc3333-x")
    assert sorted([c, b, a]) == [a, b, c]  # same-day deployments tie-broken by id


def test_preprocess_file_batch_uses_canonical_folder_name():
    from app.domain.photo_preprocessing import preprocess_file_batch

    dep_folder, proj_folder, _ = preprocess_file_batch(
        files=[],
        deployment={
            "id": DEP_ID,
            "deployment_start": "2026-01-01T08:00:00",
            "deployment_end": "2026-02-15T17:30:00",
            "location_name": "High Hill",
        },
        project={"id": "99998888-0000-0000-0000-000000000000", "name": "Skink Survey"},
    )
    assert dep_folder == "2026-02-15_ab12cd34"
    assert proj_folder == "skink-survey_99998888"


# ── ensure_deployment_folder ─────────────────────────────────────────


def make_service() -> GoogleDriveService:
    """Service instance without real credentials — sync internals mocked per test."""
    svc = GoogleDriveService.__new__(GoogleDriveService)
    svc._api_lock = asyncio.Lock()
    svc._dep_folder_memo = {}
    svc._find_folder_by_deployment_id = MagicMock(return_value=None)
    svc._find_folder = MagicMock(return_value=None)
    svc._patch_folder = MagicMock()
    svc._create_folder = MagicMock(return_value="created-id")
    return svc


async def test_existing_folder_with_stale_name_is_reused_and_renamed():
    """A folder created while the deployment was active is reused (not duplicated)
    and renamed to the end date once the deployment has finished."""
    svc = make_service()
    svc._find_folder_by_deployment_id.return_value = {"id": "old-id", "name": "2026-01-01_ab12cd34"}

    folder_id = await svc.ensure_deployment_folder("parent", DEP_ID, "2026-02-15_ab12cd34")

    assert folder_id == "old-id"
    svc._patch_folder.assert_called_once_with("old-id", name="2026-02-15_ab12cd34")
    svc._create_folder.assert_not_called()


async def test_existing_folder_with_correct_name_is_untouched():
    svc = make_service()
    svc._find_folder_by_deployment_id.return_value = {"id": "old-id", "name": "2026-02-15_ab12cd34"}

    folder_id = await svc.ensure_deployment_folder("parent", DEP_ID, "2026-02-15_ab12cd34")

    assert folder_id == "old-id"
    svc._patch_folder.assert_not_called()
    svc._create_folder.assert_not_called()


async def test_untagged_folder_matching_name_is_adopted():
    """Folders created before identity-tagging existed are adopted, not duplicated."""
    svc = make_service()
    svc._find_folder.return_value = "legacy-id"

    folder_id = await svc.ensure_deployment_folder("parent", DEP_ID, "2026-02-15_ab12cd34")

    assert folder_id == "legacy-id"
    svc._patch_folder.assert_called_once_with("legacy-id", app_properties={"deployment_id": DEP_ID})
    svc._create_folder.assert_not_called()


async def test_new_folder_is_created_with_identity_tag():
    svc = make_service()

    folder_id = await svc.ensure_deployment_folder("parent", DEP_ID, "2026-02-15_ab12cd34")

    assert folder_id == "created-id"
    svc._create_folder.assert_called_once_with("parent", "2026-02-15_ab12cd34", {"deployment_id": DEP_ID})


async def test_resolution_runs_once_per_deployment_per_batch():
    svc = make_service()
    svc._find_folder_by_deployment_id.return_value = {"id": "old-id", "name": "2026-02-15_ab12cd34"}

    first = await svc.ensure_deployment_folder("parent", DEP_ID, "2026-02-15_ab12cd34")
    second = await svc.ensure_deployment_folder("parent", DEP_ID, "2026-02-15_ab12cd34")

    assert first == second == "old-id"
    svc._find_folder_by_deployment_id.assert_called_once()
