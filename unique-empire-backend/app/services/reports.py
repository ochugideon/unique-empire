from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.jsonutil import to_json
from app.core.money import ZERO, quantize
from app.core.timeutil import local_date, utcnow
from app.models import BusinessDay, Expense, Payment, Sale, SaleItem

METHODS = ("CASH", "TRANSFER", "POS")
MAX_RANGE_DAYS = 366


def _dec(v) -> Decimal:
    return quantize(Decimal(str(v))) if v is not None else ZERO


def _bucket(period: str, business_date: date) -> str:
    if period == "daily":
        return business_date.isoformat()
    if period == "weekly":
        return (business_date - timedelta(days=business_date.weekday())).isoformat()  # week starting Monday
    if period == "monthly":
        return business_date.strftime("%Y-%m")
    return "range"


def _default_range(period: str) -> tuple[date, date]:
    today = local_date(utcnow())
    span = {"daily": 6, "weekly": 55, "monthly": 182}[period]
    return today - timedelta(days=span), today


def sales_report(db: Session, *, period: str, date_from: date | None, date_to: date | None, include_expenses: bool) -> dict:
    if period == "custom":
        if not (date_from and date_to):
            raise AppError(422, "RANGE_REQUIRED", "Custom reports need date_from and date_to.")
    elif not (date_from and date_to):
        date_from, date_to = _default_range(period)
    if date_from > date_to:
        raise AppError(422, "INVALID_RANGE", "date_from must not be after date_to.")
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise AppError(422, "RANGE_TOO_LARGE", "Choose a range of at most one year.")

    # Reports group by business day, not by calendar date (Architecture section 4).
    days = db.execute(
        select(BusinessDay.id, BusinessDay.business_date).where(BusinessDay.business_date >= date_from, BusinessDay.business_date <= date_to)
    ).all()
    day_date = {d_id: d for d_id, d in days}
    ids = list(day_date)

    def blank() -> dict:
        return {"business_days": 0, "completed_sales_total": ZERO, "completed_sales_count": 0, "items_sold": 0,
                "payments_by_method": {m: ZERO for m in METHODS}, "expenses_total": ZERO}

    buckets: dict[str, dict] = defaultdict(blank)
    if ids:
        done = (Sale.business_day_id.in_(ids), Sale.status == "COMPLETED")
        for day_id, count, total in db.execute(
            select(Sale.business_day_id, func.count(Sale.id), func.sum(Sale.total_amount)).where(*done).group_by(Sale.business_day_id)
        ):
            b = buckets[_bucket(period, day_date[day_id])]
            b["completed_sales_count"] += int(count)
            b["completed_sales_total"] += _dec(total)
        for day_id, qty in db.execute(
            select(Sale.business_day_id, func.sum(SaleItem.quantity)).select_from(SaleItem)
            .join(Sale, Sale.id == SaleItem.sale_id).where(*done).group_by(Sale.business_day_id)
        ):
            buckets[_bucket(period, day_date[day_id])]["items_sold"] += int(qty or 0)
        for day_id, method, amount in db.execute(
            select(Sale.business_day_id, Payment.method, func.sum(Payment.amount_applied)).select_from(Payment)
            .join(Sale, Sale.id == Payment.sale_id).where(*done).group_by(Sale.business_day_id, Payment.method)
        ):
            buckets[_bucket(period, day_date[day_id])]["payments_by_method"][method] += _dec(amount)
        if include_expenses:
            for day_id, amount in db.execute(
                select(Expense.business_day_id, func.sum(Expense.amount)).where(Expense.business_day_id.in_(ids)).group_by(Expense.business_day_id)
            ):
                buckets[_bucket(period, day_date[day_id])]["expenses_total"] += _dec(amount)
        for d in day_date.values():
            buckets[_bucket(period, d)]["business_days"] += 1

    rows, totals = [], blank()
    for key in sorted(buckets):
        b = buckets[key]
        rows.append({"bucket": key, **b})
        totals["business_days"] += b["business_days"]
        totals["completed_sales_total"] += b["completed_sales_total"]
        totals["completed_sales_count"] += b["completed_sales_count"]
        totals["items_sold"] += b["items_sold"]
        totals["expenses_total"] += b["expenses_total"]
        for m in METHODS:
            totals["payments_by_method"][m] += b["payments_by_method"][m]

    def finish(entry: dict) -> dict:
        if include_expenses:
            entry["sales_less_recorded_expenses"] = entry["completed_sales_total"] - entry["expenses_total"]  # never "profit"
        else:
            entry.pop("expenses_total", None)
        return entry

    return to_json({
        "period": period, "date_from": date_from, "date_to": date_to,
        "rows": [finish(r) for r in rows], "totals": finish(totals),
    })
