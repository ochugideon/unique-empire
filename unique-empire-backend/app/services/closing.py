import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.core import rules
from app.core.errors import AppError, not_found
from app.core.jsonutil import to_json
from app.core.money import ZERO, quantize
from app.core.security import verify_password
from app.core.timeutil import utcnow
from app.database import lock_row
from app.models import BusinessDay, DailyClosing, Device, Expense, Payment, Sale, SaleItem, SyncRecord, User
from app.schemas.ops import ClosingIn
from app.services.audit import write_audit

METHODS = ("CASH", "TRANSFER", "POS")
EXPENSE_KEYS = ("expenses_total", "expenses_by_category", "expenses_by_method", "sales_less_recorded_expenses")


def _dec(value) -> Decimal:
    return quantize(Decimal(str(value))) if value is not None else ZERO


def compute_summary(db: Session, day: BusinessDay) -> dict:
    """Reproducible from the underlying records (Architecture 4.1)."""
    completed = (Sale.business_day_id == day.id, Sale.status == "COMPLETED")
    count, total = db.execute(
        select(func.count(Sale.id), func.coalesce(func.sum(Sale.total_amount), 0)).where(*completed)
    ).one()
    voided = db.scalar(select(func.count(Sale.id)).where(Sale.business_day_id == day.id, Sale.status == "VOIDED")) or 0
    items_sold = db.scalar(
        select(func.coalesce(func.sum(SaleItem.quantity), 0))
        .select_from(SaleItem).join(Sale, Sale.id == SaleItem.sale_id).where(*completed)
    ) or 0
    product_rows = db.execute(
        select(SaleItem.product_name, SaleItem.variant_name, func.sum(SaleItem.quantity), func.sum(SaleItem.subtotal))
        .select_from(SaleItem).join(Sale, Sale.id == SaleItem.sale_id).where(*completed)
        .group_by(SaleItem.product_name, SaleItem.variant_name)
        .order_by(SaleItem.product_name, SaleItem.variant_name)
    ).all()
    payment_rows = db.execute(
        select(Payment.method, func.sum(Payment.amount_applied))
        .select_from(Payment).join(Sale, Sale.id == Payment.sale_id).where(*completed)
        .group_by(Payment.method)
    ).all()
    expense_rows = db.execute(
        select(Expense.category, Expense.payment_method, func.sum(Expense.amount))
        .where(Expense.business_day_id == day.id)
        .group_by(Expense.category, Expense.payment_method)
    ).all()

    payments_by_method = {m: ZERO for m in METHODS}
    for method, amount in payment_rows:
        payments_by_method[method] = _dec(amount)
    expenses_by_method = {m: ZERO for m in METHODS}
    expenses_by_category: dict[str, Decimal] = {}
    for category, method, amount in expense_rows:
        expenses_by_method[method] += _dec(amount)
        expenses_by_category[category] = expenses_by_category.get(category, ZERO) + _dec(amount)
    expenses_total = sum(expenses_by_method.values(), ZERO)
    sales_total = _dec(total)

    return {
        "business_day_id": str(day.id),
        "business_date": day.business_date.isoformat(),
        "status": day.status,
        "currency_code": settings.currency_code,
        "completed_sales_total": sales_total,
        "completed_sales_count": int(count),
        "voided_sales_count": int(voided),
        "items_sold": int(items_sold),
        "products": [
            {"product": p, "variant": v, "quantity": int(q), "amount": _dec(a)} for p, v, q, a in product_rows
        ],
        "payments_by_method": payments_by_method,
        "expenses_total": expenses_total,
        "expenses_by_category": expenses_by_category,
        "expenses_by_method": expenses_by_method,
        # Never labelled profit (FR-116).
        "sales_less_recorded_expenses": sales_total - expenses_total,
    }


def strip_expenses(summary: dict) -> dict:
    return {k: v for k, v in summary.items() if k not in EXPENSE_KEYS}


def expected_by_method(summary: dict) -> dict:
    """Expected drawer/account totals: sales received minus expenses paid by that method."""
    return {m: summary["payments_by_method"][m] - summary["expenses_by_method"][m] for m in METHODS}


def stale_devices(db: Session, branch_id) -> list[Device]:
    now = utcnow()
    devices = db.scalars(select(Device).where(Device.branch_id == branch_id, Device.status == "ACTIVE")).all()
    return [
        d for d in devices
        if rules.device_is_stale(d.last_reported_at, d.pending_count, now, settings.device_stale_hours)
    ]


def _warnings(db: Session, branch_id) -> list[dict]:
    warnings = []
    drafts = db.scalar(select(func.count(Sale.id)).where(Sale.branch_id == branch_id, Sale.status == "DRAFT")) or 0
    if drafts:
        warnings.append({"code": "DRAFTS_REMAIN", "count": drafts, "message": f"{drafts} unfinished draft(s) remain. Drafts do not block closing."})
    held = db.scalar(select(func.count(SyncRecord.id)).where(SyncRecord.needs_review.is_(True), SyncRecord.resolved_at.is_(None))) or 0
    if held:
        warnings.append({"code": "SYNC_REVIEW_PENDING", "count": held, "message": f"{held} synchronization item(s) await review."})
    unassigned = db.scalar(select(func.count(Expense.id)).where(Expense.branch_id == branch_id, Expense.business_day_id.is_(None))) or 0
    if unassigned:
        warnings.append({"code": "UNASSIGNED_EXPENSES", "count": unassigned, "message": f"{unassigned} expense(s) are not assigned to a business day."})
    return warnings


def _next_version(db: Session, day_id) -> int:
    return (db.scalar(select(func.coalesce(func.max(DailyClosing.version), 0)).where(DailyClosing.business_day_id == day_id)) or 0) + 1


def _new_closing(db, *, day, user, kind, status, summary, expected, actual, diffs, explanations, reason=None, exceptional=None):
    closing = DailyClosing(
        id=uuid.uuid4(),
        business_day_id=day.id,
        version=_next_version(db, day.id),
        kind=kind,
        status=status,
        summary=to_json({**summary, "expected_by_method": expected, "actual_by_method": actual, "differences": diffs}),
        expected_cash=expected["CASH"], expected_transfer=expected["TRANSFER"], expected_pos=expected["POS"],
        actual_cash=actual["CASH"], actual_transfer=actual["TRANSFER"], actual_pos=actual["POS"],
        explanations=explanations,
        reason=reason,
        exceptional_reason=exceptional,
        prepared_by=user.id,
        approved_by=user.id if status == "FINAL" else None,
        currency_code=settings.currency_code,
        created_at=utcnow(),
    )
    db.add(closing)
    db.flush()
    return closing


def close_day(db: Session, *, user: User, device_id, day_id, data: ClosingIn):
    day = lock_row(db, BusinessDay, day_id)  # blocks concurrent sale completion on this day
    if day is None:
        raise not_found("Business day")
    if day.status != "OPEN":
        raise AppError(409, "DAY_NOT_OPEN", "This business day is already closed.")

    summary = compute_summary(db, day)
    expected = expected_by_method(summary)
    actual = {"CASH": data.actual_cash, "TRANSFER": data.actual_transfer, "POS": data.actual_pos}
    diffs = rules.reconcile(expected, actual)
    explanations = {k.upper(): v.strip() for k, v in data.explanations.items() if v and v.strip()}
    warnings = _warnings(db, day.branch_id)
    exceptional = None

    if data.finalize:
        missing = [m for m, d in diffs.items() if d != 0 and not explanations.get(m)]
        if missing:  # FR-096
            raise AppError(422, "EXPLANATION_REQUIRED", "Every discrepancy needs an explanation.", {"methods": missing})
        stale = stale_devices(db, day.branch_id)
        if stale:  # FR-125..FR-128
            if not data.exceptional_closing_reason:
                raise AppError(
                    409, "DEVICES_NOT_SYNCED", "Some devices have not synchronized. Ask the owner to authorize an exception if a device is unavailable.",
                    {"devices": [{"id": str(d.id), "name": d.name, "code": d.device_code, "pending_count": d.pending_count,
                                  "last_reported_at": d.last_reported_at.isoformat() if d.last_reported_at else None} for d in stale]},
                )
            if user.role != "OWNER":
                raise AppError(403, "OWNER_ONLY_EXCEPTION", "Only the owner can authorize closing with an unsynchronized device.")
            exceptional = data.exceptional_closing_reason

    closing = _new_closing(
        db, day=day, user=user, kind="CLOSE", status="FINAL" if data.finalize else "PREPARED",
        summary=summary, expected=expected, actual=actual, diffs=diffs, explanations=explanations, exceptional=exceptional,
    )
    if data.finalize:
        day.status, day.closed_at, day.closed_by = "CLOSED", utcnow(), user.id
        write_audit(
            db, actor_id=user.id, device_id=device_id,
            action="EXCEPTIONAL_CLOSE" if exceptional else "BUSINESS_DAY_CLOSE",
            entity_type="business_day", entity_id=day.id,
            after={"closing_version": closing.version, "differences": diffs, "explanations": explanations},
            reason=exceptional,
        )
    return closing, warnings


def reopen_day(db: Session, *, user: User, device_id, day_id, reason: str, password: str) -> BusinessDay:
    if not verify_password(password, user.password_hash):
        raise AppError(403, "REAUTH_FAILED", "Password confirmation failed.")
    day = lock_row(db, BusinessDay, day_id)
    if day is None:
        raise not_found("Business day")
    if day.status != "CLOSED":
        raise AppError(409, "DAY_NOT_CLOSED", "Only a closed business day can be reopened.")
    other = db.scalar(select(BusinessDay.id).where(BusinessDay.branch_id == day.branch_id, BusinessDay.status == "OPEN"))
    if other is not None:
        raise AppError(409, "ANOTHER_DAY_OPEN", "Close the currently open business day before reopening an older one.")
    day.status = "OPEN"
    day.reopen_count += 1
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "ANOTHER_DAY_OPEN", "Close the currently open business day before reopening an older one.")
    write_audit(db, actor_id=user.id, device_id=device_id, action="BUSINESS_DAY_REOPEN", entity_type="business_day",
                entity_id=day.id, reason=reason)
    return day


def create_adjustment_version(db: Session, *, user: User, device_id, day: BusinessDay, reason: str) -> DailyClosing:
    """Post-close adjustment: recompute expected totals and append a NEW closing version.

    The counted (actual) amounts are carried over from the last final version and the
    adjustment reason is recorded; earlier versions are never modified (FR-103).
    """
    previous = db.scalar(
        select(DailyClosing)
        .where(DailyClosing.business_day_id == day.id, DailyClosing.status == "FINAL")
        .order_by(DailyClosing.version.desc()).limit(1)
    )
    if previous is None:
        raise AppError(409, "NO_FINAL_CLOSING", "This day has no finalized closing to adjust.")
    summary = compute_summary(db, day)
    expected = expected_by_method(summary)
    actual = {"CASH": previous.actual_cash, "TRANSFER": previous.actual_transfer, "POS": previous.actual_pos}
    explanations = dict(previous.explanations or {})
    explanations["ADJUSTMENT"] = reason
    closing = _new_closing(
        db, day=day, user=user, kind="ADJUSTMENT", status="FINAL", summary=summary, expected=expected,
        actual=actual, diffs=rules.reconcile(expected, actual), explanations=explanations, reason=reason,
    )
    write_audit(db, actor_id=user.id, device_id=device_id, action="CLOSING_ADJUSTED", entity_type="business_day",
                entity_id=day.id, after={"closing_version": closing.version}, reason=reason)
    return closing
