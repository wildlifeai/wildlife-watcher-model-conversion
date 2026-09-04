# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pre-trained model registry for firmware manifest generation.

Each entry maps a model name → available resolutions → download URL + type.
"""

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


def get_model_config(model_type: str, resolution: str) -> dict:
    """Safe retrieval of a model's download config.

    ``labels`` and ``firmware_model_id`` are declared once per architecture, not
    per resolution, so both are folded into the returned config. Callers hold
    only this dict, and a ``config.get("labels")`` against the bare resolution
    entry silently returns nothing — which is how every pretrained model shipped
    a one-line ``unknown`` labels file (wildlifeai/ww-website#134).

    Raises:
        ValueError: If model_type or resolution is unknown.
    """
    try:
        config = MODEL_REGISTRY[model_type]["resolutions"][resolution].copy()
        config["firmware_model_id"] = MODEL_REGISTRY[model_type].get("firmware_model_id")
        config["labels"] = list(MODEL_REGISTRY[model_type].get("labels", []))
        return config
    except KeyError:
        raise ValueError(f"Configuration not found for {model_type} at {resolution}")
