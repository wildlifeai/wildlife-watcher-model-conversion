# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""ARQ job function definitions.

Each function here is executed by the worker process, not the API server.
They delegate to domain layer classes for actual business logic.
"""

import asyncio
import hashlib
import time
from datetime import datetime, timezone

import structlog

from app.jobs.store import (
    complete_phase,
    emit_event,
    get_job,
    start_phase,
    update_job,
    update_summary,
)
from app.schemas.job import EventType, JobStatus, ProgressEvent, ProgressPhase
from app.services.notifications_service import emit_detection_notifications

logger = structlog.get_logger()

# Human-readable labels for AI pipeline steps, surfaced in the upload progress log.
_STEP_LABEL = {
    "media_prep": "Generating thumbnails",
    "speciesnet": "Detecting & classifying species",
    "animal_crop": "Cropping animals",
    "bioclip": "Running BioCLIP classifier",
}
_STEP_EMOJI = {
    "media_prep": "🖼️",
    "speciesnet": "🦊",
    "animal_crop": "✂️",
    "bioclip": "🧬",
}


def _normalize_exif_timestamp(ts):
    """Convert an EXIF datetime (``YYYY:MM:DD HH:MM:SS``, colons in the date) to ISO.

    Postgres rejects the raw EXIF form ("date/time field value out of range", 22008),
    which silently fails the whole media insert. Returns the value unchanged if it's
    None or already ISO/parseable by the DB.
    """
    if not isinstance(ts, str):
        return ts
    ts = ts.strip()
    if not ts:
        return None
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y:%m:%d %H:%M:%S%z"):
        try:
            return datetime.strptime(ts, fmt).isoformat()
        except ValueError:
            continue
    return ts  # already ISO (or unknown) — let the DB validate


async def convert_model_job(job_id: str, user_id: str, model_id: str):
    """Long-running model conversion. Executed by passing into runner.py.

    Retrieves the uploaded file from Redis blob store, normalizes/converts it
    to a .TFL binary, uploads to Supabase Storage, and updates the ai_models
    record to 'validated' (or 'failed' on error).

    Idempotency: If the model is already 'validated' or 'deployed', the job
    exits immediately. This handles ARQ retries and worker restarts safely.
    """
    log_ctx = {"job_type": "convert_model", "job_id": job_id, "model_id": model_id}
    logger.info("convert_job_start", **log_ctx)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1)

    from app.services.supabase_client import create_service_client

    client = create_service_client()

    async def update_model_status(status: str, error_message: str = None, **kwargs):
        payload = {"status": status, **kwargs}
        if error_message:
            payload["error_message"] = error_message
        # Append to processing_log

        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "job_id": job_id,
        }
        if error_message:
            log_entry["error"] = error_message

        # TODO(schema): Use a JSONB append RPC to prevent race conditions on processing_log
        try:
            existing_query = client.table("ai_models").select("processing_log").eq("id", model_id)
            existing = await asyncio.to_thread(existing_query.execute)
            current_log = existing.data[0].get("processing_log") or [] if existing.data else []
            current_log.append(log_entry)
            payload["processing_log"] = current_log
        except Exception:
            payload["processing_log"] = [log_entry]
        update_query = client.table("ai_models").update(payload).eq("id", model_id)
        await asyncio.to_thread(update_query.execute)

    try:
        # ── Idempotency guard ────────────────────────────────────
        check_query = client.table("ai_models").select("status").eq("id", model_id)
        model_check = await asyncio.to_thread(check_query.execute)
        if model_check.data and model_check.data[0]["status"] in ("validated", "deployed"):
            logger.info("convert_job_skipped_already_complete", **log_ctx)
            await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0)
            return

        # ── Transition to 'validating' ───────────────────────────
        await update_model_status("validating")
        logger.info("convert_job_validating", **log_ctx)

        from app.domain.model import convert_uploaded_model
        from app.services.azure_storage import delete_blob, retrieve_blob

        # Fetch model row to get org_id, family_id, version
        res_query = client.table("ai_models").select("*, ai_model_families(firmware_model_id)").eq("id", model_id)
        model_res = await asyncio.to_thread(res_query.execute)
        if not model_res.data:
            raise RuntimeError(f"Model record {model_id} not found")

        model_row = model_res.data[0]
        org_id = model_row.get("organisation_id")
        version_num = model_row.get("version", "1.0.0")
        family = model_row.get("ai_model_families") or {}
        firmware_id = family.get("firmware_model_id", "UNKNOWN")
        log_ctx.update({"org_id": org_id, "family_id": model_row.get("model_family_id"), "version": version_num, "firmware_id": firmware_id})

        # 1. Retrieve uploaded file from Redis
        file_content, metadata = await retrieve_blob(job_id)
        if not file_content:
            raise RuntimeError("Uploaded file not found in blob store (expired?)")

        filename = metadata.get("filename", "model.zip") if metadata else "model.zip"
        await update_job(job_id, progress=0.2)
        logger.info("convert_job_blob_retrieved", blob_size=len(file_content), **log_ctx)

        # 2. Convert through Vela / Normalize to .TFL
        start_time = time.time()
        tfl_bytes, txt_bytes, labels = await convert_uploaded_model(file_content, filename)
        conversion_ms = int((time.time() - start_time) * 1000)
        await update_job(job_id, progress=0.7)
        logger.info(
            "convert_job_conversion_complete",
            duration_ms=conversion_ms,
            tfl_bytes=len(tfl_bytes),
            txt_bytes=len(txt_bytes),
            labels=labels,
            **log_ctx,
        )

        # Hash the .TFL (this is what the mobile app transfers)
        file_hash = hashlib.sha256(tfl_bytes).hexdigest()

        # 3. Build 8.3 filenames
        name_stem = f"{firmware_id}V{version_num}"
        if len(name_stem) > 8:
            name_stem = name_stem[:8]

        # 4. Upload result to structured storage path
        result_path_tfl = f"{org_id}/{firmware_id}/{version_num}/{name_stem}.TFL"
        result_path_txt = f"{org_id}/{firmware_id}/{version_num}/{name_stem}.TXT"

        # Offload blocking upload to thread
        await asyncio.to_thread(
            client.storage.from_("ai-models").upload,
            path=result_path_tfl,
            file=tfl_bytes,
            file_options={"content-type": "application/octet-stream", "upsert": True},
        )
        await asyncio.to_thread(
            client.storage.from_("ai-models").upload,
            path=result_path_txt,
            file=txt_bytes,
            file_options={"content-type": "text/plain", "upsert": True},
        )
        logger.info("convert_job_upload_complete", path_tfl=result_path_tfl, path_txt=result_path_txt, **log_ctx)

        # 4. Storage upload is verified by Supabase SDK not raising an exception
        logger.info("convert_job_storage_verified", file_hash=file_hash, **log_ctx)

        # 5. Derive integer version_number from semantic version
        major_version = version_num.split(".")[0] if "." in version_num else version_num
        int_version = int(major_version) if major_version.isdigit() else 1

        # 6. Update the ai_models row to 'validated'
        await update_model_status(
            status="validated",
            file_hash=file_hash,
            model_path=result_path_tfl,
            labels_path=result_path_txt,
            file_size_bytes=len(tfl_bytes) + len(txt_bytes),
            detection_capabilities=labels,
            file_type="model",
            version_number=int_version,
        )

        await update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=1.0,
        )

        # 6. Clean up blob from Redis
        await delete_blob(job_id)

        logger.info("convert_job_complete", file_hash=file_hash, **log_ctx)

    except Exception as e:
        try:
            await update_model_status("failed", error_message=str(e))
        except Exception as status_err:
            logger.warning("failed_to_update_model_status_on_error", error=str(status_err))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))
        logger.error("convert_job_failed", error=str(e), **log_ctx)
        # Clean up blob even on failure
        try:
            from app.services.azure_storage import delete_blob

            await delete_blob(job_id)
        except Exception:
            pass
        raise


async def generate_manifest_job(job_id: str, params: dict):
    """Assemble MANIFEST.zip. May take 10-30s depending on downloads."""
    logger.info("job_start", job_type="generate_manifest", job_id=job_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1)

    try:
        from app.domain.manifest import generate_manifest
        from app.services.storage import upload_to_storage
        from app.services.supabase_client import create_service_client

        async def _on_progress(msg: str) -> None:
            await update_job(job_id, message=msg)

        manifest_bytes = await generate_manifest(
            model_source=params.get("model_source", "default"),
            model_type=params.get("model_type"),
            model_name=params.get("model_name"),
            model_id=params.get("model_id"),
            model_version=params.get("model_version"),
            resolution=params.get("resolution"),
            sscma_model_id=params.get("sscma_model_id"),
            org_model_id=params.get("org_model_id"),
            camera_type=params.get("camera_type", "Raspberry Pi"),
            project_id=params.get("project_id"),
            github_branch=params.get("github_branch", "main"),
            himax_firmware_id=params.get("himax_firmware_id"),
            on_progress=_on_progress,
        )

        await update_job(job_id, progress=0.8, message="Uploading Setup_Package.zip…")

        # 5. Upload final ZIP
        result_path = f"temp/manifests/{job_id}/Setup_Package.zip"
        uploaded = await upload_to_storage("firmware", result_path, manifest_bytes, "application/zip")

        if uploaded:
            client = create_service_client()
            try:
                signed = client.storage.from_("firmware").create_signed_url(
                    result_path,
                    expires_in=900,  # 15 minutes
                )
                result_url = signed.get("signedURL", "")
            except Exception:
                result_url = result_path

            await update_job(
                job_id,
                status=JobStatus.COMPLETED,
                progress=1.0,
                result_url=result_url,
                message="✅ Setup_Package.zip ready for download",
            )
        else:
            await update_job(
                job_id,
                status=JobStatus.FAILED,
                error="Failed to upload manifest to storage",
            )

        logger.info(
            "job_complete",
            job_type="generate_manifest",
            job_id=job_id,
            size_bytes=len(manifest_bytes),
        )

    except Exception as e:
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))
        logger.error("job_failed", job_type="generate_manifest", job_id=job_id, error=str(e))
        raise


async def export_camtrapdp_job(job_id: str, org_id: str, params: dict):
    """Export deployment data as CamtrapDP package."""
    logger.info("job_start", job_type="export_camtrapdp", job_id=job_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1)

    try:
        from app.domain.public_api import generate_camtrapdp_package
        from app.services.storage import upload_to_storage
        from app.services.supabase_client import create_service_client

        package_bytes = await generate_camtrapdp_package(
            org_id=org_id,
            project_id=params.get("project_id"),
            deployment_ids=params.get("deployment_ids"),
            date_from=params.get("date_from"),
            date_to=params.get("date_to"),
            include_observations=params.get("include_observations", True),
        )

        await update_job(job_id, progress=0.8)

        result_path = f"temp/exports/{job_id}/camtrap-dp.zip"
        uploaded = await upload_to_storage("firmware", result_path, package_bytes, "application/zip")

        if uploaded:
            client = create_service_client()
            try:
                signed = client.storage.from_("firmware").create_signed_url(
                    result_path,
                    expires_in=3600,  # 1 hour for exports
                )
                result_url = signed.get("signedURL", result_path)
            except Exception:
                result_url = result_path

            await update_job(
                job_id,
                status=JobStatus.COMPLETED,
                progress=1.0,
                result_url=result_url,
            )
        else:
            await update_job(job_id, status=JobStatus.FAILED, error="Failed to upload export")

        logger.info("job_complete", job_type="export_camtrapdp", job_id=job_id)

    except Exception as e:
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))
        logger.error("job_failed", job_type="export_camtrapdp", job_id=job_id, error=str(e))
        raise


async def download_pretrained_job(job_id: str, user_id: str, sscma_uuid: str, org_id: str, custom_name: str = "", custom_desc: str = ""):
    """Download, convert, and register an SSCMA pretrained model."""
    logger.info("job_start", job_type="download_pretrained", job_id=job_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1)

    try:
        from app.domain.model import convert_pretrained_model, upload_and_register

        # 1. Download, optionally compile with Vela, package labels
        # Could take 30-60s if Vela is invoked
        tfl_bytes, txt_bytes, labels, metadata = await convert_pretrained_model(sscma_uuid)
        await update_job(job_id, progress=0.6)

        final_name = custom_name if custom_name else metadata.get("name", "Unknown SSCMA Model")
        final_desc = custom_desc if custom_desc else metadata.get("description", "Imported from Seeed Studio Model Zoo")

        # 2. Upload to storage and register in DB
        db_model = await upload_and_register(
            tfl_bytes=tfl_bytes,
            txt_bytes=txt_bytes,
            model_name=final_name,
            model_version=metadata.get("version", "1.0.0"),
            description=final_desc,
            labels=labels,
            org_id=org_id,
            user_id=user_id,
            firmware_model_id=metadata.get("firmware_model_id"),
        )

        await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0)
        logger.info("job_complete", job_type="download_pretrained", job_id=job_id, model_id=db_model["id"])

    except Exception as e:
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))
        logger.error("job_failed", job_type="download_pretrained", job_id=job_id, error=str(e))
        raise


async def download_github_pretrained_job(job_id: str, user_id: str, org_id: str, architecture: str, resolution: str, custom_desc: str = ""):
    """Download, package, and register a GitHub pretrained model."""
    logger.info("job_start", job_type="download_github_pretrained", job_id=job_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1)

    try:
        from app.domain.model import convert_github_pretrained_model, upload_and_register

        tfl_bytes, txt_bytes, labels, metadata = await convert_github_pretrained_model(architecture, resolution)
        await update_job(job_id, progress=0.6)

        final_name = metadata.get("name", f"{architecture} ({resolution})")
        final_desc = custom_desc if custom_desc else metadata.get("description", "Imported from GitHub Model Zoo")

        db_model = await upload_and_register(
            tfl_bytes=tfl_bytes,
            txt_bytes=txt_bytes,
            model_name=final_name,
            model_version=metadata.get("version", "1.0.0"),
            description=final_desc,
            labels=labels,
            org_id=org_id,
            user_id=user_id,
            firmware_model_id=metadata.get("firmware_model_id"),
        )

        await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0)
        logger.info("job_complete", job_type="download_github_pretrained", job_id=job_id, model_id=db_model["id"])

    except Exception as e:
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))
        logger.error("job_failed", job_type="download_github_pretrained", job_id=job_id, error=str(e))
        raise


def build_pipeline_steps() -> list:
    """Build the ordered pipeline step list from the enabled feature flags.

    Returns an empty list when ML/pipeline are disabled (or no per-step flags are on),
    in which case callers skip the AI pipeline entirely. Single source of truth shared by
    the upload job's inline AI phase and the standalone ``auto_annotate_deployments``.
    """
    from app.config import settings
    from app.schemas.pipeline import PipelineStepType

    if not (settings.FF_ML_ENABLED and settings.FF_PIPELINE_ENABLED):
        return []

    steps: list = []
    if settings.FF_MEDIA_REGISTRY_ENABLED:
        steps.append(PipelineStepType.MEDIA_PREP)
    if settings.FF_SPECIESNET_ENABLED:
        steps.append(PipelineStepType.SPECIESNET)
        steps.append(PipelineStepType.ANIMAL_CROP)
    if settings.FF_BIOCLIP_ENABLED:
        steps.append(PipelineStepType.BIOCLIP)
    return steps


async def auto_annotate_deployments(deployment_ids: list[str], user_id: str | None = None) -> None:
    """Run the AI annotation pipeline on freshly-uploaded deployments (best-effort).

    Enqueued (fire-and-forget) by the upload job after media is registered, so species
    observations populate the Annotations grid without a manual trigger. Step set is
    built from the enabled feature flags; failures are logged, never raised.

    Caveat: ``run_pipeline`` processes ALL media in a deployment, so re-uploading to an
    already-annotated deployment re-runs it (duplicate AI observations). Fine for fresh
    deployments; scope-to-new-media is a future enhancement.
    """
    from app.domain.pipeline import run_pipeline

    steps = build_pipeline_steps()
    if not steps:
        return

    for dep_id in deployment_ids:
        try:
            logger.info("auto_annotate_start", deployment_id=dep_id, steps=[s.value for s in steps])
            await run_pipeline(deployment_id=dep_id, steps=steps, user_id=user_id)
            await emit_detection_notifications(dep_id)
            logger.info("auto_annotate_complete", deployment_id=dep_id)
        except Exception as exc:
            logger.warning("auto_annotate_failed", deployment_id=dep_id, error=str(exc))


async def upload_drive_images_job(job_id: str, payload: dict):
    """Upload analysed images to Google Drive.

    Emits structured ``ProgressEvent``\\s throughout so the frontend can
    render deterministic progress (no string parsing).  Runs through
    three phases: DOWNLOAD → DRIVE_UPLOAD → CLEANUP.  Cleanup must
    finish before the job is marked complete.

    Payload shape::

        {
            "files": [
                {"blob_id": "...", "filename": "...", "timestamp": "..."}
            ],
            "project": {"id": "...", "name": "..."} | None,
            "deployment": {"id": "...", "date": "YYYY-MM-DD"} | None
        }
    """
    import asyncio

    logger.info("job_start", job_type="upload_drive_images", job_id=job_id)

    file_entries = payload.get("files", [])
    total_files = len(file_entries)

    if not file_entries:
        await update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=1.0,
            message="No files to process.",
        )
        return

    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.05)
    await update_summary(
        job_id,
        total=total_files,
        started_at=datetime.now(timezone.utc),
    )
    await emit_event(
        job_id,
        ProgressEvent(
            type=EventType.JOB_STARTED,
            phase=ProgressPhase.DOWNLOAD,
            total=total_files,
            message=f"🚀 Starting pipeline for {total_files} images",
        ),
    )

    try:
        from app.services.azure_storage import delete_blob, retrieve_blob
        from app.services.google_drive import GoogleDriveService

        # Shared mutable state for heartbeat visibility
        last_event_ts = time.monotonic()

        # ── Heartbeat helper (separate async task) ───────────
        async def _heartbeat_loop(phase, get_progress, stop_event):
            """Fires if no event for 10 s — guarantees the UI never stalls."""
            while not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=10)
                    break  # stop was set
                except asyncio.TimeoutError:
                    nonlocal last_event_ts
                    if time.monotonic() - last_event_ts >= 10:
                        c, t = get_progress()
                        await emit_event(
                            job_id,
                            ProgressEvent(
                                type=EventType.HEARTBEAT,
                                phase=phase,
                                current=c,
                                total=t,
                                message=f"Still working… ({c}/{t})",
                            ),
                        )
                        last_event_ts = time.monotonic()

        # ── Phase 1: DOWNLOAD from Azure Storage ─────────────
        await start_phase(job_id, ProgressPhase.DOWNLOAD)

        files_with_bytes = []
        download_completed = 0
        sem = asyncio.Semaphore(5)

        async def fetch(idx, entry):
            nonlocal download_completed, last_event_ts
            async with sem:
                content, _ = await retrieve_blob(entry["blob_id"])

                download_completed += 1
                # Budget: download 0.05→0.20, drive-upload 0.20→0.45, register/cleanup
                # →0.50, AI pipeline 0.50→1.0 (the AI phase is the longest, so it owns
                # the bulk of the bar instead of the bar freezing at ~99%).
                progress = 0.05 + (0.15 * (download_completed / total_files))
                await update_job(job_id, progress=min(progress, 0.20))

                if content:
                    await update_summary(job_id, downloaded_inc=1)
                    await emit_event(
                        job_id,
                        ProgressEvent(
                            type=EventType.FILE_SUCCESS,
                            phase=ProgressPhase.DOWNLOAD,
                            current=download_completed,
                            total=total_files,
                            file_index=idx + 1,
                            filename=entry["filename"],
                            message=f"📥 Loaded image {download_completed}/{total_files} from Azure Storage ✓",
                        ),
                    )
                else:
                    await update_summary(job_id, failed_inc=1)
                    await emit_event(
                        job_id,
                        ProgressEvent(
                            type=EventType.FILE_FAILURE,
                            phase=ProgressPhase.DOWNLOAD,
                            current=download_completed,
                            total=total_files,
                            file_index=idx + 1,
                            filename=entry["filename"],
                            message=f"⚠️ Image {download_completed}/{total_files} ({entry['filename']}) failed to download",
                        ),
                    )

                last_event_ts = time.monotonic()
                return entry, content

        hb_stop = asyncio.Event()
        hb_task = asyncio.create_task(
            _heartbeat_loop(
                ProgressPhase.DOWNLOAD,
                lambda: (download_completed, total_files),
                hb_stop,
            )
        )

        results = await asyncio.gather(*[fetch(i, e) for i, e in enumerate(file_entries)])

        hb_stop.set()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass

        for entry, content in results:
            if content:
                files_with_bytes.append(
                    {
                        "file_bytes": content,
                        "filename": entry["filename"],
                        "timestamp": entry.get("timestamp"),
                        "project": entry.get("project"),
                        "deployment": entry.get("deployment"),
                    }
                )

        await complete_phase(job_id, ProgressPhase.DOWNLOAD)

        if not files_with_bytes:
            logger.warning("drive_upload_no_files_downloaded", job_id=job_id)
            await update_job(
                job_id,
                status=JobStatus.FAILED,
                error="No files could be downloaded from storage",
                message="Failed: could not download any files from Azure Storage.",
            )
            return

        # ── Phase 1.5: PREPROCESS (rename files, build folder names) ──
        try:
            from app.domain.photo_preprocessing import preprocess_file_batch

            # Group files by deployment ID
            dep_groups: dict[str, list] = {}
            for f in files_with_bytes:
                dep_id = f.get("deployment", {}).get("id", "unknown")
                dep_groups.setdefault(dep_id, []).append(f)

            # Preprocess each deployment group
            preprocessed_files = []
            for dep_id, group in dep_groups.items():
                deployment = group[0].get("deployment", {})
                project = group[0].get("project", {})
                if project and deployment:
                    dep_folder, proj_folder, group = preprocess_file_batch(group, deployment, project)
                    # Stamp folder names onto every file in this group
                    for f in group:
                        f["_deployment_folder"] = dep_folder
                        f["_project_folder"] = proj_folder
                preprocessed_files.extend(group)

            files_with_bytes = preprocessed_files

            await emit_event(
                job_id,
                ProgressEvent(
                    type=EventType.PROGRESS,
                    phase=ProgressPhase.DOWNLOAD,
                    message=f"📝 Preprocessed {len(files_with_bytes)} images (renamed & sorted)",
                ),
            )
        except Exception as preprocess_err:
            # Non-fatal: if preprocessing fails, continue with original names
            logger.warning(
                "photo_preprocessing_failed",
                error=str(preprocess_err),
                job_id=job_id,
            )
            await emit_event(
                job_id,
                ProgressEvent(
                    type=EventType.PROGRESS,
                    phase=ProgressPhase.DOWNLOAD,
                    message=f"⚠️ Photo preprocessing skipped: {preprocess_err}",
                ),
            )

        # ── Phase 2: DRIVE UPLOAD ────────────────────────────
        await start_phase(job_id, ProgressPhase.DRIVE_UPLOAD)

        drive = GoogleDriveService()
        drive_total = len(files_with_bytes)
        drive_completed = 0
        last_event_ts = time.monotonic()

        async def on_drive_file_event(
            action,
            *,
            filename="",
            folder_name="",
            index=0,
            total=0,
            error="",
        ):
            nonlocal drive_completed, last_event_ts
            last_event_ts = time.monotonic()

            if action == "folder_created":
                await emit_event(
                    job_id,
                    ProgressEvent(
                        type=EventType.FOLDER_CREATED,
                        phase=ProgressPhase.DRIVE_UPLOAD,
                        message=f'📁 Created folder "{folder_name}" in Google Drive',
                    ),
                )
            elif action == "uploaded":
                drive_completed = index
                await update_summary(job_id, uploaded_inc=1)
                progress = 0.20 + (0.25 * (index / total))
                await update_job(job_id, progress=min(progress, 0.45))
                await emit_event(
                    job_id,
                    ProgressEvent(
                        type=EventType.FILE_SUCCESS,
                        phase=ProgressPhase.DRIVE_UPLOAD,
                        current=index,
                        total=total,
                        filename=filename,
                        message=f"☁️ Uploaded {filename} ({index}/{total}) ✓",
                    ),
                )
            elif action == "skipped":
                drive_completed = index
                await update_summary(job_id, skipped_inc=1)
                progress = 0.20 + (0.25 * (index / total))
                await update_job(job_id, progress=min(progress, 0.45))
                await emit_event(
                    job_id,
                    ProgressEvent(
                        type=EventType.FILE_SKIP,
                        phase=ProgressPhase.DRIVE_UPLOAD,
                        current=index,
                        total=total,
                        filename=filename,
                        message=f"⏭️ {filename} ({index}/{total}) already exists (skipped)",
                    ),
                )
            elif action == "failed":
                drive_completed = index
                await update_summary(job_id, failed_inc=1)
                await emit_event(
                    job_id,
                    ProgressEvent(
                        type=EventType.FILE_FAILURE,
                        phase=ProgressPhase.DRIVE_UPLOAD,
                        current=index,
                        total=total,
                        filename=filename,
                        message=f"⚠️ Failed to upload {filename} ({index}/{total}): {error}",
                    ),
                )

        hb_stop2 = asyncio.Event()
        hb_task2 = asyncio.create_task(
            _heartbeat_loop(
                ProgressPhase.DRIVE_UPLOAD,
                lambda: (drive_completed, drive_total),
                hb_stop2,
            )
        )

        stats = await drive.upload_analysis_images(
            files=files_with_bytes,
            file_callback=on_drive_file_event,
        )

        hb_stop2.set()
        try:
            await hb_task2
        except asyncio.CancelledError:
            pass

        await complete_phase(job_id, ProgressPhase.DRIVE_UPLOAD)

        # ── Register uploaded images as media rows ───────────
        # Without this the images live in Google Drive but never appear in the
        # Annotations grid (which queries the `media` table) and the AI pipeline
        # has nothing to run on. One row per newly-uploaded file, pointing at the
        # Drive object via gdrive:// so the media resolver can serve thumbnails.
        import uuid as _uuid

        from app.services.supabase_client import create_service_client

        uploaded = stats.get("files", []) or []
        # The exif-upload path (no media_id) registers media; CamtrapDP (media_id) patches.
        candidates = [uf for uf in uploaded if uf.get("deployment_id") and uf.get("file_id") and not uf.get("media_id")]
        svc = create_service_client()

        # ── Guard 1: dedup. Skip files that already have a media row, by file_hash
        # (the schema's dedup key) OR by gdrive:// path (covers rows lacking a hash,
        # e.g. back-filled). Because upload_file now returns Drive-skipped duplicates
        # too, this also *back-fills* a media row for an image that's in Drive but has
        # no DB row yet — so re-upload is self-healing instead of stranding images.
        existing_keys: set = set()
        for dep in sorted({uf["deployment_id"] for uf in candidates}):
            try:
                rows = svc.table("media").select("file_hash, file_path").eq("deployment_id", dep).execute().data or []
            except Exception:
                rows = []
            for r in rows:
                if r.get("file_hash"):
                    existing_keys.add(("hash", r["file_hash"]))
                if r.get("file_path"):
                    existing_keys.add(("path", r["file_path"]))

        media_rows = [
            {
                "id": str(_uuid.uuid4()),
                "deployment_id": uf["deployment_id"],
                "file_path": f"gdrive://{uf['file_id']}",
                "file_name": uf.get("filename") or "image.jpg",
                "file_mediatype": "image/jpeg",
                "timestamp": _normalize_exif_timestamp(uf.get("timestamp")),
                "file_public": False,
                "file_hash": uf.get("file_hash"),
            }
            for uf in candidates
            if ("hash", uf.get("file_hash")) not in existing_keys and ("path", f"gdrive://{uf['file_id']}") not in existing_keys
        ]
        media_created = 0
        if media_rows:
            for i in range(0, len(media_rows), 100):
                chunk = [{k: v for k, v in r.items() if v is not None} for r in media_rows[i : i + 100]]
                try:
                    svc.table("media").insert(chunk).execute()
                    media_created += len(chunk)
                except Exception as exc:
                    # A batch insert is all-or-nothing, so one bad row strands the whole
                    # chunk (and silently leaves images with no media → empty Annotations).
                    # Fall back to per-row inserts so good rows still land and the
                    # offending row is identified.
                    logger.warning("media_register_chunk_failed", error=str(exc), job_id=job_id)
                    for row in chunk:
                        try:
                            svc.table("media").insert(row).execute()
                            media_created += 1
                        except Exception as row_exc:
                            logger.warning(
                                "media_register_failed",
                                error=str(row_exc),
                                file_name=row.get("file_name"),
                                timestamp=row.get("timestamp"),
                                job_id=job_id,
                            )
            logger.info("media_registered", count=media_created, job_id=job_id)
            await emit_event(
                job_id,
                ProgressEvent(
                    type=EventType.PROGRESS,
                    phase=ProgressPhase.DRIVE_UPLOAD,
                    message=f"🗂️ Registered {media_created} image(s) — view them in Annotations",
                ),
            )

            # NOTE: the AI pipeline is NOT triggered here. It runs once, inline, in the
            # dedicated AI_PIPELINE phase below (after cleanup) so it has proper progress
            # events and the job's final status reflects it. Triggering it here as well
            # caused two concurrent pipelines per deployment (the torch.fx detector race).

        # ── Phase 3: CLEANUP ─────────────────────────────────
        await start_phase(job_id, ProgressPhase.CLEANUP)
        await update_job(job_id, progress=0.47)

        blob_ids = [entry["blob_id"] for entry in file_entries]

        async def _cleanup_blobs():
            nonlocal last_event_ts
            completed = 0
            total = len(blob_ids)
            for bid in blob_ids:
                try:
                    await delete_blob(bid)
                except Exception:
                    pass
                completed += 1

                last_event_ts = time.monotonic()
                if completed % max(1, total // 10) == 0 or completed == total:
                    await emit_event(
                        job_id,
                        ProgressEvent(
                            type=EventType.PROGRESS,
                            phase=ProgressPhase.CLEANUP,
                            current=completed,
                            total=total,
                            message=f"🧹 Cleaning up temporary buffers ({completed}/{total})",
                        ),
                    )
                    progress = 0.47 + (0.03 * (completed / total))
                    await update_job(job_id, progress=min(progress, 0.50))
            return completed

        deleted = await _cleanup_blobs()
        if deleted:
            logger.info("drive_upload_intermediate_files_cleaned", count=deleted)

        await complete_phase(job_id, ProgressPhase.CLEANUP)

        # ── Phase 4: AI PIPELINE (auto-run once per deployment after Drive sync) ─
        # Imports deferred to keep the top-level module lightweight.
        from app.domain.pipeline import run_pipeline  # noqa: PLC0415

        _user_id = payload.get("user_id")
        # Unique deployment IDs present in this upload batch
        _dep_ids: list[str] = list(
            {entry.get("deployment", {}).get("id") for entry in file_entries if entry.get("deployment") and entry.get("deployment", {}).get("id")}
        )

        # Step set from the enabled flags (same source as auto_annotate_deployments),
        # so this single inline run includes SpeciesNet/BioCLIP/etc. when enabled.
        _steps = build_pipeline_steps()
        pipeline_errors = 0
        if _dep_ids and _steps:
            await start_phase(job_id, ProgressPhase.AI_PIPELINE)
            # The AI phase owns the tail of the progress bar (0.50 → 1.0): it is by far
            # the longest phase, so the bar keeps moving + logs a line per step instead
            # of freezing at the end of the upload.
            _ai_total = max(1, len(_dep_ids) * len(_steps))
            _ai_done = 0

            for _dep_id in _dep_ids:

                async def _on_step(step_name: str, _i: int, _n: int, _dep=_dep_id) -> None:
                    nonlocal _ai_done
                    await emit_event(
                        job_id,
                        ProgressEvent(
                            type=EventType.PROGRESS,
                            phase=ProgressPhase.AI_PIPELINE,
                            message=f"{_STEP_EMOJI.get(step_name, '🔬')} {_STEP_LABEL.get(step_name, step_name)} — {_dep[:8]}…",
                        ),
                    )
                    await update_job(job_id, progress=min(0.50 + 0.48 * (_ai_done / _ai_total), 0.98))
                    _ai_done += 1

                try:
                    _result = await run_pipeline(
                        deployment_id=_dep_id,
                        steps=_steps,
                        confidence_threshold=0.2,
                        user_id=_user_id,
                        on_step=_on_step,
                    )
                    await emit_detection_notifications(_dep_id)
                    await emit_event(
                        job_id,
                        ProgressEvent(
                            type=EventType.FILE_SUCCESS,
                            phase=ProgressPhase.AI_PIPELINE,
                            message=(f"✅ AI analysis complete — deployment {_dep_id[:8]}: {_result.total_observations} observation(s) created"),
                        ),
                    )
                except Exception as _pipeline_err:
                    pipeline_errors += 1
                    logger.warning(
                        "auto_pipeline_failed",
                        deployment_id=_dep_id,
                        error=str(_pipeline_err),
                        job_id=job_id,
                    )
                    await emit_event(
                        job_id,
                        ProgressEvent(
                            type=EventType.FILE_FAILURE,
                            phase=ProgressPhase.AI_PIPELINE,
                            message=f"⚠️ AI analysis failed for deployment {_dep_id[:8]}: {_pipeline_err}",
                        ),
                    )
            await complete_phase(job_id, ProgressPhase.AI_PIPELINE)

        # ── Final status (Drive sync + AI pipeline done) ──────────────────
        job_data = await get_job(job_id)
        summary = job_data.summary if job_data else None
        failed_count = summary.failed if summary else 0
        uploaded_count = summary.uploaded if summary else 0
        skipped_count = summary.skipped if summary else 0

        final_status = JobStatus.COMPLETED_WITH_ERRORS if (failed_count > 0 or pipeline_errors > 0) else JobStatus.COMPLETED

        if final_status == JobStatus.COMPLETED_WITH_ERRORS:
            issue_parts = []
            if failed_count > 0:
                issue_parts.append(f"{failed_count} Drive error(s)")
            if pipeline_errors > 0:
                issue_parts.append(f"{pipeline_errors} AI error(s)")
            final_msg = f"⚠️ Done with issues — {uploaded_count} uploaded, {skipped_count} skipped, {', '.join(issue_parts)}"
        else:
            final_msg = f"✅ Done — {drive_total} images synced to Drive, AI analysis complete"

        await update_job(
            job_id,
            status=final_status,
            progress=1.0,
            message=final_msg,
        )

        logger.info(
            "job_complete",
            job_type="upload_drive_images",
            job_id=job_id,
            **stats,
        )

    except Exception as e:
        await update_job(
            job_id,
            status=JobStatus.FAILED,
            error=str(e),
            message=f"❌ Failed to upload to Google Drive: {str(e)}",
        )
        logger.error(
            "job_failed",
            job_type="upload_drive_images",
            job_id=job_id,
            error=str(e),
        )
        # Without ARQ, we don't auto-retry.
        return


async def backfill_thumbnails_job(job_id: str, deployment_id: str):
    """Generate thumbnail/preview renditions for a deployment's media (Media Registry)."""
    logger.info("job_start", job_type="backfill_thumbnails", job_id=job_id, deployment_id=deployment_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1, message="Generating thumbnails…")
    try:
        from app.domain.media_registry import backfill_thumbnails

        count = await backfill_thumbnails(deployment_id)
        await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0, message=f"Generated {count} thumbnails")
    except Exception as e:
        logger.error("job_failed", job_type="backfill_thumbnails", job_id=job_id, error=str(e))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))


async def embed_deployment_job(job_id: str, deployment_id: str, model_name: str | None = None):
    """Embed + cluster a deployment's animal crops (Wildlife Brain / DINOv3)."""
    logger.info("job_start", job_type="embed_deployment", job_id=job_id, deployment_id=deployment_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.05, message="Starting embedding…")

    async def _progress(pct: float, msg: str):
        await update_job(job_id, progress=pct, message=msg)

    try:
        from app.domain.wildlife_brain import embed_and_cluster_deployment

        result = await embed_and_cluster_deployment(deployment_id, model_name=model_name, progress=_progress)
        await update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=1.0,
            message=f"Embedded {result['image_count']} crops → {result['clusters']} clusters",
        )
    except Exception as e:
        logger.error("job_failed", job_type="embed_deployment", job_id=job_id, error=str(e))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))


async def reprocess_deployment_job(job_id: str, deployment_id: str, model_name: str | None = None):
    """Supersede current runs and re-embed a deployment (Phase 5.5)."""
    logger.info("job_start", job_type="reprocess_deployment", job_id=job_id, deployment_id=deployment_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.05, message="Reprocessing…")

    async def _progress(pct: float, msg: str):
        await update_job(job_id, progress=pct, message=msg)

    try:
        from app.domain.embedding_lifecycle import reprocess_deployment

        result = await reprocess_deployment(deployment_id, model_name=model_name, progress=_progress)
        await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0, message=f"Reprocessed {result['image_count']} crops")
    except Exception as e:
        logger.error("job_failed", job_type="reprocess_deployment", job_id=job_id, error=str(e))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))


async def reprocess_project_job(job_id: str, project_id: str, model_name: str | None = None):
    """Reprocess every deployment in a project (Phase 5.5)."""
    logger.info("job_start", job_type="reprocess_project", job_id=job_id, project_id=project_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.05, message="Reprocessing project…")

    async def _progress(pct: float, msg: str):
        await update_job(job_id, progress=pct, message=msg)

    try:
        from app.domain.embedding_lifecycle import reprocess_project

        result = await reprocess_project(project_id, model_name=model_name, progress=_progress)
        await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0, message=f"Reprocessed {result['deployments']} deployments")
    except Exception as e:
        logger.error("job_failed", job_type="reprocess_project", job_id=job_id, error=str(e))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))


async def reprocess_all_job(job_id: str, model_name: str | None = None):
    """Platform-wide re-embed (Phase 5.5). Caller must have confirmed."""
    logger.info("job_start", job_type="reprocess_all", job_id=job_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.02, message="Global re-embed…")

    async def _progress(pct: float, msg: str):
        await update_job(job_id, progress=pct, message=msg)

    try:
        from app.domain.embedding_lifecycle import reprocess_all

        result = await reprocess_all(model_name=model_name, dry_run=False, progress=_progress)
        await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0, message=f"Reprocessed {result['deployments']} deployments")
    except Exception as e:
        logger.error("job_failed", job_type="reprocess_all", job_id=job_id, error=str(e))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))


async def recompute_al_job(job_id: str, deployment_id: str):
    """Recompute active-learning scores for a deployment (Phase 8)."""
    logger.info("job_start", job_type="recompute_al", job_id=job_id, deployment_id=deployment_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1, message="Scoring media…")

    async def _progress(pct: float, msg: str):
        await update_job(job_id, progress=pct, message=msg)

    try:
        from app.domain.active_learning import recompute_scores

        count = await recompute_scores(deployment_id, progress=_progress)
        await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0, message=f"Scored {count} media")
    except Exception as e:
        logger.error("job_failed", job_type="recompute_al", job_id=job_id, error=str(e))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))


async def qdrant_backup_job(job_id: str):
    """Snapshot Qdrant and store it in the private backup bucket (Phase 5.5 DR)."""
    logger.info("job_start", job_type="qdrant_backup", job_id=job_id)
    await update_job(job_id, status=JobStatus.PROCESSING, progress=0.1, message="Creating Qdrant snapshot…")
    try:
        from app.domain.embedding_lifecycle import backup_qdrant_snapshot

        path = await backup_qdrant_snapshot()
        if path:
            await update_job(job_id, status=JobStatus.COMPLETED, progress=1.0, message=f"Backed up to {path}")
        else:
            await update_job(job_id, status=JobStatus.FAILED, error="Snapshot unavailable (Qdrant/Storage not configured)")
    except Exception as e:
        logger.error("job_failed", job_type="qdrant_backup", job_id=job_id, error=str(e))
        await update_job(job_id, status=JobStatus.FAILED, error=str(e))


JOBS = [
    convert_model_job,
    generate_manifest_job,
    export_camtrapdp_job,
    download_pretrained_job,
    download_github_pretrained_job,
    upload_drive_images_job,
    backfill_thumbnails_job,
    embed_deployment_job,
    reprocess_deployment_job,
    reprocess_project_job,
    reprocess_all_job,
    recompute_al_job,
    qdrant_backup_job,
]
