import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import rules
from app.core.errors import AppError, not_found
from app.core.timeutil import ensure_aware, utcnow
from app.models import BusinessDay, Device, Expense, User
from app.schemas.ops import ExpenseCreate
from app.services.audit import write_audit
from app.services.closing import create_adjustment_version
from app.services.days import find_day_span
from app.services.sales import FUTURE_TOLERANCE


def create_expense(
    db: Session,
    *,
    user: User,
    device: Device,
    data: ExpenseCreate,
    offline: bool,
    received_at: datetime | None = None,
    forced_day: BusinessDay | None = None,
) -> tuple[Expense, rules.ExpenseAssignment]:
    now = utcnow()
    entered_at = ensure_aware(data.entered_at) if (offline and data.entered_at) else now
    occurred_at = ensure_aware(data.occurred_at) if data.occurred_at else entered_at
    if occurred_at > now + FUTURE_TOLERANCE or entered_at > now + FUTURE_TOLERANCE:
        raise AppError(400, "TIME_IN_FUTURE", "The recorded time is in the future. Check the device clock.")
    expense_id = data.id or uuid.uuid4()
    if db.get(Expense, expense_id) is not None:
        raise AppError(409, "DUPLICATE_ID", "An expense with this id already exists.")

    if forced_day is not None:  # owner/manager decision from the review queue
        assignment = rules.ExpenseAssignment(forced_day.id, "REVIEW")
    else:
        at_occurred = find_day_span(db, device.branch_id, occurred_at)
        at_entered = at_occurred if entered_at == occurred_at else find_day_span(db, device.branch_id, entered_at)
        assignment = rules.choose_expense_day(at_occurred, at_entered)

    expense = Expense(
        id=expense_id,
        branch_id=device.branch_id,
        business_day_id=assignment.day_id,
        suggested_business_day_id=assignment.adjustment_day_id,
        amount=data.amount,
        category=data.category,
        description=data.description.strip(),
        payment_method=data.payment_method,
        occurred_at=occurred_at,
        entered_at=entered_at,
        received_at=received_at or now,
        created_by=user.id,
        device_id=device.id,
        assignment_rule=assignment.rule,
        currency_code="NGN",
        updated_at=now,
    )
    db.add(expense)
    db.flush()
    return expense, assignment


def assign_expense_day(db: Session, *, user: User, device_id, expense_id, day_id, reason: str) -> Expense:
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise not_found("Expense")
    if expense.business_day_id is not None:
        raise AppError(409, "ALREADY_ASSIGNED", "This expense is already assigned to a business day.")
    day = db.get(BusinessDay, day_id)
    if day is None or day.branch_id != expense.branch_id:
        raise not_found("Business day")
    expense.business_day_id = day.id
    expense.suggested_business_day_id = None
    expense.assignment_rule = "MANUAL"
    expense.updated_at = utcnow()
    write_audit(db, actor_id=user.id, device_id=device_id, action="EXPENSE_ASSIGNED_DAY", entity_type="expense",
                entity_id=expense.id, after={"business_day_id": str(day.id)}, reason=reason)
    db.flush()
    if day.status == "CLOSED":  # post-close adjustment: new closing version (FR-077/FR-078)
        create_adjustment_version(db, user=user, device_id=device_id, day=day, reason=reason)
    return expense


def list_expenses(db: Session, *, unassigned=None, day_id=None, category=None, date_from=None, date_to=None, page=1, page_size=25):
    from sqlalchemy import func
    from app.core.timeutil import local_day_bounds

    query = select(Expense)
    if unassigned:
        query = query.where(Expense.business_day_id.is_(None))
    if day_id:
        query = query.where(Expense.business_day_id == day_id)
    if category:
        query = query.where(Expense.category == category)
    if date_from:
        query = query.where(Expense.occurred_at >= local_day_bounds(date_from)[0])
    if date_to:
        query = query.where(Expense.occurred_at < local_day_bounds(date_to)[1])
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(Expense.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return rows, total
