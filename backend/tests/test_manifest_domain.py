# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit tests for the manifest domain — helpers and hex array extraction."""

import tempfile
from pathlib import Path

import pytest

from app.domain.manifest import ManifestDomainError, _extract_hex_array, _flatten_directory


class TestExtractHexArray:
    def test_valid_c_array(self):
        """Standard C array should be parsed to bytes."""
        c_code = """
        const unsigned char model_data[] = { 0x00, 0x01, 0xFF, 0xAB };
        """
        result = _extract_hex_array(c_code)
        assert result == bytes([0x00, 0x01, 0xFF, 0xAB])

    def test_multiline_array(self):
        c_code = """
        const unsigned char model_data[] = {
            0x00, 0x01,
            0x02, 0x03
        };
        """
        result = _extract_hex_array(c_code)
        assert result == bytes([0x00, 0x01, 0x02, 0x03])

    def test_no_array_raises(self):
        with pytest.raises(ManifestDomainError, match="Could not find"):
            _extract_hex_array("// no array here")

    def test_empty_array_raises(self):
        c_code = "const unsigned char data[] = { /* empty */ };"
        with pytest.raises(ManifestDomainError, match="No hex values"):
            _extract_hex_array(c_code)


class TestFlattenDirectory:
    def test_flattens_nested_files(self):
        """Files in subdirectories should be moved to root."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            sub = root / "nested" / "deep"
            sub.mkdir(parents=True)
            (sub / "file.txt").write_text("hello")
            (root / "root_file.txt").write_text("root")

            _flatten_directory(root)

            assert (root / "file.txt").exists()
            assert (root / "root_file.txt").exists()
            assert not (root / "nested").exists()

    def test_empty_directory(self):
        """Flattening an empty dir should not raise."""
        with tempfile.TemporaryDirectory() as td:
            _flatten_directory(Path(td))

    def test_duplicate_names_overwritten(self):
        """If nested file has same name as root file, root gets overwritten."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            sub = root / "sub"
            sub.mkdir()
            (root / "file.txt").write_text("root version")
            (sub / "file.txt").write_text("nested version")

            _flatten_directory(root)

            content = (root / "file.txt").read_text()
            assert content == "nested version"


class TestFirmware83Filename:
    def test_valid_version_string(self):
        from app.domain.manifest import firmware_83_filename

        # YYMDDHMM:
        # 2026 -> 26
        # May -> 5
        # 20 -> 20
        # 10 -> A (hour 10 is 'A')
        # 59 -> 59
        # Expected: 26520A59.IMG
        assert firmware_83_filename("WW500_C02 10:59:43 May 20 2026") == "26520A59.IMG"

    def test_fallback_build_date(self):
        from app.domain.manifest import firmware_83_filename

        # Expected: 26520000.IMG (no time info)
        assert firmware_83_filename("WW500_C02", "May 20 2026") == "26520000.IMG"

    def test_invalid_fallback(self):
        from app.domain.manifest import firmware_83_filename

        assert firmware_83_filename("invalid") == "output.img"


# ── Nullable model paths: unconverted models must be skipped, never NULL-dereffed ──


class TestNullableModelPaths:
    @pytest.mark.asyncio
    async def test_download_from_storage_returns_none_for_null_path(self):
        from app.services.storage import download_from_storage

        # NULL/empty path = nothing to download; must not touch the client.
        assert await download_from_storage("ai-models", None) is None  # type: ignore[arg-type]
        assert await download_from_storage("ai-models", "") is None

    @pytest.mark.asyncio
    async def test_resolve_project_model_treats_null_paths_as_no_model(self, monkeypatch):
        from unittest.mock import MagicMock

        from app.domain import manifest

        # A project whose assigned model is still converting (NULL paths).
        client = MagicMock()
        table = MagicMock()
        table.select.return_value = table
        table.eq.return_value = table
        table.execute.return_value = MagicMock(data=[{
            "model_id": "m1",
            "ai_models": {
                "id": "m1", "name": "Rat v3", "version": "3.0.0",
                "model_path": None, "labels_path": None,
                "model_family_id": "f1", "version_number": 3,
                "ai_model_families": {"firmware_model_id": 42},
            },
        }])
        client.table.return_value = table

        result = await manifest._resolve_project_model(client, "proj-1")
        assert result == {"has_model": False}
