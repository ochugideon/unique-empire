import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import Money, NonNegMoney, OrmModel, PositiveMoney, Reason
from app.schemas.sales import PaymentMethod

# ------------------------------------------------------------------ devices
class DeviceRegisterIn(BaseModel):
    device_identifier: str = Field(min_length=8, max_length=100)
    device_code: str = Field(pattern=r"^[A-Z0-9]{2,4}$")
    name: str = Field(min_length=2, max_length=100)


class DeviceStatusIn(BaseModel):
    status: Literal["ACTIVE", "LOST", "REVOKED"]
    reason: Reason


class HeartbeatIn(BaseModel):
    pending_count: int = Field(ge=0)


class DeviceOut(OrmModel):
    id: uuid.UUID
    branch_id: uuid.UUID
    device_identifier: str
    device_code: str
    name: str
    status: str
    status_reason: str | None
    registered_at: datetime
    last_sync_at: datetime | None
    last_reported_at: datetime | None
    pending_count: int
    reference_counter: int
    is_stale: bool = False


# ------------------------------------------------------------------ business days / closing
class BusinessDayOut(OrmModel):
    id: uuid.UUID
    branch_id: uuid.UUID
    business_date: date
    opened_at: datetime
    closed_at: datetime | None
    opened_by: uuid.UUID
    closed_by: uuid.UUID | None
    status: str
    reopen_count: int


class ClosingIn(BaseModel):
    actual_cash: NonNegMoney
    actual_transfer: NonNegMoney
    actual_pos: NonNegMoney
    explanations: dict[str, str] = {}   # keys: CASH / TRANSFER / POS
    finalize: bool = False              # false = prepare a version only
    exceptional_closing_reason: Reason | None = None  # owner only (FR-127)


class ClosingOut(OrmModel):
    id: uuid.UUID
    business_day_id: uuid.UUID
    version: int
    kind: str
    status: str
    summary: dict
    expected_cash: Money
    expected_transfer: Money
    expected_pos: Money
    actual_cash: Money
    actual_transfer: Money
    actual_pos: Money
    explanations: dict | None
    reason: str | None
    exceptional_reason: str | None
    prepared_by: uuid.UUID
    approved_by: uuid.UUID | None
    currency_code: str
    created_at: datetime


class CloseResult(BaseModel):
    closing: ClosingOut
    warnings: list[dict]


class ReopenIn(BaseModel):
    reason: Reason
    password: str


# ------------------------------------------------------------------ expenses
ExpenseCategory = Literal["ingredients", "transport", "electricity", "packaging", "maintenance", "other"]


class ExpenseCreate(BaseModel):
    id: uuid.UUID | None = None
    amount: PositiveMoney
    category: ExpenseCategory
    description: str = Field(min_length=2, max_length=500)
    payment_method: PaymentMethod
    occurred_at: datetime | None = None
    entered_at: datetime | None = None   # honoured for offline uploads only
    user_id: uuid.UUID | None = None


class ExpenseAssignIn(BaseModel):
    business_day_id: uuid.UUID
    reason: Reason


class ExpenseOut(OrmModel):
    id: uuid.UUID
    business_day_id: uuid.UUID | None
    suggested_business_day_id: uuid.UUID | None
    amount: Money
    category: str
    description: str
    payment_method: str
    occurred_at: datetime
    entered_at: datetime
    received_at: datetime
    created_by: uuid.UUID
    device_id: uuid.UUID | None
    assignment_rule: str
    currency_code: str


class ExpenseReceipt(BaseModel):
    """What an attendant gets back: no expense details are exposed to them (FR-075)."""
    id: uuid.UUID
    status: str = "RECORDED"


# ------------------------------------------------------------------ sync
class SyncRecordIn(BaseModel):
    idempotency_key: uuid.UUID
    record_type: Literal["SALE", "SALE_UPDATE", "EXPENSE"]
    payload: dict


class SyncUploadIn(BaseModel):
    records: list[SyncRecordIn] = Field(max_length=200)
    pending_remaining: int | None = Field(default=None, ge=0)
    # Set by the client when re-sending records already synced before a restore.
    resync_after_restore: bool = False


class SyncResult(BaseModel):
    idempotency_key: uuid.UUID
    outcome: Literal["ACCEPTED", "REJECTED", "CONFLICT", "ERROR"]
    reason_code: str | None = None
    reason_detail: str | None = None
    entity_id: uuid.UUID | None = None
    duplicate: bool = False


class SyncUploadOut(BaseModel):
    results: list[SyncResult]
    server_time: datetime


class SyncRecordOut(OrmModel):
    id: uuid.UUID
    record_type: str
    device_id: uuid.UUID
    user_id: uuid.UUID
    outcome: str
    reason_code: str | None
    reason_detail: str | None
    payload: dict | None
    entity_id: uuid.UUID | None
    needs_review: bool
    received_at: datetime
    resolved_by: uuid.UUID | None
    resolved_at: datetime | None
    resolution: str | None
    resolution_reason: str | None


class ResolveIn(BaseModel):
    action: Literal["ATTACH_TO_CLOSED_DAY", "ASSIGN_TO_OPEN_DAY", "REJECT"]
    reason: Reason
    business_day_id: uuid.UUID | None = None


# ------------------------------------------------------------------ audit / technical / restoration
class AuditOut(OrmModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    device_id: uuid.UUID | None
    action: str
    entity_type: str | None
    entity_id: str | None
    before: dict | None
    after: dict | None
    reason: str | None
    created_at: datetime


class TechnicalEventOut(OrmModel):
    id: uuid.UUID
    severity: str
    event_type: str
    message: str
    context: dict | None
    device_id: uuid.UUID | None
    created_at: datetime
    resolved: bool
    resolved_at: datetime | None


class RestorationRequestIn(BaseModel):
    password: str
    reason: Reason
    recovery_point: datetime
    acknowledge_data_loss: bool


class RestorationRequestOut(BaseModel):
    request_id: uuid.UUID
    status: str
    message: str
