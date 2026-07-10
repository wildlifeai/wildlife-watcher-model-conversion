# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit tests for the model domain — parsing, label extraction, filename generation."""

import tempfile
from pathlib import Path

import pytest

from app.domain.model import (
    ModelDomainError,
    _build_firmware_filename,
    _extract_labels_from_header,
    _parse_model_zip_name,
)


class TestParseModelZipName:
    def test_standard_format(self):
        name, version = _parse_model_zip_name("mymodel-custom-1.0.0.zip")
        assert name == "mymodel"
        assert version == "1.0.0"

    def test_complex_name(self):
        name, version = _parse_model_zip_name("bird-detector-custom-2.1.zip")
        assert name == "bird-detector"
        assert version == "2.1"

    def test_no_custom_tag(self):
        """Should fallback to defaults."""
        name, version = _parse_model_zip_name("mymodel.zip")
        assert name == "unknown"
        assert version == "1.0.0"

    def test_not_a_zip(self):
        with pytest.raises(ValueError, match="must end with .zip"):
            _parse_model_zip_name("model.tar.gz")


class TestExtractLabels:
    def test_valid_header(self):
        """Labels should be extracted from model_variables.h."""
        content = """
        const char* ei_classifier_inferencing_categories[] = { "cat", "dog", "bird" };
        """
        with tempfile.NamedTemporaryFile(mode="w", suffix=".h", delete=False) as f:
            f.write(content)
            f.flush()
            labels = _extract_labels_from_header(Path(f.name))

        assert labels == ["cat", "dog", "bird"]

    def test_no_labels_raises(self):
        content = "// no labels here"
        with tempfile.NamedTemporaryFile(mode="w", suffix=".h", delete=False) as f:
            f.write(content)
            f.flush()
            with pytest.raises(ModelDomainError, match="No labels"):
                _extract_labels_from_header(Path(f.name))


class TestBuildFirmwareFilename:
    def test_standard_ids(self):
        content = """
        .project_id = 12345
        .deploy_version = 3
        """
        with tempfile.NamedTemporaryFile(mode="w", suffix=".h", delete=False) as f:
            f.write(content)
            f.flush()
            name = _build_firmware_filename(Path(f.name))

        assert name == "12345V3.tfl"

    def test_truncation(self):
        """Filenames longer than 8 chars get truncated for 8.3 compliance."""
        content = """
        .project_id = 123456789
        .deploy_version = 99
        """
        with tempfile.NamedTemporaryFile(mode="w", suffix=".h", delete=False) as f:
            f.write(content)
            f.flush()
            name = _build_firmware_filename(Path(f.name))

        # "123456789V99" → truncated to "12345678.tfl"
        assert len(name) <= 12  # 8 + ".tfl"
        assert name.endswith(".tfl")

    def test_fallback(self):
        """Missing IDs should fallback to MOD00001.tfl."""
        content = "// nothing useful"
        with tempfile.NamedTemporaryFile(mode="w", suffix=".h", delete=False) as f:
            f.write(content)
            f.flush()
            name = _build_firmware_filename(Path(f.name))

        assert name == "MOD00001.tfl"


class TestConvertUploadedModelDiscovery:
    """tflite/labels discovery in convert_uploaded_model (paths that don't run Vela)."""

    @staticmethod
    def _zip(files: dict[str, bytes]) -> bytes:
        import io
        import zipfile

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for name, data in files.items():
                z.writestr(name, data)
        return buf.getvalue()

    @pytest.mark.asyncio
    async def test_precompiled_tfl_with_nested_labels_returns_without_vela(self):
        from app.domain.model import convert_uploaded_model

        zip_bytes = self._zip(
            {
                "out/MOD00001.tfl": b"\x00\x01tflcontent",
                "out/labels.txt": b"rat\nstoat\n",
            }
        )
        tfl, txt, labels = await convert_uploaded_model(zip_bytes, "precompiled.zip")
        assert tfl == b"\x00\x01tflcontent"
        assert labels == ["rat", "stoat"]
        assert txt == b"rat\nstoat\n"

    @pytest.mark.asyncio
    async def test_missing_tflite_lists_present_files(self):
        from app.domain.model import convert_uploaded_model

        zip_bytes = self._zip({"readme.txt": b"hi", "weights.bin": b"x"})
        with pytest.raises(ModelDomainError, match="No .tflite model found"):
            await convert_uploaded_model(zip_bytes, "bad.zip")


class TestLabelIntegrity:
    """LM-1/LM-2 label-chain checks: device class index i → labels[i] → label_map.

    LM-1: extracted label count must match the output size the metadata itself
    declares. LM-2: a precompiled labels.txt must agree with the Edge Impulse
    metadata in count AND order (labels are never sorted).
    """

    HEADER = """
    const char* ei_classifier_inferencing_categories[] = { "not rat", "rat" };
    const ei_impulse_t impulse = { .label_count = %d, };
    """

    def _header_file(self, content: str) -> Path:
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".h", delete=False)
        f.write(content)
        f.flush()
        f.close()
        return Path(f.name)

    def test_matching_declared_count_passes(self):
        labels = _extract_labels_from_header(self._header_file(self.HEADER % 2))
        assert labels == ["not rat", "rat"]

    def test_mismatched_declared_count_raises(self):
        with pytest.raises(ModelDomainError, match="Label/tensor mismatch"):
            _extract_labels_from_header(self._header_file(self.HEADER % 3))

    def test_ei_classifier_label_count_define_is_also_honoured(self):
        content = """
        #define EI_CLASSIFIER_LABEL_COUNT 3
        const char* ei_classifier_inferencing_categories[] = { "cat", "dog" };
        """
        with pytest.raises(ModelDomainError, match="Label/tensor mismatch"):
            _extract_labels_from_header(self._header_file(content))

    @pytest.mark.asyncio
    async def test_precompiled_labels_txt_must_match_metadata_order(self):
        from app.domain.model import convert_uploaded_model

        zip_bytes = TestConvertUploadedModelDiscovery._zip(
            {
                "out/MOD00001.tfl": b"\x00tfl",
                "out/labels.txt": b"rat\nnot rat\n",  # reversed vs metadata
                "model-parameters/model_variables.h": (self.HEADER % 2).encode(),
            }
        )
        with pytest.raises(ModelDomainError, match="does not match the model's own metadata"):
            await convert_uploaded_model(zip_bytes, "pkg.zip")

    @pytest.mark.asyncio
    async def test_precompiled_labels_txt_matching_metadata_passes(self):
        from app.domain.model import convert_uploaded_model

        zip_bytes = TestConvertUploadedModelDiscovery._zip(
            {
                "out/MOD00001.tfl": b"\x00tfl",
                "out/labels.txt": b"not rat\nrat\n",
                "model-parameters/model_variables.h": (self.HEADER % 2).encode(),
            }
        )
        _tfl, _txt, labels = await convert_uploaded_model(zip_bytes, "pkg.zip")
        assert labels == ["not rat", "rat"]

    @pytest.mark.asyncio
    async def test_empty_labels_txt_raises(self):
        from app.domain.model import convert_uploaded_model

        zip_bytes = TestConvertUploadedModelDiscovery._zip({"out/MOD00001.tfl": b"\x00tfl", "out/labels.txt": b"\n\n"})
        with pytest.raises(ModelDomainError, match="empty"):
            await convert_uploaded_model(zip_bytes, "pkg.zip")
