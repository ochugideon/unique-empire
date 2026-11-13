import uuid
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Header, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.errors import AppError, forbidden
from app.core.security import decode_access_token
from app.core.timeutil import utcnow
from app.database import get_db
from app.models import Device, User, UserSession
from app.services.audit import write_audit
from app.services.days import default_branch_id

bearer = HTTPBearer(auto_error=False)


@dataclass
class Ctx:
    user: User
    session: UserSession
    device: Device | None  # resolved from the X-Device-Id header, if present and known

    def branch_id(self, db: Session):
        return self.device.branch_id if self.device else default_branch_id(db)


def get_ctx(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    x_device_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Ctx:
    if creds is None:
        raise AppError(401, "NOT_AUTHENTICATED", "Please sign in.")
    claims = decode_access_token(creds.credentials)
    session = db.get(UserSession, uuid.UUID(claims["sid"]))
    now = utcnow()
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        raise AppError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise AppError(401, "ACCOUNT_DISABLED", "This account is not active.")

    idle = now - session.last_seen_at
    if idle > timedelta(minutes=settings.inactivity_minutes):  # FR-009
        session.revoked_at, session.revoked_reason = now, "INACTIVITY"
        write_audit(db, actor_id=user.id, action="SESSION_TIMEOUT", entity_type="session", entity_id=session.id)
        db.commit()  # saved records stay saved (FR-010); the session is what ends
        raise AppError(401, "SESSION_TIMEOUT", "You were signed out after a period of inactivity.")
    if idle.total_seconds() > 30:
        session.last_seen_at = now
        db.commit()

    device = None
    if x_device_id:
        device = db.scalar(select(Device).where(Device.device_identifier == x_device_id))
    return Ctx(user=user, session=session, device=device)


def require_roles(*roles: str):
    def dependency(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        if ctx.user.role not in roles:
            raise forbidden()
        return ctx
    return dependency


OWNER_ONLY = require_roles("OWNER")
OWNER_OR_MANAGER = require_roles("OWNER", "MANAGER")


def get_device_ctx(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    """For endpoints that create business records: the request must come from an active registered device."""
    if ctx.device is None:
        raise AppError(400, "DEVICE_REQUIRED", "This device is not registered. Ask the owner to register it.")
    if ctx.device.status != "ACTIVE":
        raise AppError(403, "DEVICE_NOT_ACTIVE", "This device has been disabled. Contact the owner.")
    return ctx


def page_params(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)) -> tuple[int, int]:
    return page, page_size
