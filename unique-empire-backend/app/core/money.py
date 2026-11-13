"""Exact money handling (NFR-010). Pure standard library: no floats anywhere."""
from decimal import Decimal, InvalidOperation

TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0.00")
MAX_MONEY = Decimal("9999999999.99")  # NUMERIC(12,2)


def quantize(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES)


def parse_money(value) -> Decimal:
    """Accept decimal strings (and ints). Floats are rejected on purpose."""
    if isinstance(value, bool) or isinstance(value, float):
        raise ValueError("Money must be sent as a decimal string such as \"3000.00\".")
    try:
        if isinstance(value, Decimal):
            number = value
        elif isinstance(value, int):
            number = Decimal(value)
        elif isinstance(value, str):
            number = Decimal(value.strip())
        else:
            raise ValueError("Money must be a decimal string.")
        if not number.is_finite():
            raise ValueError("Money must be a finite number.")
        rounded = number.quantize(TWO_PLACES)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Invalid money value; use a decimal string with at most 2 decimal places.") from exc
    if rounded != number:
        raise ValueError("Money allows at most 2 decimal places.")
    if abs(rounded) > MAX_MONEY:
        raise ValueError("Money value is too large.")
    return rounded


def fmt_money(value: Decimal) -> str:
    return f"{quantize(value):.2f}"


def to_kobo(value: Decimal) -> int:
    return int((quantize(value) * 100).to_integral_value())


def from_kobo(kobo: int) -> Decimal:
    return quantize(Decimal(kobo) / Decimal(100))
