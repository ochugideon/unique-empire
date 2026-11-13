"""The 16 tables of Architecture v1.1 section 4."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timeutil import utcnow
from app.database import Base

ROLES = ("OWNER", "MANAGER", "ATTENDANT")
PAYMENT_METHODS = ("CASH", "TRANSFER", "POS")
EXPENSE_CATEGORIES = ("ingredients", "transport", "electricity", "packaging", "maintenance", "other")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


class Branch(Base):
    __tablename__ = "branches"
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="ck_users_role"),)
    id: Mapped[uuid.UUID] = _pk()
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint(_in("status", ("ACTIVE", "LOST", "REVOKED")), name="ck_devices_status"),
    )
    id: Mapped[uuid.UUID] = _pk()
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    device_identifier: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    # Never reused, even after revocation, so references can never collide (FR-151).
    device_code: Mapped[str] = mapped_column(String(4), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(10), default="ACTIVE")
    status_reason: Mapped[str | None] = mapped_column(String(500), default=None)
    registered_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    registered_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_sync_at: Mapped[datetime | None] = mapped_column(default=None)
    last_reported_at: Mapped[datetime | None] = mapped_column(default=None)
    pending_count: Mapped[int] = mapped_column(Integer, default=0)
    reference_counter: Mapped[int] = mapped_column(Integer, default=0)


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"), default=None)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    previous_refresh_token_hash: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)
    revoked_reason: Mapped[str | None] = mapped_column(String(50), default=None)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Product(Base):
    __tablename__ = "products"
    id: Mapped[uuid.UUID] = _pk()
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    variants: Mapped[list["ProductVariant"]] = relationship(
        back_populates="product", order_by="ProductVariant.created_at", lazy="selectin"
    )


class ProductVariant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("product_id", "name", name="uq_variant_name_per_product"),
        CheckConstraint("price >= 0", name="ck_variant_price_nonneg"),
    )
    id: Mapped[uuid.UUID] = _pk()
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    price: Mapped[Decimal]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    product: Mapped[Product] = relationship(back_populates="variants")


class BusinessDay(Base):
    __tablename__ = "business_days"
    __table_args__ = (
        CheckConstraint(_in("status", ("OPEN", "CLOSED")), name="ck_days_status"),
        # One OPEN day per branch, enforced by the database itself.
        Index(
            "uq_one_open_day_per_branch",
            "branch_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
            sqlite_where=text("status = 'OPEN'"),
        ),
    )
    id: Mapped[uuid.UUID] = _pk()
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    business_date: Mapped[date] = mapped_column(Date)
    opened_at: Mapped[datetime] = mapped_column(default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(default=None)  # kept (not cleared) on reopen
    opened_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    closed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), default=None)
    status: Mapped[str] = mapped_column(String(10), default="OPEN")
    reopen_count: Mapped[int] = mapped_column(Integer, default=0)


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint(_in("status", ("DRAFT", "COMPLETED", "VOIDED")), name="ck_sales_status"),
        CheckConstraint("total_amount >= 0", name="ck_sales_total_nonneg"),
        CheckConstraint("length(currency_code) = 3", name="ck_sales_currency"),
        Index("ix_sales_day_status", "business_day_id", "status"),
    )
    id: Mapped[uuid.UUID] = _pk()
    reference: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(10), default="DRAFT")
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), default=None)
    draft_business_day_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("business_days.id"), default=None)
    business_day_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("business_days.id"), default=None)
    total_amount: Mapped[Decimal] = mapped_column(default=Decimal("0.00"))
    currency_code: Mapped[str] = mapped_column(String(3), default="NGN")
    occurred_at: Mapped[datetime] = mapped_column(index=True)
    entered_at: Mapped[datetime]
    received_at: Mapped[datetime]
    completed_at: Mapped[datetime | None] = mapped_column(default=None)
    voided_at: Mapped[datetime | None] = mapped_column(default=None)
    voided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), default=None)
    void_reason: Mapped[str | None] = mapped_column(String(500), default=None)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)

    items: Mapped[list["SaleItem"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", lazy="selectin"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", lazy="selectin"
    )
    creator: Mapped[User] = relationship(foreign_keys=[created_by], lazy="joined")

    @property
    def staff_name(self) -> str | None:
        return self.creator.full_name if self.creator else None


class SaleItem(Base):
    __tablename__ = "sale_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_items_qty_positive"),)
    id: Mapped[uuid.UUID] = _pk()
    sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sales.id"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"))
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    # Snapshots: history never changes when products are renamed or repriced (FR-022).
    product_name: Mapped[str] = mapped_column(String(120))
    variant_name: Mapped[str] = mapped_column(String(80))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal]
    subtotal: Mapped[Decimal]
    price_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    sale: Mapped[Sale] = relationship(back_populates="items")


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(_in("method", PAYMENT_METHODS), name="ck_payments_method"),
        CheckConstraint("amount_applied > 0", name="ck_payments_amount_positive"),
    )
    id: Mapped[uuid.UUID] = _pk()
    sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sales.id"), index=True)
    method: Mapped[str] = mapped_column(String(10))
    amount_applied: Mapped[Decimal]
    cash_received: Mapped[Decimal | None] = mapped_column(default=None)
    change_given: Mapped[Decimal | None] = mapped_column(default=None)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    currency_code: Mapped[str] = mapped_column(String(3), default="NGN")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    sale: Mapped[Sale] = relationship(back_populates="payments")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint(_in("category", EXPENSE_CATEGORIES), name="ck_expenses_category"),
        CheckConstraint(_in("payment_method", PAYMENT_METHODS), name="ck_expenses_method"),
        CheckConstraint("amount > 0", name="ck_expenses_amount_positive"),
    )
    id: Mapped[uuid.UUID] = _pk()
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    business_day_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("business_days.id"), default=None, index=True)
    # Closed day this expense belongs to; waits for the owner/manager adjustment workflow.
    suggested_business_day_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("business_days.id"), default=None)
    amount: Mapped[Decimal]
    category: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(String(500))
    payment_method: Mapped[str] = mapped_column(String(10))
    occurred_at: Mapped[datetime]
    entered_at: Mapped[datetime]
    received_at: Mapped[datetime]
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"), default=None)
    assignment_rule: Mapped[str] = mapped_column(String(20), default="UNASSIGNED")
    currency_code: Mapped[str] = mapped_column(String(3), default="NGN")
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class DailyClosing(Base):
    __tablename__ = "daily_closings"
    __table_args__ = (
        UniqueConstraint("business_day_id", "version", name="uq_closing_version"),
        CheckConstraint(_in("status", ("PREPARED", "FINAL")), name="ck_closing_status"),
        CheckConstraint(_in("kind", ("CLOSE", "ADJUSTMENT")), name="ck_closing_kind"),
    )
    id: Mapped[uuid.UUID] = _pk()
    business_day_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_days.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(12), default="CLOSE")
    status: Mapped[str] = mapped_column(String(10), default="PREPARED")
    summary: Mapped[dict] = mapped_column(default=dict)
    expected_cash: Mapped[Decimal]
    expected_transfer: Mapped[Decimal]
    expected_pos: Mapped[Decimal]
    actual_cash: Mapped[Decimal]
    actual_transfer: Mapped[Decimal]
    actual_pos: Mapped[Decimal]
    explanations: Mapped[dict | None] = mapped_column(default=None)
    reason: Mapped[str | None] = mapped_column(String(500), default=None)
    exceptional_reason: Mapped[str | None] = mapped_column(String(500), default=None)
    prepared_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), default=None)
    currency_code: Mapped[str] = mapped_column(String(3), default="NGN")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = _pk()
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), default=None, index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"), default=None)
    action: Mapped[str] = mapped_column(String(50), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), default=None)
    entity_id: Mapped[str | None] = mapped_column(String(64), default=None)
    before: Mapped[dict | None] = mapped_column(default=None)
    after: Mapped[dict | None] = mapped_column(default=None)
    reason: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)


class SyncRecord(Base):
    """Outcome per idempotency key; also the owner/manager review queue."""

    __tablename__ = "sync_records"
    __table_args__ = (
        CheckConstraint(_in("outcome", ("ACCEPTED", "REJECTED", "CONFLICT")), name="ck_sync_outcome"),
        Index("ix_sync_review_queue", "needs_review", "resolved_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # = client idempotency key
    record_type: Mapped[str] = mapped_column(String(20))
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    outcome: Mapped[str] = mapped_column(String(10))
    reason_code: Mapped[str | None] = mapped_column(String(50), default=None)
    reason_detail: Mapped[str | None] = mapped_column(String(500), default=None)
    payload: Mapped[dict | None] = mapped_column(default=None)  # scrubbed; kept only for held items
    entity_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    received_at: Mapped[datetime] = mapped_column(default=utcnow)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), default=None)
    resolved_at: Mapped[datetime | None] = mapped_column(default=None)
    resolution: Mapped[str | None] = mapped_column(String(30), default=None)
    resolution_reason: Mapped[str | None] = mapped_column(String(500), default=None)


class TechnicalEvent(Base):
    __tablename__ = "technical_events"
    __table_args__ = (
        CheckConstraint(_in("severity", ("INFO", "WARNING", "ERROR", "CRITICAL")), name="ck_tech_severity"),
        CheckConstraint(_in("event_type", ("SYNC", "BACKUP", "DATABASE", "APPLICATION")), name="ck_tech_type"),
    )
    id: Mapped[uuid.UUID] = _pk()
    severity: Mapped[str] = mapped_column(String(10))
    event_type: Mapped[str] = mapped_column(String(12))
    message: Mapped[str] = mapped_column(String(500))
    context: Mapped[dict | None] = mapped_column(default=None)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), default=None)
    resolved_at: Mapped[datetime | None] = mapped_column(default=None)
