# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""In-app notifications — emit rows into the `notifications` table (service role).

After an AI run, notify a project's users of species detections, honouring each user's
`notification_rules` (which species, which channels). Users *without* a rule fall back to
a sensible default: pest species → web notification. Everything is best-effort and
resilient — missing tables or query failures silently no-op so the pipeline is never
affected. Email goes through the provider-agnostic `email_channel` (a no-op stub until a
provider is configured). Phase 5.
"""

import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone

import structlog

from app.services.email_channel import send_email
from app.services.supabase_client import create_service_client

logger = structlog.get_logger()

# Default watch set for users with no explicit rule (case-insensitive substring match).
# Superseded per-user by notification_rules.
WATCHED_KEYWORDS = [
    "rat",
    "rattus",
    "stoat",
    "weasel",
    "mustela",
    "ferret",
    "possum",
    "trichosurus",
    "cat",
    "felis",
    "hedgehog",
    "erinaceus",
]


def _is_watched(name: str | None) -> bool:
    if not name:
        return False
    low = name.lower()
    return any(k in low for k in WATCHED_KEYWORDS)


def _project_member_ids(svc, project_id: str) -> list[str]:
    try:
        rows = (
            svc.table("user_roles")
            .select("user_id")
            .eq("scope_type", "project")
            .eq("scope_id", project_id)
            .eq("is_active", True)
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
    except Exception:
        return []
    return sorted({r["user_id"] for r in rows if r.get("user_id")})


def _species_rules(svc, project_id: str) -> dict:
    """user_id → rule, for active species_detection rules on the project."""
    try:
        rows = (
            svc.table("notification_rules")
            .select("user_id, species_filter, channels, digest")
            .eq("project_id", project_id)
            .eq("event_type", "species_detection")
            .eq("is_active", True)
            .execute()
            .data
            or []
        )
    except Exception:
        return {}  # table not deployed / no access → no explicit rules
    return {r["user_id"]: r for r in rows if r.get("user_id")}


def _emails(svc, user_ids: list[str]) -> dict:
    if not user_ids:
        return {}
    try:
        rows = svc.table("users").select("id, email").in_("id", user_ids).execute().data or []
    except Exception:
        return {}
    return {r["id"]: r["email"] for r in rows if r.get("email")}


async def emit_detection_notifications(deployment_id: str, recent_minutes: int = 30) -> int:
    """Notify project users of species detections from the latest AI run.

    Honours per-user notification_rules; users without a rule get the pest default on the
    web channel. Only observations created in the last ``recent_minutes`` count, so re-runs
    don't re-notify. Returns the number of web notifications created.
    """

    def _gather() -> tuple[list[tuple[str, str, str]], int]:
        svc = create_service_client()
        dep = svc.table("deployments").select("project_id, location_name").eq("id", deployment_id).limit(1).execute().data
        if not dep or not dep[0].get("project_id"):
            return [], 0
        project_id = dep[0]["project_id"]
        location = dep[0].get("location_name") or "a deployment"

        since = (datetime.now(timezone.utc) - timedelta(minutes=recent_minutes)).isoformat()
        obs = (
            svc.table("observations")
            .select("scientific_name, vernacular_name")
            .eq("deployment_id", deployment_id)
            .eq("source_type", "ai")
            .gte("created_at", since)
            .execute()
            .data
            or []
        )
        detected: Counter = Counter()
        for o in obs:
            name = o.get("scientific_name") or o.get("vernacular_name")
            if name:
                detected[name] += 1
        if not detected:
            return [], 0

        members = _project_member_ids(svc, project_id)
        if not members:
            return [], 0
        rules = _species_rules(svc, project_id)
        emails = _emails(svc, [u for u in members if rules.get(u, {}).get("channels") and "email" in rules[u]["channels"]])

        web_rows: list[dict] = []
        email_tasks: list[tuple[str, str, str]] = []
        link = f"/annotations?deployment={deployment_id}"

        for uid in members:
            rule = rules.get(uid)
            if rule is not None:
                channels = rule.get("channels") or ["web"]
                filt = (rule.get("species_filter") or "").lower()
                matching = {n: c for n, c in detected.items() if not filt or filt in n.lower()}
            else:
                channels = ["web"]
                matching = {n: c for n, c in detected.items() if _is_watched(n)}
            if not matching:
                continue

            summary = ", ".join(f"{n} (×{c})" for n, c in sorted(matching.items(), key=lambda kv: -kv[1]))
            title = f"⚠ Species detected at {location}"
            body = f"{summary} in your latest upload."

            if "web" in channels:
                web_rows.append(
                    {
                        "user_id": uid,
                        "project_id": project_id,
                        "deployment_id": deployment_id,
                        "type": "species_detection",
                        "title": title,
                        "body": body,
                        "data": {"species": matching, "count": sum(matching.values()), "link": link},
                    }
                )
            if "email" in channels and (rule or {}).get("digest", "immediate") == "immediate":
                to = emails.get(uid)
                if to:
                    email_tasks.append((to, title, f"{body}\n\nView in Wildlife Watcher: {link}"))

        if web_rows:
            try:
                svc.table("notifications").insert(web_rows).execute()
            except Exception as exc:
                logger.warning("notifications_emit_skipped", error=str(exc), deployment_id=deployment_id)
                web_rows = []

        return email_tasks, len(web_rows)

    try:
        email_tasks, web_count = await asyncio.to_thread(_gather)
    except Exception as exc:  # noqa: BLE001 — notifications are non-critical
        logger.warning("notifications_emit_failed", error=str(exc), deployment_id=deployment_id)
        return 0

    for to, subject, body in email_tasks:
        await send_email(to, subject, body)

    if web_count or email_tasks:
        logger.info("notifications_emitted", web=web_count, emails=len(email_tasks), deployment_id=deployment_id)
    return web_count
