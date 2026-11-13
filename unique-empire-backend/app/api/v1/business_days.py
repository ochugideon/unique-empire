import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import OWNER_OR_MANAGER, Ctx, get_ctx, page_params
from app.core.errors import not_found
from app.core.jsonutil import to_json
from app.database import get_db
from app.models import BusinessDay, DailyClosing
from app.schemas.common import Page
from app.schemas.ops import BusinessDayOut, CloseResult, ClosingIn, ClosingOut, ReopenIn
from app.services import closing as closing_service
from app.services import days as day_service
from sqlalchemy import func

router = APIRouter(prefix="/business-days", tags=["business days"])


def _device_id(ctx: Ctx):
    return ctx.device.id if ctx.device else None


@router.get("/current", response_model=BusinessDayOut | None)
def current_day(ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    return day_service.get_open_day(db, ctx.branch_id(db))


@router.get("", response_model=Page[BusinessDayOut])
def list_days(ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db), pp: tuple[int, int] = Depends(page_params)):
    page, size = pp
    total = db.scalar(select(func.count(BusinessDay.id))) or 0
    rows = db.scalars(select(BusinessDay).order_by(BusinessDay.opened_at.desc()).offset((page - 1) * size).limit(size)).all()
    return Page[BusinessDayOut](items=rows, total=total, page=page, page_size=size)


@router.post("/open", response_model=BusinessDayOut, status_code=201)
def open_day(ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    day = day_service.open_day(db, user=ctx.user, branch_id=ctx.branch_id(db), device_id=_device_id(ctx))
    db.commit()
    return day


@router.get("/{day_id}/summary")
def day_summary(day_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    """Sales summary for everyone; expense details only for owner/manager (FR-091/FR-092)."""
    day = db.get(BusinessDay, day_id)
    if day is None:
        raise not_found("Business day")
    summary = closing_service.compute_summary(db, day)
    if ctx.user.role not in ("OWNER", "MANAGER"):
        summary = closing_service.strip_expenses(summary)
    return to_json(summary)


@router.post("/{day_id}/close", response_model=CloseResult)
def close_day(day_id: uuid.UUID, body: ClosingIn, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    closing, warnings = closing_service.close_day(db, user=ctx.user, device_id=_device_id(ctx), day_id=day_id, data=body)
    db.commit()
    return CloseResult(closing=ClosingOut.model_validate(closing), warnings=warnings)


@router.post("/{day_id}/reopen", response_model=BusinessDayOut)
def reopen_day(day_id: uuid.UUID, body: ReopenIn, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    day = closing_service.reopen_day(db, user=ctx.user, device_id=_device_id(ctx), day_id=day_id, reason=body.reason, password=body.password)
    db.commit()
    return day


@router.get("/{day_id}/closings", response_model=list[ClosingOut])
def closing_history(day_id: uuid.UUID, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    return db.scalars(select(DailyClosing).where(DailyClosing.business_day_id == day_id).order_by(DailyClosing.version)).all()
