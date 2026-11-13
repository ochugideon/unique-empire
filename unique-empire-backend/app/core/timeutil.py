from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.config import settings

BUSINESS_TZ = ZoneInfo(settings.business_timezone)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def to_local(value: datetime) -> datetime:
    return ensure_aware(value).astimezone(BUSINESS_TZ)


def local_date(value: datetime) -> date:
    return to_local(value).date()


def local_day_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC [start, end) of a local (Africa/Lagos) calendar day."""
    start = datetime.combine(day, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    return start, end
