import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import OWNER_ONLY, Ctx, get_ctx, get_device_ctx
from app.config import settings
from app.core import rules
from app.core.errors import AppError, not_found
from app.core.timeutil import utcnow
from app.database import get_db
from app.models import Device
from app.schemas.ops import DeviceOut, DeviceRegisterIn, DeviceStatusIn, HeartbeatIn
from app.services.audit import write_audit
from app.services.days import default_branch_id

router = APIRouter(prefix="/devices", tags=["devices"])


def _out(device: Device) -> DeviceOut:
    out = DeviceOut.model_validate(device)
    out.is_stale = device.status == "ACTIVE" and rules.device_is_stale(
        device.last_reported_at, device.pending_count, utcnow(), settings.device_stale_hours
    )
    return out


@router.get("", response_model=list[DeviceOut])
def list_devices(ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    return [_out(d) for d in db.scalars(select(Device).order_by(Device.registered_at)).all()]


@router.post("", response_model=DeviceOut, status_code=201)
def register_device(body: DeviceRegisterIn, ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    if db.scalar(select(Device.id).where(Device.device_identifier == body.device_identifier)):
        raise AppError(409, "DEVICE_EXISTS", "This device identifier is already registered.")
    if db.scalar(select(Device.id).where(Device.device_code == body.device_code)):
        # Codes are never reused, so sale references can never repeat.
        raise AppError(409, "DEVICE_CODE_TAKEN", "That device code has been used before. Choose a new one.")
    device = Device(
        branch_id=default_branch_id(db), device_identifier=body.device_identifier, device_code=body.device_code,
        name=body.name.strip(), registered_by=ctx.user.id,
    )
    db.add(device)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "DEVICE_EXISTS", "This device identifier or code is already registered.")
    write_audit(db, actor_id=ctx.user.id, device_id=ctx.device.id if ctx.device else None, action="DEVICE_REGISTERED",
                entity_type="device", entity_id=device.id, after={"code": device.device_code, "name": device.name})
    db.commit()
    return _out(device)


@router.patch("/{device_id}/status", response_model=DeviceOut)
def change_status(device_id: uuid.UUID, body: DeviceStatusIn, ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("Device")
    if device.status == "REVOKED":
        raise AppError(409, "DEVICE_REVOKED", "A revoked device cannot be restored. Register it again with a new code.")
    before = device.status
    device.status, device.status_reason = body.status, body.reason
    write_audit(db, actor_id=ctx.user.id, device_id=ctx.device.id if ctx.device else None,
                action={"LOST": "DEVICE_MARKED_LOST", "REVOKED": "DEVICE_REVOKED", "ACTIVE": "DEVICE_REACTIVATED"}[body.status],
                entity_type="device", entity_id=device.id, before={"status": before}, after={"status": body.status}, reason=body.reason)
    db.commit()
    return _out(device)


@router.get("/me", response_model=DeviceOut)
def my_device(ctx: Ctx = Depends(get_device_ctx)):
    return _out(ctx.device)


@router.post("/me/heartbeat", response_model=DeviceOut)
def heartbeat(body: HeartbeatIn, ctx: Ctx = Depends(get_device_ctx), db: Session = Depends(get_db)):
    ctx.device.last_reported_at = utcnow()
    ctx.device.pending_count = body.pending_count
    db.commit()
    return _out(ctx.device)
