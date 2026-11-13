"""Pure business rules from SRS v1.1 / Architecture v1.1 (no framework imports).

Kept dependency-free so the rules can be unit-tested without a database.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Mapping, Optional

REFERENCE_RE = re.compile(r"^UE-([A-Z0-9]{2,4})-(\d{6})-(\d{3,})$")
DEVICE_CODE_RE = re.compile(r"^[A-Z0-9]{2,4}$")


# ---------------------------------------------------------------- references (FR-151)
@dataclass(frozen=True)
class ParsedReference:
    device_code: str
    yymmdd: str
    counter: int


def format_reference(device_code: str, created_on: date, counter: int) -> str:
    return f"UE-{device_code}-{created_on:%y%m%d}-{counter:03d}"


def parse_reference(reference: str) -> Optional[ParsedReference]:
    match = REFERENCE_RE.match(reference or "")
    if not match:
        return None
    return ParsedReference(match.group(1), match.group(2), int(match.group(3)))


# ---------------------------------------------------------------- offline sale -> day (FR-154, Arch 4.2)
class Disposition(str, Enum):
    ATTACH = "ATTACH"
    HOLD_BEFORE_CLOSE = "HOLD_BEFORE_CLOSE"  # day closed, sale happened before the close
    HOLD_AFTER_CLOSE = "HOLD_AFTER_CLOSE"    # device missed the close


def classify_offline_sale(day_status: str, closed_at: Optional[datetime], occurred_at: datetime) -> Disposition:
    if day_status == "OPEN":
        return Disposition.ATTACH
    if closed_at is None or occurred_at < closed_at:
        return Disposition.HOLD_BEFORE_CLOSE
    return Disposition.HOLD_AFTER_CLOSE


# ---------------------------------------------------------------- expense -> day (FR-156)
@dataclass(frozen=True)
class DaySpan:
    id: object
    status: str
    opened_at: datetime
    closed_at: Optional[datetime]


def span_contains(span: DaySpan, instant: datetime) -> bool:
    return span.opened_at <= instant and (span.closed_at is None or instant < span.closed_at)


@dataclass(frozen=True)
class ExpenseAssignment:
    day_id: object          # day to attach to now, or None
    rule: str               # OCCURRED_AT | ENTERED_AT | NEEDS_ADJUSTMENT | UNASSIGNED
    adjustment_day_id: object = None  # closed day an owner/manager may attach it to


def choose_expense_day(at_occurred: Optional[DaySpan], at_entered: Optional[DaySpan]) -> ExpenseAssignment:
    """(1) day open at occurred_at, (2) else day open at entry, (3) else unassigned.

    If the matching day is already closed the expense is NOT attached silently: it
    waits for the owner/manager post-close adjustment workflow.
    """
    if at_occurred is not None:
        if at_occurred.status == "OPEN":
            return ExpenseAssignment(at_occurred.id, "OCCURRED_AT")
        return ExpenseAssignment(None, "NEEDS_ADJUSTMENT", at_occurred.id)
    if at_entered is not None:
        if at_entered.status == "OPEN":
            return ExpenseAssignment(at_entered.id, "ENTERED_AT")
        return ExpenseAssignment(None, "NEEDS_ADJUSTMENT", at_entered.id)
    return ExpenseAssignment(None, "UNASSIGNED")


# ---------------------------------------------------------------- reconciliation (FR-093..FR-097)
def reconcile(expected: Mapping[str, Decimal], actual: Mapping[str, Decimal]) -> dict:
    """Difference per method: actual - expected (negative = short)."""
    return {method: actual[method] - expected[method] for method in expected}


# ---------------------------------------------------------------- device readiness (Arch section 14)
def device_is_stale(last_reported_at: Optional[datetime], pending_count: int, now: datetime, stale_hours: int) -> bool:
    if last_reported_at is None or pending_count > 0:
        return True
    return now - last_reported_at > timedelta(hours=stale_hours)
