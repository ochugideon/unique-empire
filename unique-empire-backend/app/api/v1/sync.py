import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import OWNER_OR_MANAGER, Ctx, get_ctx, get_device_ctx
from app.core.timeutil import utcnow
from app.database import get_db
from app.models import SyncRecord
from app.schemas.ops import DeviceOut, ResolveIn, SyncRecordOut, SyncUploadIn, SyncUploadOut
from app.services import sync as sync_service

router = APIRouter(prefix="/sync", tags=["synchronization"])


@router.post("/upload", response_model=SyncUploadOut)
def upload(body: SyncUploadIn, ctx: Ctx = Depends(get_device_ctx), db: Session = Depends(get_db)):
    results = sync_service.process_upload(db, user=ctx.user, device=ctx.device, body=body)
    db.commit()
    return SyncUploadOut(results=results, server_time=utcnow())


@router.get("/status")
def status(ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    """Device sync state plus this user's own failed/conflicting records (staff can see their own, FR-155)."""
    failed = db.scalars(
        select(SyncRecord)
        .where(SyncRecord.user_id == ctx.user.id, SyncRecord.outcome != "ACCEPTED")
        .order_by(SyncRecord.received_at.desc()).limit(50)
    ).all()
    data = {
        "server_time": utcnow(),
        "device": DeviceOut.model_validate(ctx.device) if ctx.device else None,
        "my_failed_records": [
            {"id": r.id, "record_type": r.record_type, "outcome": r.outcome, "reason_code": r.reason_code,
             "reason_detail": r.reason_detail, "resolved": r.resolved_at is not None, "resolution": r.resolution,
             "received_at": r.received_at}
            for r in failed
        ],
    }
    if ctx.user.role in ("OWNER", "MANAGER"):
        data["review_queue_count"] = db.scalar(
            select(func.count(SyncRecord.id)).where(SyncRecord.needs_review.is_(True), SyncRecord.resolved_at.is_(None))
        ) or 0
    return data


@router.get("/review", response_model=list[SyncRecordOut])
def review_queue(ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    return sync_service.list_review_queue(db)


@router.post("/review/{key}/resolve", response_model=SyncRecordOut)
def resolve(key: uuid.UUID, body: ResolveIn, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    record = sync_service.resolve_held(db, user=ctx.user, device_id=ctx.device.id if ctx.device else None, key=key, data=body)
    db.commit()
    return record
