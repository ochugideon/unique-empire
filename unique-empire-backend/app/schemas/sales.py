import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import Money, NonNegMoney, OrmModel, PositiveMoney, Reason

PaymentMethod = Literal["CASH", "TRANSFER", "POS"]


class ItemIn(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0, le=10000)
    # Honoured only for offline sync uploads (price snapshot at the time of sale);
    # online requests always use the current catalogue price.
    unit_price: NonNegMoney | None = None


class PaymentIn(BaseModel):
    method: PaymentMethod
    amount_applied: PositiveMoney
    cash_received: NonNegMoney | None = None  # CASH only; change is computed by the server


class SaleCreate(BaseModel):
    id: uuid.UUID | None = None
    reference: str | None = Field(default=None, max_length=32)
    status: Literal["DRAFT", "COMPLETED"] = "DRAFT"
    items: list[ItemIn] = Field(min_length=1)
    payments: list[PaymentIn] = []
    # Offline metadata (ignored for online calls except where noted in the docs).
    occurred_at: datetime | None = None
    entered_at: datetime | None = None
    business_day_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None


class SaleUpdate(BaseModel):
    version: int = Field(ge=1)
    items: list[ItemIn] | None = None
    payments: list[PaymentIn] | None = None
    complete: bool = False
    reason: Reason | None = None
    # Offline completion metadata
    occurred_at: datetime | None = None
    business_day_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None


class SaleUpdateSync(SaleUpdate):
    sale_id: uuid.UUID


class VoidIn(BaseModel):
    reason: Reason
    password: str


class SaleItemOut(OrmModel):
    id: uuid.UUID
    product_id: uuid.UUID
    variant_id: uuid.UUID
    product_name: str
    variant_name: str
    quantity: int
    unit_price: Money
    subtotal: Money
    price_flagged: bool


class PaymentOut(OrmModel):
    id: uuid.UUID
    method: PaymentMethod
    amount_applied: Money
    cash_received: Money | None
    change_given: Money | None


class SaleOut(OrmModel):
    id: uuid.UUID
    reference: str
    status: Literal["DRAFT", "COMPLETED", "VOIDED"]
    version: int
    branch_id: uuid.UUID
    device_id: uuid.UUID
    created_by: uuid.UUID
    staff_name: str | None
    draft_business_day_id: uuid.UUID | None
    business_day_id: uuid.UUID | None
    total_amount: Money
    currency_code: str
    occurred_at: datetime
    entered_at: datetime
    received_at: datetime
    completed_at: datetime | None
    voided_at: datetime | None
    void_reason: str | None
    items: list[SaleItemOut]
    payments: list[PaymentOut]
