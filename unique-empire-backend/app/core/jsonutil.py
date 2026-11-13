import re
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

from app.core.money import fmt_money

_SENSITIVE = re.compile(r"pass|token|secret|authorization|cookie|card|cvv|\bpin\b", re.IGNORECASE)


def to_json(value):
    """JSON-safe copy: Decimal -> exact string, UUID/datetime -> str (never floats for money)."""
    if isinstance(value, Decimal):
        return fmt_money(value)
    if isinstance(value, (UUID,)):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(k): to_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json(v) for v in value]
    return value


def scrub(value):
    """Remove secrets from payloads/contexts before they are stored or logged."""
    if isinstance(value, dict):
        return {k: ("***" if _SENSITIVE.search(str(k)) else scrub(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value
