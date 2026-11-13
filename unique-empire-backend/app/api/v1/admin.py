import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import OWNER_ONLY, Ctx, page_params
from app.core.errors import not_found
from app.core.timeutil import local_day_bounds, utcnow
from app.database import get_db
from app.models import AuditLog, TechnicalEvent
from app.schemas.common import Page
from app.schemas.ops import (
    AuditOut, RestorationRequestIn, RestorationRequestOut, TechnicalEventOut,
)
from app.services import restoration as restoration_service

router = APIRouter(tags=["owner administration"])


@router.get("/audit-logs", response_model=Page[AuditOut])
def audit_logs(
    action: str | None = None,
    actor_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    ctx: Ctx = Depends(OWNER_ONLY),
    db: Session = Depends(get_db),
    pp: tuple[int, int] = Depends(page_params),
):
    page, size = pp
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action == action)
    if actor_id:
        query = query.where(AuditLog.actor_id == actor_id)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if date_from:
        query = query.where(AuditLog.created_at >= local_day_bounds(date_from)[0])
    if date_to:
        query = query.where(AuditLog.created_at < local_day_bounds(date_to)[1])
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(AuditLog.created_at.desc()).offset((page - 1) * size).limit(size)).all()
    return Page[AuditOut](items=rows, total=total, page=page, page_size=size)


@router.get("/technical-events", response_model=Page[TechnicalEventOut])
def technical_events(
    unresolved_only: bool = Query(False),
    ctx: Ctx = Depends(OWNER_ONLY),
    db: Session = Depends(get_db),
    pp: tuple[int, int] = Depends(page_params),
):
    page, size = pp
    query = select(TechnicalEvent)
    if unresolved_only:
        query = query.where(TechnicalEvent.resolved.is_(False))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(TechnicalEvent.created_at.desc()).offset((page - 1) * size).limit(size)).all()
    return Page[TechnicalEventOut](items=rows, total=total, page=page, page_size=size)


@router.post("/technical-events/{event_id}/resolve", response_model=TechnicalEventOut)
def resolve_event(event_id: uuid.UUID, ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    event = db.get(TechnicalEvent, event_id)
    if event is None:
        raise not_found("Technical event")
    event.resolved, event.resolved_by, event.resolved_at = True, ctx.user.id, utcnow()
    db.commit()
    return event


@router.post("/restoration-requests", response_model=RestorationRequestOut, status_code=202)
def request_restoration(body: RestorationRequestIn, ctx: Ctx = Depends(OWNER_ONLY), db: Session = Depends(get_db)):
    """Records the request (audit + external append-only log). It never executes a restore itself."""
    request_id = restoration_service.create_request(db, user=ctx.user, device_id=ctx.device.id if ctx.device else None, data=body)
    db.commit()
    return RestorationRequestOut(
        request_id=request_id, status="RECORDED",
        message="Your request has been recorded and handed to the administrator. Nothing has been restored yet.",
    )
