import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import rules
from app.core.errors import AppError, forbidden, not_found
from app.core.money import ZERO, quantize
from app.core.security import verify_password
from app.core.timeutil import ensure_aware, local_date, local_day_bounds, utcnow
from app.database import lock_row
from app.models import BusinessDay, Device, Payment, Product, ProductVariant, Sale, SaleItem, User
from app.schemas.sales import ItemIn, PaymentIn, SaleCreate, SaleUpdate
from app.services.audit import sale_snapshot, write_audit

FUTURE_TOLERANCE = timedelta(minutes=5)
PRIVILEGED = ("OWNER", "MANAGER")


# ------------------------------------------------------------------ permissions
def can_access(user: User, sale: Sale) -> bool:
    return user.role in PRIVILEGED or sale.created_by == user.id


def assert_can_access(user: User, sale: Sale) -> None:
    # Attendants must not learn that other people's records exist.
    if not can_access(user, sale):
        raise not_found("Sale")


# ------------------------------------------------------------------ builders
def build_items(db: Session, items_in: list[ItemIn], *, honour_client_price: bool) -> tuple[list[SaleItem], Decimal]:
    if not items_in:
        raise AppError(400, "EMPTY_SALE", "A sale needs at least one item.")
    variant_ids = {i.variant_id for i in items_in}
    rows = db.execute(
        select(ProductVariant, Product)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(ProductVariant.id.in_(variant_ids))
    ).all()
    catalogue = {variant.id: (variant, product) for variant, product in rows}
    missing = variant_ids - catalogue.keys()
    if missing:
        raise AppError(400, "UNKNOWN_VARIANT", "Some products are not in the catalogue.", [str(m) for m in missing])

    merged: dict[tuple, SaleItem] = {}
    for item in items_in:
        variant, product = catalogue[item.variant_id]
        if honour_client_price:
            # Offline price snapshot is kept; differences are flagged, never silently changed.
            price = item.unit_price if item.unit_price is not None else variant.price
            flagged = price != variant.price
        else:
            if not (variant.is_active and product.is_active):
                raise AppError(400, "PRODUCT_INACTIVE", f"{product.name} ({variant.name}) is not available for sale.")
            price, flagged = variant.price, False
        key = (variant.id, price)
        if key in merged:  # FR-027: identical variants combine into one line
            line = merged[key]
            line.quantity += item.quantity
            line.subtotal = quantize(price * line.quantity)
        else:
            merged[key] = SaleItem(
                id=uuid.uuid4(),
                product_id=product.id,
                variant_id=variant.id,
                product_name=product.name,
                variant_name=variant.name,
                quantity=item.quantity,
                unit_price=price,
                subtotal=quantize(price * item.quantity),
                price_flagged=flagged,
            )
    items = list(merged.values())
    return items, sum((i.subtotal for i in items), ZERO)


def build_payments(payments_in: list[PaymentIn], total: Decimal, *, user_id) -> list[Payment]:
    if not payments_in:
        raise AppError(400, "PAYMENT_REQUIRED", "Payment is required to complete a sale.")
    payments: list[Payment] = []
    applied = ZERO
    for p in payments_in:
        if p.method == "CASH":
            received = p.cash_received if p.cash_received is not None else p.amount_applied
            if received < p.amount_applied:
                raise AppError(400, "CASH_SHORT", "Cash received is less than the amount applied to the sale.")
            received_value, change = received, quantize(received - p.amount_applied)
        else:
            if p.cash_received is not None:
                raise AppError(400, "CASH_RECEIVED_NOT_ALLOWED", "Cash received applies to cash payments only.")
            received_value, change = None, None
        payments.append(
            Payment(
                id=uuid.uuid4(),
                method=p.method,
                amount_applied=p.amount_applied,
                cash_received=received_value,
                change_given=change,
                created_by=user_id,
            )
        )
        applied += p.amount_applied
    if applied != total:  # FR-031/FR-064: only fully paid sales complete
        raise AppError(
            400, "PAYMENT_MISMATCH", "Payments must add up exactly to the sale total.",
            {"total": f"{total:.2f}", "applied": f"{applied:.2f}"},
        )
    return payments


def validate_sale_payload(db: Session, data: SaleCreate, *, user_id) -> None:
    """Dry-run used before holding an offline sale for review, so held items are known-good."""
    items, total = build_items(db, data.items, honour_client_price=True)
    if data.status == "COMPLETED":
        build_payments(data.payments, total, user_id=user_id)


def _assign_reference(db: Session, device: Device, supplied: str | None, entered_at: datetime) -> str:
    if supplied:
        parsed = rules.parse_reference(supplied)
        if parsed is None or parsed.device_code != device.device_code:
            raise AppError(400, "INVALID_REFERENCE", "Reference must look like UE-{DEVICE CODE}-{YYMMDD}-{NNN} for this device.")
        if db.scalar(select(Sale.id).where(Sale.reference == supplied)) is not None:
            raise AppError(409, "DUPLICATE_REFERENCE", "This reference already exists.")
        if parsed.counter > device.reference_counter:
            device.reference_counter = parsed.counter
        return supplied
    locked = lock_row(db, Device, device.id)
    locked.reference_counter += 1
    return rules.format_reference(locked.device_code, local_date(entered_at), locked.reference_counter)


def _times(data_occurred, data_entered, *, offline: bool) -> tuple[datetime, datetime]:
    now = utcnow()
    entered_at = ensure_aware(data_entered) if (offline and data_entered) else now
    occurred_at = ensure_aware(data_occurred) if data_occurred else entered_at
    if occurred_at > now + FUTURE_TOLERANCE or entered_at > now + FUTURE_TOLERANCE:
        raise AppError(400, "TIME_IN_FUTURE", "The recorded time is in the future. Check the device clock.")
    return occurred_at, entered_at


# ------------------------------------------------------------------ create
def create_sale(
    db: Session,
    *,
    user: User,
    device: Device,
    data: SaleCreate,
    day: BusinessDay,
    offline: bool,
    received_at: datetime | None = None,
) -> Sale:
    occurred_at, entered_at = _times(data.occurred_at, data.entered_at, offline=offline)
    sale_id = data.id or uuid.uuid4()
    if db.get(Sale, sale_id) is not None:
        raise AppError(409, "DUPLICATE_ID", "A sale with this id already exists.")
    reference = _assign_reference(db, device, data.reference, entered_at)
    items, total = build_items(db, data.items, honour_client_price=offline)

    payments: list[Payment] = []
    if data.status == "COMPLETED":
        payments = build_payments(data.payments, total, user_id=user.id)
    elif data.payments:
        raise AppError(400, "DRAFT_HAS_PAYMENTS", "Drafts cannot carry payments; complete the sale instead.")

    now = utcnow()
    sale = Sale(
        id=sale_id,
        reference=reference,
        status=data.status,
        branch_id=device.branch_id,
        device_id=device.id,
        created_by=user.id,
        draft_business_day_id=day.id,
        business_day_id=day.id if data.status == "COMPLETED" else None,
        total_amount=total,
        currency_code="NGN",
        occurred_at=occurred_at,
        entered_at=entered_at,
        received_at=received_at or now,
        completed_at=occurred_at if data.status == "COMPLETED" else None,
        version=1,
        updated_at=now,
    )
    sale.items = items
    sale.payments = payments
    db.add(sale)
    db.flush()
    return sale


# ------------------------------------------------------------------ update / complete
def update_sale(
    db: Session,
    *,
    user: User,
    device_id,
    sale: Sale,
    data: SaleUpdate,
    completion_day: BusinessDay | None,
    offline: bool = False,
) -> Sale:
    assert_can_access(user, sale)
    if sale.status == "VOIDED":
        raise AppError(409, "SALE_VOIDED", "A voided sale cannot be changed.")
    if data.version != sale.version:  # optimistic concurrency: never silently overwrite
        raise AppError(409, "VERSION_CONFLICT", "This sale was changed by someone else. Reload it and reapply your changes.",
                       {"server_version": sale.version})

    before = sale_snapshot(sale)
    was_completed = sale.status == "COMPLETED"
    if was_completed:
        current_day = db.get(BusinessDay, sale.business_day_id)
        if current_day is None or current_day.status != "OPEN":
            raise AppError(409, "DAY_CLOSED", "This sale belongs to a closed business day. Reopen the day to change it.")
        if data.complete:
            raise AppError(400, "ALREADY_COMPLETED", "This sale is already completed.")

    items_changed = data.items is not None
    if items_changed:
        items, total = build_items(db, data.items, honour_client_price=offline)
        sale.items.clear()
        db.flush()
        sale.items.extend(items)
        sale.total_amount = total

    if not was_completed:
        if data.complete:
            if completion_day is None:
                raise AppError(409, "NO_OPEN_DAY", "No business day is open.")
            payments = build_payments(data.payments or [], sale.total_amount, user_id=user.id)
            sale.payments.clear()
            db.flush()
            sale.payments.extend(payments)
            sale.status = "COMPLETED"
            sale.business_day_id = completion_day.id  # day in which payment is completed (FR-036)
            now = utcnow()
            sale.occurred_at = _times(data.occurred_at, None, offline=offline)[0] if data.occurred_at else now
            sale.completed_at = sale.occurred_at
        elif data.payments:
            raise AppError(400, "DRAFT_HAS_PAYMENTS", "Drafts cannot carry payments; complete the sale instead.")
    else:
        if data.payments is None and items_changed:
            raise AppError(400, "PAYMENT_REQUIRED", "Items changed; resubmit payments that equal the new total.")
        if data.payments is not None:
            payments = build_payments(data.payments, sale.total_amount, user_id=user.id)
            sale.payments.clear()
            db.flush()
            sale.payments.extend(payments)

    sale.version += 1
    sale.updated_by = user.id
    sale.updated_at = utcnow()
    db.flush()

    if was_completed:  # FR-040
        write_audit(db, actor_id=user.id, device_id=device_id, action="SALE_EDIT", entity_type="sale",
                    entity_id=sale.id, before=before, after=sale_snapshot(sale), reason=data.reason)
    return sale


# ------------------------------------------------------------------ void / delete draft
def void_sale(db: Session, *, user: User, device_id, sale: Sale, reason: str, password: str) -> Sale:
    assert_can_access(user, sale)
    if not verify_password(password, user.password_hash):  # FR-043
        raise AppError(403, "REAUTH_FAILED", "Password confirmation failed.")
    if sale.status == "VOIDED":
        raise AppError(409, "ALREADY_VOIDED", "This sale is already voided.")
    if sale.status == "DRAFT":
        raise AppError(409, "SALE_IS_DRAFT", "Drafts are deleted, not voided.")
    day = db.get(BusinessDay, sale.business_day_id)
    if day is None or day.status != "OPEN":
        raise AppError(409, "DAY_CLOSED", "This sale belongs to a closed business day. Reopen the day to void it.")
    before = sale_snapshot(sale)
    sale.status = "VOIDED"  # records and payments are retained (FR-045)
    sale.voided_at, sale.voided_by, sale.void_reason = utcnow(), user.id, reason
    sale.version += 1
    sale.updated_by, sale.updated_at = user.id, utcnow()
    write_audit(db, actor_id=user.id, device_id=device_id, action="SALE_VOID", entity_type="sale",
                entity_id=sale.id, before=before, after=sale_snapshot(sale), reason=reason)
    return sale


def delete_draft(db: Session, *, user: User, device_id, sale: Sale) -> None:
    assert_can_access(user, sale)
    if sale.status != "DRAFT":
        raise AppError(409, "NOT_A_DRAFT", "Only drafts can be deleted.")
    write_audit(db, actor_id=user.id, device_id=device_id, action="DRAFT_DELETE", entity_type="sale",
                entity_id=sale.id, before=sale_snapshot(sale))
    db.delete(sale)


# ------------------------------------------------------------------ search
def search_sales(
    db: Session,
    user: User,
    *,
    reference=None,
    date_from=None,
    date_to=None,
    product=None,
    staff_id=None,
    status="ALL",
    page=1,
    page_size=25,
):
    query = select(Sale)
    if user.role not in PRIVILEGED:
        query = query.where(Sale.created_by == user.id)
    elif staff_id:
        query = query.where(Sale.created_by == staff_id)
    if reference:
        query = query.where(Sale.reference.ilike(f"%{reference}%"))
    if date_from:
        query = query.where(Sale.occurred_at >= local_day_bounds(date_from)[0])
    if date_to:
        query = query.where(Sale.occurred_at < local_day_bounds(date_to)[1])
    if product:
        query = query.where(Sale.id.in_(select(SaleItem.sale_id).where(SaleItem.product_name.ilike(f"%{product}%"))))
    if status != "ALL":
        query = query.where(Sale.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(Sale.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return rows, total
