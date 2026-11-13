"""Integration tests against SQLite. They exercise the workflows in Architecture section 10."""
import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import login


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def open_day(client, headers):
    r = client.post("/api/v1/business-days/open", headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def sale_body(variant_id, qty=1, payments=None, status="COMPLETED", **extra):
    body = {"status": status, "items": [{"variant_id": variant_id, "quantity": qty}], **extra}
    if status == "COMPLETED":
        body["payments"] = payments
    return body


def test_roles_are_enforced_by_the_api(client, owner, attendant):
    assert client.post("/api/v1/business-days/open", headers=attendant).status_code == 403
    assert client.get("/api/v1/expenses", headers=attendant).status_code == 403
    assert client.get("/api/v1/audit-logs", headers=attendant).status_code == 403
    assert client.post("/api/v1/users", headers=attendant, json={}).status_code in (403, 422)
    assert client.get("/api/v1/audit-logs", headers=owner).status_code == 200


def test_sale_needs_open_day_and_full_payment(client, owner, attendant, catalogue):
    variant = catalogue["variants"][0]["id"]
    r = client.post("/api/v1/sales", headers=attendant, json=sale_body(variant, payments=[{"method": "POS", "amount_applied": "3000.00"}]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "NO_OPEN_DAY"

    open_day(client, owner)
    short = client.post("/api/v1/sales", headers=attendant, json=sale_body(variant, qty=2, payments=[{"method": "POS", "amount_applied": "3000.00"}]))
    assert short.status_code == 400 and short.json()["error"]["code"] == "PAYMENT_MISMATCH"

    split = client.post("/api/v1/sales", headers=attendant, json=sale_body(variant, qty=2, payments=[
        {"method": "CASH", "amount_applied": "4000.00", "cash_received": "5000.00"},
        {"method": "TRANSFER", "amount_applied": "2000.00"},
    ]))
    assert split.status_code == 201, split.text
    data = split.json()
    assert data["total_amount"] == "6000.00" and data["reference"].startswith("UE-A1-")
    cash = next(p for p in data["payments"] if p["method"] == "CASH")
    assert cash["change_given"] == "1000.00"


def test_floats_are_rejected_for_money(client, owner, attendant, catalogue):
    open_day(client, owner)
    r = client.post("/api/v1/sales", headers=attendant, json=sale_body(
        catalogue["variants"][0]["id"], payments=[{"method": "CASH", "amount_applied": 3000.0}]))
    assert r.status_code == 422


def test_identical_variants_combine_and_price_history_is_kept(client, owner, attendant, catalogue):
    open_day(client, owner)
    vid = catalogue["variants"][0]["id"]
    r = client.post("/api/v1/sales", headers=attendant, json={
        "status": "COMPLETED", "items": [{"variant_id": vid, "quantity": 1}, {"variant_id": vid, "quantity": 2}],
        "payments": [{"method": "POS", "amount_applied": "9000.00"}]})
    assert r.status_code == 201
    assert len(r.json()["items"]) == 1 and r.json()["items"][0]["quantity"] == 3
    client.patch(f"/api/v1/variants/{vid}", headers=owner, json={"price": "3500.00"})
    again = client.get(f"/api/v1/sales/{r.json()['id']}", headers=attendant).json()
    assert again["items"][0]["unit_price"] == "3000.00"


def test_draft_flow_with_version_conflict(client, owner, attendant, catalogue):
    open_day(client, owner)
    vid = catalogue["variants"][0]["id"]
    draft = client.post("/api/v1/sales", headers=attendant, json=sale_body(vid, status="DRAFT")).json()
    assert draft["status"] == "DRAFT" and draft["business_day_id"] is None
    ok = client.patch(f"/api/v1/sales/{draft['id']}", headers=attendant, json={"version": 1, "items": [{"variant_id": vid, "quantity": 2}]})
    assert ok.status_code == 200 and ok.json()["version"] == 2
    stale = client.patch(f"/api/v1/sales/{draft['id']}", headers=attendant, json={"version": 1, "items": [{"variant_id": vid, "quantity": 5}]})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"
    done = client.post(f"/api/v1/sales/{draft['id']}/complete", headers=attendant, json={
        "version": 2, "payments": [{"method": "POS", "amount_applied": "6000.00"}]})
    assert done.status_code == 200 and done.json()["status"] == "COMPLETED"
    assert done.json()["reference"] == draft["reference"]  # reference never changes


def test_void_requires_reauth_and_keeps_records(client, owner, attendant, catalogue):
    open_day(client, owner)
    vid = catalogue["variants"][0]["id"]
    sale = client.post("/api/v1/sales", headers=attendant, json=sale_body(vid, payments=[{"method": "POS", "amount_applied": "3000.00"}])).json()
    bad = client.post(f"/api/v1/sales/{sale['id']}/void", headers=attendant, json={"reason": "wrong order", "password": "nope"})
    assert bad.status_code == 403
    good = client.post(f"/api/v1/sales/{sale['id']}/void", headers=attendant, json={"reason": "wrong order", "password": "Passw0rd!"})
    assert good.status_code == 200 and good.json()["status"] == "VOIDED" and good.json()["payments"]


def test_closing_requires_explanations_and_blocks_on_unsynced_devices(client, owner, attendant, catalogue, session_factory, seed):
    day = open_day(client, owner)
    vid = catalogue["variants"][0]["id"]
    client.post("/api/v1/sales", headers=attendant, json=sale_body(vid, payments=[{"method": "CASH", "amount_applied": "3000.00"}]))
    base = {"actual_cash": "2900.00", "actual_transfer": "0.00", "actual_pos": "0.00", "finalize": True}
    r = client.post(f"/api/v1/business-days/{day['id']}/close", headers=owner, json=base)
    assert r.status_code == 422 and r.json()["error"]["code"] == "EXPLANATION_REQUIRED"

    with_expl = {**base, "explanations": {"CASH": "Change given from the till"}}
    r = client.post(f"/api/v1/business-days/{day['id']}/close", headers=owner, json=with_expl)
    assert r.status_code == 409 and r.json()["error"]["code"] == "DEVICES_NOT_SYNCED"

    client.post("/api/v1/devices/me/heartbeat", headers=owner, json={"pending_count": 0})
    r = client.post(f"/api/v1/business-days/{day['id']}/close", headers=owner, json=with_expl)
    assert r.status_code == 200, r.text
    assert r.json()["closing"]["status"] == "FINAL"
    # closed days are protected from ordinary edits
    sale_id = client.get("/api/v1/sales", headers=owner).json()["items"][0]["id"]
    edit = client.patch(f"/api/v1/sales/{sale_id}", headers=owner, json={"version": 1, "payments": [{"method": "POS", "amount_applied": "3000.00"}]})
    assert edit.status_code == 409 and edit.json()["error"]["code"] == "DAY_CLOSED"


def test_attendant_expense_is_recorded_but_not_readable(client, owner, attendant):
    open_day(client, owner)
    r = client.post("/api/v1/expenses", headers=attendant, json={
        "amount": "1500.00", "category": "transport", "description": "Delivery fuel", "payment_method": "CASH"})
    assert r.status_code == 201 and set(r.json()) == {"id", "status"}
    listing = client.get("/api/v1/expenses", headers=owner).json()
    assert listing["total"] == 1 and listing["items"][0]["business_day_id"] is not None


def test_expense_without_open_day_is_unassigned_until_owner_assigns(client, owner, attendant):
    r = client.post("/api/v1/expenses", headers=attendant, json={
        "amount": "800.00", "category": "other", "description": "Cleaning supplies", "payment_method": "CASH"})
    assert r.status_code == 201
    item = client.get("/api/v1/expenses?unassigned=true", headers=owner).json()["items"][0]
    assert item["business_day_id"] is None
    day = open_day(client, owner)
    assigned = client.patch(f"/api/v1/expenses/{item['id']}/assign-day", headers=owner, json={"business_day_id": day["id"], "reason": "Bought before opening"})
    assert assigned.status_code == 200 and assigned.json()["business_day_id"] == day["id"]


def test_sync_is_idempotent_and_late_sale_goes_to_review(client, owner, attendant, catalogue):
    vid = catalogue["variants"][0]["id"]
    day = open_day(client, owner)
    client.post("/api/v1/devices/me/heartbeat", headers=owner, json={"pending_count": 0})
    occurred = datetime.now(timezone.utc) - timedelta(minutes=1)

    def offline_sale(key, ref):
        return {"idempotency_key": key, "record_type": "SALE", "payload": {
            "id": key, "reference": ref, "status": "COMPLETED", "business_day_id": day["id"],
            "occurred_at": iso(occurred), "entered_at": iso(occurred),
            "items": [{"variant_id": vid, "quantity": 1, "unit_price": "3000.00"}],
            "payments": [{"method": "POS", "amount_applied": "3000.00"}]}}

    k1 = str(uuid.uuid4())
    first = client.post("/api/v1/sync/upload", headers=attendant, json={"records": [offline_sale(k1, "UE-A1-261110-050")]}).json()
    assert first["results"][0]["outcome"] == "ACCEPTED"
    retry = client.post("/api/v1/sync/upload", headers=attendant, json={"records": [offline_sale(k1, "UE-A1-261110-050")]}).json()
    assert retry["results"][0]["duplicate"] is True
    assert client.get("/api/v1/sales", headers=owner).json()["total"] == 1  # no duplicate sale

    close = client.post(f"/api/v1/business-days/{day['id']}/close", headers=owner, json={
        "actual_cash": "0.00", "actual_transfer": "0.00", "actual_pos": "3000.00", "finalize": True})
    assert close.status_code == 200, close.text

    k2 = str(uuid.uuid4())
    late = client.post("/api/v1/sync/upload", headers=attendant, json={"records": [offline_sale(k2, "UE-A1-261110-051")]}).json()
    assert late["results"][0]["outcome"] == "CONFLICT" and late["results"][0]["reason_code"] == "LATE_DAY_CLOSED"
    assert client.get("/api/v1/sales", headers=owner).json()["total"] == 1  # never attached silently

    queue = client.get("/api/v1/sync/review", headers=owner).json()
    assert len(queue) == 1
    resolved = client.post(f"/api/v1/sync/review/{k2}/resolve", headers=owner, json={"action": "ATTACH_TO_CLOSED_DAY", "reason": "Confirmed with attendant"})
    assert resolved.status_code == 200, resolved.text
    assert client.get("/api/v1/sales", headers=owner).json()["total"] == 2
    versions = client.get(f"/api/v1/business-days/{day['id']}/closings", headers=owner).json()
    assert [v["kind"] for v in versions] == ["CLOSE", "ADJUSTMENT"]  # earlier version preserved


def test_login_lockout_and_audit(client, seed):
    for _ in range(5):
        r = client.post("/api/v1/auth/login", json={"username": "attendant", "password": "wrong-password"})
        assert r.status_code == 401
    locked = client.post("/api/v1/auth/login", json={"username": "attendant", "password": "Passw0rd!"})
    assert locked.status_code == 423
    owner = login(client, "OWNER")
    actions = {row["action"] for row in client.get("/api/v1/audit-logs?page_size=100", headers=owner).json()["items"]}
    assert {"LOGIN_FAILED", "ACCOUNT_LOCKED", "LOGIN"} <= actions


def test_restoration_request_is_logged_externally(client, owner):
    import os
    path = os.environ["RESTORATION_LOG_PATH"]
    if os.path.exists(path):
        os.remove(path)
    r = client.post("/api/v1/restoration-requests", headers=owner, json={
        "password": "Passw0rd!", "reason": "Corrupted data found", "recovery_point": "2026-11-09T18:00:00Z", "acknowledge_data_loss": True})
    assert r.status_code == 202, r.text
    assert "RESTORATION_REQUESTED" in open(path).read()
