import uuid

from sqlalchemy.orm import Session

from app.core.jsonutil import to_json
from app.core.timeutil import utcnow
from app.models import AuditLog, Sale


def write_audit(
    db: Session,
    *,
    actor_id,
    action: str,
    entity_type: str | None = None,
    entity_id=None,
    before=None,
    after=None,
    reason: str | None = None,
    device_id=None,
) -> AuditLog:
    """Append an audit row inside the caller's transaction (so it commits or rolls back with the action)."""
    row = AuditLog(
        id=uuid.uuid4(),
        actor_id=actor_id,
        device_id=device_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        before=to_json(before) if before is not None else None,
        after=to_json(after) if after is not None else None,
        reason=reason,
        created_at=utcnow(),
    )
    db.add(row)
    return row


def sale_snapshot(sale: Sale) -> dict:
    return to_json(
        {
            "status": sale.status,
            "version": sale.version,
            "total_amount": sale.total_amount,
            "items": [
                {"product": i.product_name, "variant": i.variant_name, "quantity": i.quantity, "unit_price": i.unit_price}
                for i in sale.items
            ],
            "payments": [{"method": p.method, "amount_applied": p.amount_applied} for p in sale.payments],
        }
    )
