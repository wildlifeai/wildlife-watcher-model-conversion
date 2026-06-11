# Copyright (c) 2024
# SPDX-License-Identifier: GPL-3.0-or-later
"""Email notification channel — provider-agnostic sender.

One interface, swappable provider behind ``EMAIL_PROVIDER``:
  - ``none``      → no-op stub that logs ``[email stub]`` (default; web channel still works)
  - ``resend``    → Resend HTTP API (RESEND_API_KEY)
  - ``sendgrid``  → Twilio SendGrid HTTP API (SENDGRID_API_KEY)
  - ``azure_acs`` → Azure Communication Services Email (ACS_CONNECTION_STRING)

Only the stub is wired today (provider decision deferred). Adding a real provider is a
single function below — nothing else in the notifications path changes. All sends are
best-effort: failures are logged, never raised, so they can't break the pipeline.
"""

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()


async def send_email(to: str, subject: str, body: str) -> bool:
    """Send one notification email. Returns True if dispatched (or stubbed), False on error."""
    if not to:
        return False
    provider = (settings.EMAIL_PROVIDER or "none").lower()

    if provider == "none":
        logger.info("email_stub", to=to, subject=subject)
        return True

    sender = settings.EMAIL_FROM
    if not sender:
        logger.warning("email_not_sent_missing_from", provider=provider)
        return False

    try:
        if provider == "resend":
            return await _send_resend(sender, to, subject, body)
        if provider == "sendgrid":
            return await _send_sendgrid(sender, to, subject, body)
        if provider == "azure_acs":
            return await _send_azure_acs(sender, to, subject, body)
        logger.warning("email_unknown_provider", provider=provider)
        return False
    except Exception as exc:  # noqa: BLE001 — email is non-critical
        logger.warning("email_send_failed", provider=provider, to=to, error=str(exc))
        return False


async def _send_resend(sender: str, to: str, subject: str, body: str) -> bool:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={"from": sender, "to": [to], "subject": subject, "text": body},
        )
    ok = r.status_code in (200, 201)
    if not ok:
        logger.warning("email_resend_error", status=r.status_code, body=r.text[:300])
    return ok


async def _send_sendgrid(sender: str, to: str, subject: str, body: str) -> bool:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}"},
            json={
                "personalizations": [{"to": [{"email": to}]}],
                "from": {"email": sender},
                "subject": subject,
                "content": [{"type": "text/plain", "value": body}],
            },
        )
    ok = r.status_code in (200, 202)
    if not ok:
        logger.warning("email_sendgrid_error", status=r.status_code, body=r.text[:300])
    return ok


async def _send_azure_acs(sender: str, to: str, subject: str, body: str) -> bool:
    # Placeholder for the Azure Communication Services Email SDK/REST. Wire when chosen.
    logger.warning("email_azure_acs_not_implemented", to=to)
    return False


def email_enabled() -> bool:
    """True when a real provider is configured (i.e. not the no-op stub)."""
    return (settings.EMAIL_PROVIDER or "none").lower() != "none"
