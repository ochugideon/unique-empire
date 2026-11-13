import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import Ctx, get_ctx, get_device_ctx, page_params
from app.core.errors import AppError, not_found
from app.database import get_db
from app.models import Sale
from app.schemas.common import Page
from app.schemas.sales import SaleCreate, SaleOut, SaleUpdate, VoidIn
from app.services import days as day_service
from app.services import sales as sale_service

router = APIRouter(prefix="/sales", tags=["sales"])


def _get_sale(db: Session, ctx: Ctx, sale_id: uuid.UUID) -> Sale:
    sale = db.get(Sale, sale_id)
    if sale is None or not sale_service.can_access(ctx.user, sale):
        raise not_found("Sale")
    return sale


@router.get("", response_model=Page[SaleOut])
def search_sales(
    reference: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    product: str | None = None,
    staff_id: uuid.UUID | None = None,
    status: Literal["ALL", "DRAFT", "COMPLETED", "VOIDED"] = "ALL",
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
    pp: tuple[int, int] = Depends(page_params),
):
    page, size = pp
    rows, total = sale_service.search_sales(
        db, ctx.user, reference=reference, date_from=date_from, date_to=date_to, product=product,
        staff_id=staff_id, status=status, page=page, page_size=size,
    )
    return Page[SaleOut](items=rows, total=total, page=page, page_size=size)


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(body: SaleCreate, ctx: Ctx = Depends(get_device_ctx), db: Session = Depends(get_db)):
    """Online create. A business day must be open (FR-082); prices come from the catalogue."""
    day = day_service.require_open_day(db, ctx.device.branch_id, lock=body.status == "COMPLETED")
    sale = sale_service.create_sale(db, user=ctx.user, device=ctx.device, data=body, day=day, offline=False)
    db.commit()
    return sale


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(sale_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    return _get_sale(db, ctx, sale_id)


@router.patch("/{sale_id}", response_model=SaleOut)
def update_sale(sale_id: uuid.UUID, body: SaleUpdate, ctx: Ctx = Depends(get_device_ctx), db: Session = Depends(get_db)):
    sale = _get_sale(db, ctx, sale_id)
    completion_day = day_service.require_open_day(db, ctx.device.branch_id, lock=True) if body.complete else None
    updated = sale_service.update_sale(db, user=ctx.user, device_id=ctx.device.id, sale=sale, data=body, completion_day=completion_day)
    db.commit()
    return updated


@router.post("/{sale_id}/complete", response_model=SaleOut)
def complete_sale(sale_id: uuid.UUID, body: SaleUpdate, ctx: Ctx = Depends(get_device_ctx), db: Session = Depends(get_db)):
    body.complete = True
    return update_sale(sale_id, body, ctx, db)


@router.post("/{sale_id}/void", response_model=SaleOut)
def void_sale(sale_id: uuid.UUID, body: VoidIn, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    sale = _get_sale(db, ctx, sale_id)
    voided = sale_service.void_sale(db, user=ctx.user, device_id=ctx.device.id if ctx.device else None, sale=sale,
                                    reason=body.reason, password=body.password)
    db.commit()
    return voided


@router.delete("/{sale_id}", status_code=204)
def delete_draft(sale_id: uuid.UUID, confirm: bool = Query(False), ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    if not confirm:  # FR-057: deletion needs explicit confirmation
        raise AppError(400, "CONFIRMATION_REQUIRED", "Add ?confirm=true to delete this draft.")
    sale = _get_sale(db, ctx, sale_id)
    sale_service.delete_draft(db, user=ctx.user, device_id=ctx.device.id if ctx.device else None, sale=sale)
    db.commit()
    return Response(status_code=204)
