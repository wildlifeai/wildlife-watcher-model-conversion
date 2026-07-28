# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Vela model compiler subprocess wrapper.

Wraps the ethos-u-vela CLI for converting TFLite models to Ethos-U55 format.
"""

import subprocess
from pathlib import Path

import structlog

logger = structlog.get_logger()


class VelaConversionError(Exception):
    """Raised when Vela conversion fails."""

    pass


async def run_vela_conversion(
    input_path: Path,
    output_dir: Path,
    accelerator_config: str = "ethos-u55-64",
    memory_mode: str = "Shared_Sram",
    timeout: int = 120,
) -> Path:
    """Run Vela conversion on a TFLite model.

    Args:
        input_path: Path to the source .tflite file.
        output_dir: Directory for Vela output.
        accelerator_config: Target accelerator config.
        memory_mode: Memory mode for the target.
        timeout: Maximum seconds to wait for Vela.

    Returns:
        Path to the converted output file.

    Raises:
        VelaConversionError: If conversion fails.
    """
    cmd = [
        "vela",
        "--accelerator-config",
        accelerator_config,
        "--memory-mode",
        memory_mode,
        "--output-dir",
        str(output_dir),
        str(input_path),
    ]

    logger.info("vela_conversion_start", input=str(input_path))

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=timeout)
        logger.info("vela_conversion_success", stdout=result.stdout[:500])
    except subprocess.CalledProcessError as e:
        # The real reason (unsupported operator / not int8-quantized) is at the END
        # of Vela's output, after the Python traceback header — so surface the tail,
        # not the first 500 chars, and add an actionable hint.
        detail = ((e.stderr or "") + "\n" + (e.stdout or "")).strip()
        logger.error("vela_conversion_failed", returncode=e.returncode, detail=detail[-2000:])
        raise VelaConversionError(
            f"Vela failed (code {e.returncode}). The model must be a fully int8-quantized "
            "TFLite model compatible with the Ethos-U NPU — the usual causes are a float or "
            "only partially-quantized model, or an unsupported operator.\n\n"
            f"Vela output:\n{detail[-1200:]}"
        ) from e
    except FileNotFoundError:
        raise VelaConversionError("Vela command not found. Ensure ethos-u-vela is installed.")
    except subprocess.TimeoutExpired:
        raise VelaConversionError(f"Vela conversion timed out after {timeout}s")

    # Find output file
    return _find_vela_output(output_dir, input_path.name)


def _find_vela_output(work_dir: Path, original_name: str) -> Path:
    """Locate the Vela output file (same logic as app.py's find_vela_output)."""
    stem = Path(original_name).stem

    candidates = [
        work_dir / f"{stem}_vela.tflite",
        work_dir / "MOD00001.tfl",
        work_dir / "output.tflite",
    ]

    for path in candidates:
        if path.exists():
            return path

    # Fallback: original file may have been overwritten in-place
    original_path = work_dir / original_name
    if original_path.exists():
        return original_path

    raise VelaConversionError(f"Could not find Vela output in {work_dir}. Checked: {candidates}")
