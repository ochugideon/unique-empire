from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Ctx, get_ctx
from app.core.jsonutil import to_json
from app.core.timeutil import utcnow
from app.database import get_db
from app.models import BusinessDay, Expense, SyncRecord
from app.services import closing as closing_service
from app.services import days as day_service
from app.services.reports import sales_report

router = APIRouter(tags=["reports"])


@router.get("/reports/summary")
def summary(
    period: Literal["daily", "weekly", "monthly", "custom"] = "daily",
    date_from: date | None = None,
    date_to: date | None = None,
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
):
    """In-app tables and numbers only (FR-112/FR-113). Expense figures are owner/manager only."""
    return sales_report(db, period=period, date_from=date_from, date_to=date_to,
                        include_expenses=ctx.user.role in ("OWNER", "MANAGER"))


@router.get("/dashboard")
def dashboard(ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    """Current business-day progress plus the previous closed day (FR-105..FR-109). The client polls every 15 s."""
    branch_id = ctx.branch_id(db)
    privileged = ctx.user.role in ("OWNER", "MANAGER")
    open_day = day_service.get_open_day(db, branch_id)
    previous = db.scalar(
        select(BusinessDay).where(BusinessDay.branch_id == branch_id, BusinessDay.status == "CLOSED")
        .order_by(BusinessDay.closed_at.desc()).limit(1)
    )

    def view(day):
        if day is None:
            return None
        data = closing_service.compute_summary(db, day)
        return data if privileged else closing_service.strip_expenses(data)

    result = {
        "server_time": utcnow(),
        "business_day_status": "OPEN" if open_day else "CLOSED",
        "current_day": view(open_day),
        "previous_day": view(previous),
    }
    if privileged:
        result["review_queue_count"] = db.scalar(
            select(func.count(SyncRecord.id)).where(SyncRecord.needs_review.is_(True), SyncRecord.resolved_at.is_(None))
        ) or 0
        result["unassigned_expenses"] = db.scalar(
            select(func.count(Expense.id)).where(Expense.branch_id == branch_id, Expense.business_day_id.is_(None))
        ) or 0
    return to_json(result)
