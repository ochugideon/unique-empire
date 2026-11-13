import json
import os
import uuid

from sqlalchemy.orm import Session

from app.config import settings
from app.core.errors import AppError
from app.core.security import verify_password
from app.core.timeutil import utcnow
from app.models import User
from app.schemas.ops import RestorationRequestIn
from app.services.audit import write_audit


def append_external_log(entry: dict) -> None:
    """Append-only JSON line on storage OUTSIDE the database being restored (FR-157)."""
    path = settings.restoration_log_path
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, sort_keys=True) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
    except OSError as exc:
        raise AppError(503, "RESTORATION_LOG_UNAVAILABLE",
                       "The restoration log is not available, so the request cannot be recorded safely. Nothing was submitted.") from exc


def create_request(db: Session, *, user: User, device_id, data: RestorationRequestIn) -> uuid.UUID:
    if not verify_password(data.password, user.password_hash):
        raise AppError(403, "REAUTH_FAILED", "Password confirmation failed.")
    if not data.acknowledge_data_loss:  # FR-144
        raise AppError(400, "ACKNOWLEDGEMENT_REQUIRED",
                       "You must acknowledge that data created after the chosen recovery point will be lost.")
    request_id = uuid.uuid4()
    entry = {
        "event": "RESTORATION_REQUESTED",
        "request_id": str(request_id),
        "requested_by": str(user.id),
        "requested_by_username": user.username,
        "recovery_point": data.recovery_point.isoformat(),
        "reason": data.reason,
        "requested_at": utcnow().isoformat(),
    }
    append_external_log(entry)  # written first: if it fails, no request exists
    write_audit(db, actor_id=user.id, device_id=device_id, action="RESTORATION_REQUESTED", entity_type="restoration",
                entity_id=request_id, after={"recovery_point": data.recovery_point.isoformat()}, reason=data.reason)
    return request_id
