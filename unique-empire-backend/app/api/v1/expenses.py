import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import OWNER_OR_MANAGER, Ctx, get_device_ctx, page_params
from app.core.errors import not_found
from app.database import get_db
from app.models import Expense
from app.schemas.common import Page
from app.schemas.ops import ExpenseAssignIn, ExpenseCreate, ExpenseOut, ExpenseReceipt
from app.services import expenses as expense_service

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.post("", response_model=ExpenseReceipt, status_code=201)
def record_expense(body: ExpenseCreate, ctx: Ctx = Depends(get_device_ctx), db: Session = Depends(get_db)):
    """Any staff member may record an expense; only owner/manager can read details back (FR-071/FR-075)."""
    expense, _ = expense_service.create_expense(db, user=ctx.user, device=ctx.device, data=body, offline=False)
    db.commit()
    return ExpenseReceipt(id=expense.id)


@router.get("", response_model=Page[ExpenseOut])
def list_expenses(
    unassigned: bool = False,
    day_id: uuid.UUID | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    ctx: Ctx = Depends(OWNER_OR_MANAGER),
    db: Session = Depends(get_db),
    pp: tuple[int, int] = Depends(page_params),
):
    page, size = pp
    rows, total = expense_service.list_expenses(
        db, unassigned=unassigned, day_id=day_id, category=category, date_from=date_from, date_to=date_to, page=page, page_size=size
    )
    return Page[ExpenseOut](items=rows, total=total, page=page, page_size=size)


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: uuid.UUID, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise not_found("Expense")
    return expense


@router.patch("/{expense_id}/assign-day", response_model=ExpenseOut)
def assign_day(expense_id: uuid.UUID, body: ExpenseAssignIn, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    expense = expense_service.assign_expense_day(
        db, user=ctx.user, device_id=ctx.device.id if ctx.device else None,
        expense_id=expense_id, day_id=body.business_day_id, reason=body.reason,
    )
    db.commit()
    return expense
