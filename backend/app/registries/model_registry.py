# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pre-trained model registry for firmware manifest generation.

Each entry maps a model name → available resolutions → download URL + type.

Only classifiers are deployable. The ``ww500_md`` firmware reads the output
tensor as a ``[1, C]`` vector with ``C <= 16`` (``MAX_CLASSES``), softmaxes it
and reports class 1 as the target; it has no box decoding. A detection head
overflows its 16-byte result buffer
(Seeed_Grove_Vision_AI_Module_V2#225). The detection entries below stay in the
registry so their URLs, shapes and the reason live in one place, but ``blocked``
keeps them out of the catalogue and out of packaging until the firmware can run
them. Person and rat detection come first.
"""

_DETECTION_BLOCKED = (
    "ww500_md is a classifier pipeline: the output tensor must be [1, C] with C <= 16, "
    "and a detection head overflows the device's result buffer "
    "(Seeed_Grove_Vision_AI_Module_V2#225). Deferred until person and rat detection "
    "run end to end."
)

MODEL_REGISTRY = {
    "Person Detection": {
        "firmware_model_id": 20,
        "resolutions": {
            "96x96": {
                "url": "https://raw.githubusercontent.com/wildlifeai/Seeed_Grove_Vision_AI_Module_V2/main/EPII_CM55M_APP_S/app/scenario_app/allon_sensor_tflm/person_detect_model_data_vela.cc",
                "type": "cc_array",
                "filename": "person_detect_model_data_vela.cc",
            }
        },
        "labels": ["no person", "person"],
    },
    "YOLOv8 Object Detection": {
        "firmware_model_id": 1,
        "blocked": _DETECTION_BLOCKED,  # output [1, 4, 756] + [1, 756, 80]
        "resolutions": {
            "192x192": {
                "url": "https://raw.githubusercontent.com/wildlifeai/Seeed_Grove_Vision_AI_Module_V2/main/model_zoo/tflm_yolov8_od/yolov8n_od_192_delete_transpose_0xB7B000.tflite",
                "type": "tflite",
                "filename": "yolov8n_od_192.tflite",
                "precompiled": True,
            }
        },
        "labels": ["object"],
    },
    "YOLOv11 Object Detection": {
        "firmware_model_id": 1,
        "blocked": _DETECTION_BLOCKED,  # output [1, 84, 756]; the 224 variant is a raw 3-scale head
        "resolutions": {
            "192x192": {
                "url": "https://raw.githubusercontent.com/wildlifeai/Seeed_Grove_Vision_AI_Module_V2/main/model_zoo/tflm_yolo11_od/yolo11n_full_integer_quant_192_241219_batch_matmul_vela.tflite",
                "type": "tflite",
                "filename": "yolo11n_od_192.tflite",
                "precompiled": True,
            },
            "224x224": {
                "url": "https://raw.githubusercontent.com/wildlifeai/Seeed_Grove_Vision_AI_Module_V2/main/model_zoo/tflm_yolo11_od/yolo11n_full_integer_quant_vela_imgz_224_kris_nopost_241230.tflite",
                "type": "tflite",
                "filename": "yolo11n_od_224.tflite",
                "precompiled": True,
            },
        },
        "labels": ["object"],
    },
    "YOLOv8 Pose Estimation": {
        "firmware_model_id": 3,
        "blocked": _DETECTION_BLOCKED,  # seven output tensors, first is [1, 256, 64]
        "resolutions": {
            "256x256": {
                "url": "https://raw.githubusercontent.com/wildlifeai/Seeed_Grove_Vision_AI_Module_V2/main/model_zoo/tflm_yolov8_pose/yolov8n_pose_256_vela_3_9_0x3BB000.tflite",
                "type": "tflite",
                "filename": "yolov8n_pose_256.tflite",
                "precompiled": True,
            }
        },
        "labels": ["person_pose"],
    },
}


def supported_models() -> dict:
    """The registry entries the device can run: everything not marked ``blocked``.

    This is what the catalogue endpoint lists. Blocked entries are reachable only
    through ``get_model_config(..., include_blocked=True)`` for tooling that wants
    the URL or the shape without deploying anything.
    """
    return {name: entry for name, entry in MODEL_REGISTRY.items() if not entry.get("blocked")}


def get_model_config(model_type: str, resolution: str, *, include_blocked: bool = False) -> dict:
    """Safe retrieval of a model's download config.

    ``labels`` and ``firmware_model_id`` are declared once per architecture, not
    per resolution, so both are folded into the returned config. Callers hold
    only this dict, and a ``config.get("labels")`` against the bare resolution
    entry silently returns nothing — which is how every pretrained model shipped
    a one-line ``unknown`` labels file (wildlifeai/ww-website#134).

    Raises:
        ValueError: If model_type or resolution is unknown, or the entry is
            blocked and ``include_blocked`` is False. The message for a blocked
            entry carries the reason, so it can be shown to the user as is.
    """
    try:
        entry = MODEL_REGISTRY[model_type]
        config = entry["resolutions"][resolution].copy()
    except KeyError:
        raise ValueError(f"Configuration not found for {model_type} at {resolution}")

    if entry.get("blocked") and not include_blocked:
        raise ValueError(f"'{model_type}' cannot be deployed: {entry['blocked']}")

    config["firmware_model_id"] = entry.get("firmware_model_id")
    config["labels"] = list(entry.get("labels", []))
    return config
