import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import OWNER_ONLY, Ctx
from app.core.errors import AppError, not_found
from app.core.security import hash_password
from app.core.timeutil import utcnow
from app.database import get_db
from app.models import User, UserSession
from app.schemas.auth import ResetPasswordIn, UserCreate, UserOut, UserUpdate
from app.schemas.common import Message
from app.services.audit import write_audit

router = APIRouter(prefix="/users", tags=["staff"])


def _revoke_sessions(db: Session, user_id, reason: str) -> None:
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
    )


@router.get("", response_model=list[UserOut])
def list_users(ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.full_name)).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(User.username == body.username)):
        raise AppError(409, "USERNAME_TAKEN", "That username is already in use.")
    user = User(username=body.username, full_name=body.full_name.strip(), password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "USERNAME_TAKEN", "That username is already in use.")
    write_audit(db, actor_id=ctx.user.id, device_id=ctx.device.id if ctx.device else None, action="STAFF_CREATED",
                entity_type="user", entity_id=user.id, after={"username": user.username, "role": user.role})
    db.commit()
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: UserUpdate, ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    if user.id == ctx.user.id and (body.is_active is False or (body.role and body.role != user.role)):
        raise AppError(409, "CANNOT_CHANGE_SELF", "You cannot deactivate or change the role of your own account.")
    before = {"full_name": user.full_name, "role": user.role, "is_active": user.is_active}
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.is_active is False or (body.role is not None and body.role != before["role"]):
        _revoke_sessions(db, user.id, "ACCOUNT_CHANGED")  # FR-013: deactivated users lose access immediately online
    action = "STAFF_DEACTIVATED" if body.is_active is False else "STAFF_REACTIVATED" if body.is_active and not before["is_active"] else "STAFF_UPDATED"
    write_audit(db, actor_id=ctx.user.id, device_id=ctx.device.id if ctx.device else None, action=action,
                entity_type="user", entity_id=user.id, before=before,
                after={"full_name": user.full_name, "role": user.role, "is_active": user.is_active})
    db.commit()
    return user


@router.post("/{user_id}/reset-password", response_model=Message)
def reset_password(user_id: uuid.UUID, body: ResetPasswordIn, ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    user.password_hash = hash_password(body.new_password)
    user.failed_login_attempts, user.locked_until = 0, None
    _revoke_sessions(db, user.id, "PASSWORD_RESET")
    write_audit(db, actor_id=ctx.user.id, device_id=ctx.device.id if ctx.device else None, action="STAFF_PASSWORD_RESET",
                entity_type="user", entity_id=user.id)
    db.commit()
    return Message(message="Password reset. The staff member has been signed out everywhere.")
