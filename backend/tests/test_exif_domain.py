# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit tests for the EXIF domain — parse_exif_from_bytes and match_deployment."""

import struct

from app.domain.exif import (
    _apply_user_comment_fields,
    _extract_deployment_id,
    match_deployment,
    parse_exif_from_bytes,
    parse_user_comment_fields,
)


def _make_minimal_jpeg_with_exif(exif_data: bytes = b"") -> bytes:
    """Create a minimal JPEG with an APP1 EXIF segment."""
    # JPEG SOI
    jpeg = b"\xff\xd8"

    if exif_data:
        # APP1 marker + length + Exif header + TIFF data
        segment = b"Exif\x00\x00" + exif_data
        length = len(segment) + 2  # +2 for the length field itself
        jpeg += b"\xff\xe1" + struct.pack(">H", length) + segment

    # JPEG EOI
    jpeg += b"\xff\xd9"
    return jpeg


class TestParseExifFromBytes:
    def test_invalid_jpeg(self):
        """Non-JPEG bytes should return error."""
        result = parse_exif_from_bytes(b"not a jpeg")
        assert "error" in result

    def test_empty_input(self):
        """Empty input should return error."""
        result = parse_exif_from_bytes(b"")
        assert "error" in result

    def test_minimal_jpeg_no_exif(self):
        """Valid JPEG without EXIF should return empty dict with deployment_id=None."""
        jpeg = b"\xff\xd8\xff\xd9"
        result = parse_exif_from_bytes(jpeg)
        assert "error" not in result
        assert result.get("deployment_id") is None

    def test_jpeg_magic_bytes_validated(self):
        """First two bytes must be FF D8."""
        result = parse_exif_from_bytes(b"\xff\xd9rest")
        assert "error" in result


class TestExtractDeploymentId:
    def test_valid_uuid_in_deployment_id(self):
        """UUID in Deployment_ID tag should be extracted."""
        data = {"Deployment_ID": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}
        result = _extract_deployment_id(data)
        assert result == "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    def test_uuid_in_user_comment(self):
        """UUID embedded in UserComment should be found."""
        data = {"UserComment": "some prefix a1b2c3d4-e5f6-7890-abcd-ef1234567890 suffix"}
        result = _extract_deployment_id(data)
        assert result == "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    def test_uuid_in_custom_data(self):
        """UUID in Custom_Data should be found as last resort."""
        data = {"Custom_Data": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}
        result = _extract_deployment_id(data)
        assert result == "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    def test_no_uuid_returns_none(self):
        """Non-UUID strings should return None."""
        data = {"Deployment_ID": "not-a-uuid"}
        result = _extract_deployment_id(data)
        assert result is None

    def test_empty_data_returns_none(self):
        result = _extract_deployment_id({})
        assert result is None

    def test_priority_order(self):
        """Deployment_ID takes priority over UserComment."""
        data = {
            "Deployment_ID": "11111111-1111-1111-1111-111111111111",
            "UserComment": "22222222-2222-2222-2222-222222222222",
        }
        result = _extract_deployment_id(data)
        assert result == "11111111-1111-1111-1111-111111111111"


class TestUserCommentFields:
    def test_parses_label_value_pairs(self):
        # On-device NN class scores in the WW500 format.
        fields = parse_user_comment_fields("kiwi: 80; rat: 12; possum: 3;")
        assert fields == {"kiwi": "80", "rat": "12", "possum": "3"}

    def test_empty_or_non_string(self):
        assert parse_user_comment_fields("") == {}
        assert parse_user_comment_fields(None) == {}
        assert parse_user_comment_fields(12345) == {}

    def test_strips_exif_charcode_prefix(self):
        # A spec-compliant UserComment keeps its 8-byte charcode prefix after decode
        # (interior nulls survive null-stripping), e.g. "ASCII\0\0\0kiwi: 80;".
        assert parse_user_comment_fields("ASCII\x00\x00\x00kiwi: 80; rat: 12;") == {"kiwi": "80", "rat": "12"}
        assert parse_user_comment_fields("UNICODE\x00Temp: 14.5;") == {"Temp": "14.5"}
        # A real key that merely starts with those letters (no null padding) is NOT stripped.
        assert parse_user_comment_fields("ASCIIart: 5;") == {"ASCIIart": "5"}

    def test_bare_uuid_yields_no_fields(self):
        # A prepare.py-style UUID UserComment has no "key: value" tokens.
        assert parse_user_comment_fields("a1b2c3d4-e5f6-7890-abcd-ef1234567890") == {}

    def test_telemetry_surfaced_as_typed_fields(self):
        data = {"UserComment": "Temp: 14.5; Batt: 87; kiwi: 80;"}
        _apply_user_comment_fields(data)
        assert data["temperature_c"] == 14.5
        assert data["battery_pct"] == 87
        # The on-device scores remain available too.
        assert data["user_comment_fields"]["kiwi"] == "80"

    def test_telemetry_absent_is_harmless(self):
        data = {"UserComment": "kiwi: 80; rat: 12;"}
        _apply_user_comment_fields(data)
        assert "temperature_c" not in data
        assert data["user_comment_fields"]["rat"] == "12"

    def test_no_user_comment(self):
        data = {}
        _apply_user_comment_fields(data)
        assert "user_comment_fields" not in data


class TestMatchDeployment:
    def test_exact_id_match(self):
        """deployment_id exact match takes priority."""
        deployments = [
            {"id": "aaaa-bbbb", "latitude": 0.0, "longitude": 0.0},
            {"id": "cccc-dddd", "latitude": 10.0, "longitude": 10.0},
        ]
        exif = {"deployment_id": "cccc-dddd"}
        result = match_deployment(exif, deployments)
        assert result is not None
        assert result["id"] == "cccc-dddd"

    def test_gps_proximity_match(self):
        """GPS within ~50m should match."""
        deployments = [
            {"id": "far-away", "latitude": 50.0, "longitude": 50.0},
            {"id": "nearby", "latitude": -36.8485, "longitude": 174.7633},
        ]
        exif = {
            "deployment_id": None,
            "latitude": -36.8485,
            "longitude": 174.7634,  # ~10m away
        }
        result = match_deployment(exif, deployments)
        assert result is not None
        assert result["id"] == "nearby"

    def test_no_match_returns_none(self):
        deployments = [{"id": "far", "latitude": 50.0, "longitude": 50.0}]
        exif = {"deployment_id": None, "latitude": -36.0, "longitude": 174.0}
        assert match_deployment(exif, deployments) is None

    def test_empty_deployments(self):
        exif = {"deployment_id": "some-id"}
        assert match_deployment(exif, []) is None
