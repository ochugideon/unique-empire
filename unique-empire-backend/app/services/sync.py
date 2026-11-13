"""Offline synchronization (Architecture section 5, SRS 4.10).

* Every record is processed independently inside its own SAVEPOINT, so one bad record never
  blocks the others, while a sale's header/items/payments always commit together.
* Idempotency: the outcome per key lives in sync_records; a repeated key returns the earlier outcome.
* Records the server cannot accept automatically are HELD in sync_records (the review queue).
"""
import logging
import uuid
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import rules
from app.core.errors import AppError, not_found
from app.core.jsonutil import scrub, to_json
from app.core.timeutil import ensure_aware, utcnow
from app.database import lock_row
from app.models import BusinessDay, Device, Expense, Sale, SyncRecord, User
from app.schemas.ops import ExpenseCreate, ResolveIn, SyncRecordIn, SyncResult, SyncUploadIn
from app.schemas.sales import SaleCreate, SaleUpdate, SaleUpdateSync
from app.services.audit import write_audit
from app.services.closing import create_adjustment_version
from app.services.days import get_open_day
from app.services.expenses import create_expense
from app.services.sales import create_sale, update_sale, validate_sale_payload
from app.services.technical import record_technical_event

logger = logging.getLogger("unique_empire.sync")

CONFLICT_CODES = {"VERSION_CONFLICT", "DUPLICATE_REFERENCE", "DUPLICATE_ID", "LATE_DAY_CLOSED", "AFTER_CLOSE_TIME", "RESTORE_REUPLOAD", "DB_CONSTRAINT"}


@dataclass
class Outcome:
    outcome: str  # ACCEPTED | REJECTED | CONFLICT
    reason_code: str | None = None
    reason_detail: str | None = None
    entity_id: uuid.UUID | None = None
    needs_review: bool = False
    hold_payload: bool = False


def _result(row: SyncRecord, *, duplicate: bool = False) -> SyncResult:
    return SyncResult(
        idempotency_key=row.id, outcome=row.outcome, reason_code=row.reason_code,
        reason_detail=row.reason_detail, entity_id=row.entity_id, duplicate=duplicate,
    )


def _make_row(key, rec: SyncRecordIn, user: User, device: Device, out: Outcome) -> SyncRecord:
    return SyncRecord(
        id=key, record_type=rec.record_type, device_id=device.id, user_id=user.id,
        outcome=out.outcome, reason_code=out.reason_code, reason_detail=(out.reason_detail or "")[:500] or None,
        payload=scrub(to_json(rec.payload)) if out.hold_payload else None,
        entity_id=out.entity_id, needs_review=out.needs_review, received_at=utcnow(),
    )


def process_upload(db: Session, *, user: User, device: Device, body: SyncUploadIn) -> list[SyncResult]:
    results: list[SyncResult] = []
    for rec in body.records:
        existing = db.get(SyncRecord, rec.idempotency_key)
        if existing is not None:  # idempotent retry: return the earlier outcome
            results.append(_result(existing, duplicate=True))
            continue
        results.append(_process_one(db, user, device, rec, body.resync_after_restore))

    now = utcnow()
    device.last_sync_at = now
    device.last_reported_at = now
    if body.pending_remaining is not None:
        device.pending_count = body.pending_remaining
    return results


def _process_one(db: Session, user: User, device: Device, rec: SyncRecordIn, resync: bool) -> SyncResult:
    key = rec.idempotency_key
    try:
        with db.begin_nested():
            out = _dispatch(db, user, device, rec, resync)
            row = _make_row(key, rec, user, device, out)
            db.add(row)
            db.flush()
        return _result(row)
    except AppError as exc:
        out = Outcome("CONFLICT" if exc.code in CONFLICT_CODES else "REJECTED", exc.code, exc.message, needs_review=True, hold_payload=True)
    except ValidationError as exc:
        detail = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
        out = Outcome("REJECTED", "INVALID_PAYLOAD", detail, needs_review=True, hold_payload=True)
    except IntegrityError:
        out = Outcome("CONFLICT", "DB_CONSTRAINT", "The record conflicts with existing data.", needs_review=True, hold_payload=True)
    except Exception as exc:  # unexpected: do NOT record an outcome so the client retries
        logger.exception("sync record failed")
        record_technical_event("ERROR", "SYNC", "Unexpected error while processing a synchronized record",
                               {"record_type": rec.record_type, "error": type(exc).__name__}, device_id=device.id)
        return SyncResult(idempotency_key=key, outcome="ERROR", reason_code="SERVER_ERROR",
                          reason_detail="Temporary problem; the record will be retried.")
    row = _make_row(key, rec, user, device, out)
    db.add(row)
    db.flush()
    return _result(row)


# ------------------------------------------------------------------ dispatch
def _check_actor(user: User, claimed) -> None:
    if claimed is not None and claimed != user.id:
        raise AppError(403, "ACTOR_MISMATCH", "Records can only be uploaded by the staff member who created them.")


def _load_day(db: Session, device: Device, day_id) -> BusinessDay:
    if day_id is None:
        raise AppError(400, "MISSING_BUSINESS_DAY", "Offline sales must carry the business day the device believed was open.")
    day = lock_row(db, BusinessDay, day_id)
    if day is None or day.branch_id != device.branch_id:
        raise AppError(400, "UNKNOWN_BUSINESS_DAY", "The referenced business day does not exist.")
    return day


def _hold_for(disposition: rules.Disposition) -> Outcome:
    if disposition is rules.Disposition.HOLD_BEFORE_CLOSE:
        return Outcome("CONFLICT", "LATE_DAY_CLOSED",
                       "The sale happened before its business day closed. An owner or manager must attach it through the post-close adjustment.",
                       needs_review=True, hold_payload=True)
    return Outcome("CONFLICT", "AFTER_CLOSE_TIME",
                   "The sale happened after its business day closed. An owner or manager must assign it to the open day or reject it.",
                   needs_review=True, hold_payload=True)


def _dispatch(db: Session, user: User, device: Device, rec: SyncRecordIn, resync: bool) -> Outcome:
    if rec.record_type == "SALE":
        return _sale(db, user, device, SaleCreate.model_validate(rec.payload), resync)
    if rec.record_type == "SALE_UPDATE":
        return _sale_update(db, user, device, SaleUpdateSync.model_validate(rec.payload))
    return _expense(db, user, device, ExpenseCreate.model_validate(rec.payload), resync)


def _sale(db: Session, user: User, device: Device, data: SaleCreate, resync: bool) -> Outcome:
    _check_actor(user, data.user_id)
    if data.id is not None and db.get(Sale, data.id) is not None:
        if resync:  # restore point was later than this sale: nothing to do
            return Outcome("ACCEPTED", "ALREADY_PRESENT", entity_id=data.id)
        raise AppError(409, "DUPLICATE_ID", "A sale with this id already exists.")
    day = _load_day(db, device, data.business_day_id)

    if resync:  # re-uploaded after a restoration: always reviewed, never silently ignored
        validate_sale_payload(db, data, user_id=user.id)
        return Outcome("CONFLICT", "RESTORE_REUPLOAD", "Re-uploaded after a restoration; awaiting owner/manager review.",
                       needs_review=True, hold_payload=True)

    if data.status == "DRAFT":
        sale = create_sale(db, user=user, device=device, data=data, day=day, offline=True)
        return Outcome("ACCEPTED", entity_id=sale.id)

    occurred_at = ensure_aware(data.occurred_at or data.entered_at) if (data.occurred_at or data.entered_at) else None
    if occurred_at is None:
        raise AppError(400, "MISSING_OCCURRED_AT", "Offline sales must carry the time the payment was recorded.")
    disposition = rules.classify_offline_sale(day.status, day.closed_at, occurred_at)
    if disposition is rules.Disposition.ATTACH:
        sale = create_sale(db, user=user, device=device, data=data, day=day, offline=True)
        return Outcome("ACCEPTED", entity_id=sale.id)
    validate_sale_payload(db, data, user_id=user.id)
    return _hold_for(disposition)


def _sale_update(db: Session, user: User, device: Device, data: SaleUpdateSync) -> Outcome:
    _check_actor(user, data.user_id)
    sale = db.get(Sale, data.sale_id)
    if sale is None:
        raise AppError(400, "UNKNOWN_SALE", "The sale being updated does not exist on the server.")
    completion_day = None
    if data.complete:
        day = _load_day(db, device, data.business_day_id)
        occurred_at = ensure_aware(data.occurred_at) if data.occurred_at else None
        if occurred_at is None:
            raise AppError(400, "MISSING_OCCURRED_AT", "Completing a sale offline requires the time payment was recorded.")
        disposition = rules.classify_offline_sale(day.status, day.closed_at, occurred_at)
        if disposition is not rules.Disposition.ATTACH:
            if data.version != sale.version:
                raise AppError(409, "VERSION_CONFLICT", "This sale was changed by someone else.", {"server_version": sale.version})
            return _hold_for(disposition)
        completion_day = day
    updated = update_sale(db, user=user, device_id=device.id, sale=sale, data=data, completion_day=completion_day, offline=True)
    return Outcome("ACCEPTED", entity_id=updated.id)


def _expense(db: Session, user: User, device: Device, data: ExpenseCreate, resync: bool) -> Outcome:
    _check_actor(user, data.user_id)
    if data.id is not None and db.get(Expense, data.id) is not None:
        if resync:
            return Outcome("ACCEPTED", "ALREADY_PRESENT", entity_id=data.id)
        raise AppError(409, "DUPLICATE_ID", "An expense with this id already exists.")
    if resync:
        return Outcome("CONFLICT", "RESTORE_REUPLOAD", "Re-uploaded after a restoration; awaiting owner/manager review.",
                       needs_review=True, hold_payload=True)
    expense, assignment = create_expense(db, user=user, device=device, data=data, offline=True)
    code = assignment.rule if assignment.rule in ("UNASSIGNED", "NEEDS_ADJUSTMENT") else None
    return Outcome("ACCEPTED", reason_code=code, entity_id=expense.id)


# ------------------------------------------------------------------ review queue
def list_review_queue(db: Session):
    return db.scalars(
        select(SyncRecord).where(SyncRecord.needs_review.is_(True), SyncRecord.resolved_at.is_(None)).order_by(SyncRecord.received_at)
    ).all()


def resolve_held(db: Session, *, user: User, device_id, key: uuid.UUID, data: ResolveIn) -> SyncRecord:
    rec = lock_row(db, SyncRecord, key)
    if rec is None or not rec.needs_review:
        raise not_found("Review item")
    if rec.resolved_at is not None:
        raise AppError(409, "ALREADY_RESOLVED", "This item has already been resolved.")

    code = rec.reason_code
    allowed = {
        "LATE_DAY_CLOSED": {"ATTACH_TO_CLOSED_DAY", "REJECT"},
        "AFTER_CLOSE_TIME": {"ASSIGN_TO_OPEN_DAY", "REJECT"},
        "RESTORE_REUPLOAD": {"ATTACH_TO_CLOSED_DAY", "ASSIGN_TO_OPEN_DAY", "REJECT"},
    }.get(code, {"REJECT"})
    if data.action not in allowed:
        raise AppError(400, "INVALID_ACTION", f"This item can only be resolved with: {', '.join(sorted(allowed))}.")

    entity_id = rec.entity_id
    if data.action != "REJECT":
        actor = db.get(User, rec.user_id)
        device = db.get(Device, rec.device_id)
        payload = rec.payload or {}
        if data.action == "ATTACH_TO_CLOSED_DAY":
            day_id = data.business_day_id or payload.get("business_day_id")
            day = lock_row(db, BusinessDay, uuid.UUID(str(day_id))) if day_id else None
            if day is None:
                raise AppError(400, "UNKNOWN_BUSINESS_DAY", "The business day to attach to was not found.")
        else:
            open_day = get_open_day(db, device.branch_id)
            if open_day is None:
                raise AppError(409, "NO_OPEN_DAY", "Open a business day before assigning this record to it.")
            day = lock_row(db, BusinessDay, open_day.id)

        if rec.record_type == "SALE":
            sale = create_sale(db, user=actor, device=device, data=SaleCreate.model_validate(payload), day=day,
                               offline=True, received_at=rec.received_at)
            entity_id = sale.id
        elif rec.record_type == "SALE_UPDATE":
            upd = SaleUpdateSync.model_validate(payload)
            sale = db.get(Sale, upd.sale_id)
            if sale is None:
                raise AppError(400, "UNKNOWN_SALE", "The sale being updated no longer exists.")
            entity_id = update_sale(db, user=actor, device_id=device.id, sale=sale, data=upd, completion_day=day, offline=True).id
        else:
            expense, _ = create_expense(db, user=actor, device=device, data=ExpenseCreate.model_validate(payload),
                                        offline=True, received_at=rec.received_at, forced_day=day)
            entity_id = expense.id
        if day.status == "CLOSED":  # post-close adjustment => new closing version
            create_adjustment_version(db, user=user, device_id=device_id, day=day, reason=data.reason)

    rec.entity_id = entity_id
    rec.resolved_by, rec.resolved_at = user.id, utcnow()
    rec.resolution = {"ATTACH_TO_CLOSED_DAY": "ATTACHED", "ASSIGN_TO_OPEN_DAY": "ASSIGNED_TO_OPEN_DAY", "REJECT": "REJECTED"}[data.action]
    rec.resolution_reason = data.reason
    write_audit(db, actor_id=user.id, device_id=device_id, action="SYNC_REVIEW_DECISION", entity_type="sync_record",
                entity_id=rec.id, after={"resolution": rec.resolution, "reason_code": code, "entity_id": str(entity_id) if entity_id else None},
                reason=data.reason)
    return rec
