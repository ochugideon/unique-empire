from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.rules import DaySpan
from app.core.timeutil import local_date, utcnow
from app.database import lock_row
from app.models import Branch, BusinessDay, User
from app.services.audit import write_audit


def default_branch_id(db: Session):
    branch = db.scalar(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.created_at).limit(1))
    if branch is None:
        raise AppError(500, "NO_BRANCH", "The system has not been set up with a branch yet.")
    return branch.id


def get_open_day(db: Session, branch_id) -> BusinessDay | None:
    return db.scalar(select(BusinessDay).where(BusinessDay.branch_id == branch_id, BusinessDay.status == "OPEN"))


def require_open_day(db: Session, branch_id, *, lock: bool = False) -> BusinessDay:
    day = get_open_day(db, branch_id)
    if day is None:
        raise AppError(409, "NO_OPEN_DAY", "No business day is open. Ask the owner or manager to open one.")
    return lock_row(db, BusinessDay, day.id) if lock else day


def open_day(db: Session, *, user: User, branch_id, device_id=None) -> BusinessDay:
    if get_open_day(db, branch_id) is not None:
        raise AppError(409, "DAY_ALREADY_OPEN", "A business day is already open.")
    now = utcnow()
    day = BusinessDay(branch_id=branch_id, business_date=local_date(now), opened_at=now, opened_by=user.id, status="OPEN")
    db.add(day)
    try:
        db.flush()
    except IntegrityError:  # partial unique index: another request opened a day first
        db.rollback()
        raise AppError(409, "DAY_ALREADY_OPEN", "A business day is already open.")
    write_audit(db, actor_id=user.id, device_id=device_id, action="BUSINESS_DAY_OPEN", entity_type="business_day", entity_id=day.id)
    return day


def find_day_span(db: Session, branch_id, instant) -> DaySpan | None:
    """The business day whose [opened_at, closed_at) covers `instant` (used for expenses)."""
    day = db.scalar(
        select(BusinessDay)
        .where(
            BusinessDay.branch_id == branch_id,
            BusinessDay.opened_at <= instant,
            or_(BusinessDay.closed_at.is_(None), BusinessDay.closed_at > instant),
        )
        .order_by(BusinessDay.opened_at.desc())
        .limit(1)
    )
    if day is None:
        return None
    return DaySpan(day.id, day.status, day.opened_at, day.closed_at)
