from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, Header, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Ctx, get_ctx
from app.config import settings
from app.core.errors import AppError
from app.core.ratelimit import limiter
from app.core.security import (
    DUMMY_HASH, create_access_token, hash_password, hash_token, new_refresh_token, verify_password,
)
from app.core.timeutil import utcnow
from app.database import get_db
from app.models import Device, User, UserSession
from app.schemas.auth import ChangePasswordIn, LoginIn, LoginOut, TokenOut, UserOut, ChangeUsernameIn
from app.schemas.common import Message
from app.services.audit import write_audit

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE = "ue_refresh"
CSRF_HEADER, CSRF_VALUE = "x-requested-with", "UniqueEmpire"


def _csrf(request: Request) -> None:
    # Cookie-based, state-changing endpoints need a custom header (cannot be sent cross-site without CORS approval).
    if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise AppError(403, "CSRF_CHECK_FAILED", "Missing or invalid request header.")


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE, token, max_age=settings.refresh_token_days * 86400, httponly=True,
        secure=settings.cookie_secure, samesite="strict", path="/api/v1/auth",
    )


def _offline_expiry():
    return utcnow() + timedelta(days=settings.offline_authorization_days)


@router.post("/login", response_model=LoginOut)
@limiter.limit(settings.login_rate_limit)
def login(
    request: Request,
    response: Response,
    body: LoginIn,
    db: Session = Depends(get_db),
    x_device_id: str | None = Header(default=None),
):
    now = utcnow()
    username = body.username.strip().lower()
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        verify_password(body.password, DUMMY_HASH)  # keep timing similar
        write_audit(db, actor_id=None, action="LOGIN_FAILED", after={"username": username[:50]})
        db.commit()
        raise AppError(401, "INVALID_CREDENTIALS", "Incorrect username or password.")

    if user.locked_until and user.locked_until > now:
        raise AppError(423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.")

    if not verify_password(body.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= settings.max_failed_logins:  # FR-008
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_login_attempts = 0
            write_audit(db, actor_id=user.id, action="ACCOUNT_LOCKED", entity_type="user", entity_id=user.id)
        else:
            write_audit(db, actor_id=user.id, action="LOGIN_FAILED", entity_type="user", entity_id=user.id)
        db.commit()
        raise AppError(401, "INVALID_CREDENTIALS", "Incorrect username or password.")

    if not user.is_active:  # FR-013
        raise AppError(403, "ACCOUNT_DISABLED", "This account has been deactivated.")

    user.failed_login_attempts = 0
    user.locked_until = None
    device = db.scalar(select(Device).where(Device.device_identifier == x_device_id, Device.status == "ACTIVE")) if x_device_id else None
    token, token_hash = new_refresh_token()
    session = UserSession(
        user_id=user.id, device_id=device.id if device else None, refresh_token_hash=token_hash,
        created_at=now, last_seen_at=now, expires_at=now + timedelta(days=settings.refresh_token_days),
    )
    db.add(session)
    db.flush()
    write_audit(db, actor_id=user.id, device_id=device.id if device else None, action="LOGIN", entity_type="session", entity_id=session.id)
    db.commit()
    _set_cookie(response, token)
    return LoginOut(
        access_token=create_access_token(user.id, session.id),
        expires_in=settings.access_token_minutes * 60,
        user=UserOut.model_validate(user),
        device_id=device.id if device else None,
        offline_authorization_expires_at=_offline_expiry(),
    )


@router.post("/refresh", response_model=TokenOut)
@limiter.limit(settings.login_rate_limit)
def refresh(request: Request, response: Response, db: Session = Depends(get_db), ue_refresh: str | None = Cookie(default=None)):
    _csrf(request)
    if not ue_refresh:
        raise AppError(401, "NOT_AUTHENTICATED", "Please sign in.")
    now = utcnow()
    token_hash = hash_token(ue_refresh)
    session = db.scalar(select(UserSession).where(UserSession.refresh_token_hash == token_hash))
    if session is None:
        reused = db.scalar(select(UserSession).where(UserSession.previous_refresh_token_hash == token_hash))
        if reused is not None and reused.revoked_at is None:  # rotated token presented again => theft signal
            reused.revoked_at, reused.revoked_reason = now, "REFRESH_REUSE"
            write_audit(db, actor_id=reused.user_id, action="SESSION_REVOKED_REUSE", entity_type="session", entity_id=reused.id)
            db.commit()
        raise AppError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.")
    user = db.get(User, session.user_id)
    if session.revoked_at or session.expires_at <= now or user is None or not user.is_active:
        raise AppError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.")
    if now - session.last_seen_at > timedelta(minutes=settings.inactivity_minutes):
        session.revoked_at, session.revoked_reason = now, "INACTIVITY"
        write_audit(db, actor_id=user.id, action="SESSION_TIMEOUT", entity_type="session", entity_id=session.id)
        db.commit()
        raise AppError(401, "SESSION_TIMEOUT", "You were signed out after a period of inactivity.")

    token, new_hash = new_refresh_token()
    session.previous_refresh_token_hash = session.refresh_token_hash
    session.refresh_token_hash = new_hash
    session.last_seen_at = now
    db.commit()
    _set_cookie(response, token)
    return TokenOut(
        access_token=create_access_token(user.id, session.id),
        expires_in=settings.access_token_minutes * 60,
        offline_authorization_expires_at=_offline_expiry(),
    )


@router.post("/logout", response_model=Message)
def logout(request: Request, response: Response, db: Session = Depends(get_db), ue_refresh: str | None = Cookie(default=None)):
    _csrf(request)
    if ue_refresh:
        session = db.scalar(select(UserSession).where(UserSession.refresh_token_hash == hash_token(ue_refresh)))
        if session is not None and session.revoked_at is None:
            session.revoked_at, session.revoked_reason = utcnow(), "LOGOUT"
            write_audit(db, actor_id=session.user_id, action="LOGOUT", entity_type="session", entity_id=session.id)
            db.commit()
    response.delete_cookie(COOKIE, path="/api/v1/auth")
    return Message(message="Signed out.")


@router.get("/me", response_model=UserOut)
def me(ctx: Ctx = Depends(get_ctx)):
    return ctx.user


@router.post("/change-password", response_model=Message)
def change_password(body: ChangePasswordIn, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, ctx.user.password_hash):
        raise AppError(403, "REAUTH_FAILED", "Current password is incorrect.")
    ctx.user.password_hash = hash_password(body.new_password)
    now = utcnow()
    db.execute(  # sign out every other session
        update(UserSession)
        .where(UserSession.user_id == ctx.user.id, UserSession.revoked_at.is_(None), UserSession.id != ctx.session.id)
        .values(revoked_at=now, revoked_reason="PASSWORD_CHANGED")
    )
    write_audit(db, actor_id=ctx.user.id, action="PASSWORD_CHANGED", entity_type="user", entity_id=ctx.user.id)
    db.commit()
    return Message(message="Password changed.")

@router.post("/change-username", response_model=UserOut)
def change_username(body: ChangeUsernameIn, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    if not verify_password(body.password, ctx.user.password_hash):
        raise AppError(403, "REAUTH_FAILED", "Password is incorrect.")
    old, new = ctx.user.username, body.username
    if new == old:
        raise AppError(400, "USERNAME_UNCHANGED", "That is already your username.")
    if db.scalar(select(User.id).where(User.username == new, User.id != ctx.user.id)) is not None:
        raise AppError(409, "USERNAME_TAKEN", "That username is already in use.")
    ctx.user.username = new
    write_audit(db, actor_id=ctx.user.id, device_id=ctx.device.id if ctx.device else None, action="USERNAME_CHANGED",
                entity_type="user", entity_id=ctx.user.id, before={"username": old}, after={"username": new})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "USERNAME_TAKEN", "That username is already in use.")
    return ctx.user