from datetime import datetime
from decimal import Decimal
from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, PlainSerializer, StringConstraints

from app.core.money import fmt_money, parse_money


def _non_negative(value: Decimal) -> Decimal:
    if value < 0:
        raise ValueError("Amount cannot be negative.")
    return value


def _positive(value: Decimal) -> Decimal:
    if value <= 0:
        raise ValueError("Amount must be greater than zero.")
    return value


# Decimal strings on the wire ("3000.00"); floats are rejected (NFR-010).
Money = Annotated[
    Decimal,
    BeforeValidator(parse_money),
    PlainSerializer(fmt_money, return_type=str, when_used="json"),
]
NonNegMoney = Annotated[Money, AfterValidator(_non_negative)]
PositiveMoney = Annotated[Money, AfterValidator(_positive)]

Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    model_config = ConfigDict(from_attributes=True)

    items: list[T]
    total: int
    page: int
    page_size: int


class Message(BaseModel):
    message: str


def utc_iso(value: datetime | None):
    return value.isoformat() if value else None
