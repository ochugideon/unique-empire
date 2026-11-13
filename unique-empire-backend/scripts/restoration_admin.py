"""Administrator tooling for the restoration runbook (FR-141, FR-157).

    python -m scripts.restoration_admin list
    python -m scripts.restoration_admin performed --request-id <uuid> --notes "restored to 2026-11-09T18:00Z"

`performed` (run AFTER the restore) appends the outcome to the external append-only log and
re-inserts a RESTORATION_PERFORMED row into audit_logs, because the restore rolled that table back.
It also re-inserts the original RESTORATION_REQUESTED entry if the restore removed it.
"""
import argparse
import json
import os
import sys
import uuid

from sqlalchemy import select

from app.config import settings
from app.core.timeutil import utcnow
from app.database import SessionLocal
from app.models import AuditLog
from app.services.audit import write_audit


def read_log() -> list[dict]:
    if not os.path.exists(settings.restoration_log_path):
        return []
    with open(settings.restoration_log_path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def cmd_list(_args) -> int:
    entries = read_log()
    done = {e["request_id"] for e in entries if e["event"] == "RESTORATION_PERFORMED"}
    for e in entries:
        if e["event"] == "RESTORATION_REQUESTED":
            state = "PERFORMED" if e["request_id"] in done else "PENDING"
            print(f"{e['request_id']}  {state:9}  recovery point {e['recovery_point']}  by {e['requested_by_username']}: {e['reason']}")
    return 0


def cmd_performed(args) -> int:
    request = next((e for e in read_log() if e["event"] == "RESTORATION_REQUESTED" and e["request_id"] == args.request_id), None)
    if request is None:
        print("No such request in the external log.")
        return 1
    outcome = {"event": "RESTORATION_PERFORMED", "request_id": args.request_id, "notes": args.notes, "performed_at": utcnow().isoformat()}
    with open(settings.restoration_log_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(outcome, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    with SessionLocal() as db:
        already = db.scalar(select(AuditLog.id).where(AuditLog.action == "RESTORATION_REQUESTED", AuditLog.entity_id == args.request_id))
        if already is None:  # the restore rolled the audit table back past the request
            write_audit(db, actor_id=uuid.UUID(request["requested_by"]), action="RESTORATION_REQUESTED", entity_type="restoration",
                        entity_id=args.request_id, after={"recovery_point": request["recovery_point"]}, reason=request["reason"])
        write_audit(db, actor_id=None, action="RESTORATION_PERFORMED", entity_type="restoration", entity_id=args.request_id,
                    after={"recovery_point": request["recovery_point"]}, reason=args.notes)
        db.commit()
    print("Outcome recorded. Tell staff to open the app so every device resynchronizes; re-uploaded records go to the review queue.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    p = sub.add_parser("performed")
    p.add_argument("--request-id", required=True)
    p.add_argument("--notes", required=True)
    p.set_defaults(fn=cmd_performed)
    args = parser.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
