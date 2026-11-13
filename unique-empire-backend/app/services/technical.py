import json
import logging
import uuid

from app import database
from app.core.jsonutil import scrub, to_json
from app.core.timeutil import utcnow
from app.models import TechnicalEvent

logger = logging.getLogger("unique_empire.technical")


def record_technical_event(severity: str, event_type: str, message: str, context: dict | None = None, device_id=None) -> None:
    """Store a technical event for the owner view (FR-145, FR-158).

    Uses its own session so a failed request transaction cannot block it. If the database is
    unavailable the event goes to structured logs (which are forwarded to monitoring).
    """
    safe_context = scrub(to_json(context or {}))
    try:
        with database.SessionLocal() as session:
            session.add(
                TechnicalEvent(
                    id=uuid.uuid4(),
                    severity=severity,
                    event_type=event_type,
                    message=message[:500],
                    context=safe_context,
                    device_id=device_id,
                    created_at=utcnow(),
                )
            )
            session.commit()
    except Exception:  # database down: fall back to structured logs
        logger.error(
            json.dumps(
                {
                    "technical_event": {
                        "severity": severity,
                        "event_type": event_type,
                        "message": message,
                        "context": safe_context,
                        "fallback": "database_unavailable",
                    }
                },
                default=str,
            )
        )
