"""Pure business-rule tests (no database, no third-party packages)."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.core import rules
from app.core.money import from_kobo, fmt_money, parse_money, to_kobo

UTC = timezone.utc
T0 = datetime(2026, 11, 10, 8, 0, tzinfo=UTC)


def raises(fn, *args):
    try:
        fn(*args)
    except ValueError:
        return True
    return False


def test_reference_format_and_parse():
    ref = rules.format_reference("A1", date(2026, 11, 10), 7)
    assert ref == "UE-A1-261110-007"
    parsed = rules.parse_reference(ref)
    assert parsed and parsed.device_code == "A1" and parsed.counter == 7
    assert rules.format_reference("A1", date(2026, 11, 10), 1234).endswith("-1234")
    assert rules.parse_reference("UE-a1-261110-007") is None
    assert rules.parse_reference("nonsense") is None


def test_references_from_different_devices_never_collide():
    a = rules.format_reference("A1", date(2026, 11, 10), 1)
    b = rules.format_reference("B2", date(2026, 11, 10), 1)
    assert a != b


def test_money_is_exact_and_rejects_floats():
    assert parse_money("3000.00") == Decimal("3000.00")
    assert parse_money("0.10") + parse_money("0.20") == parse_money("0.30")
    assert raises(parse_money, 3000.5)
    assert raises(parse_money, "1.234")
    assert raises(parse_money, "abc")
    assert raises(parse_money, "NaN")
    assert raises(parse_money, "99999999999.00")
    assert fmt_money(Decimal("5")) == "5.00"


def test_kobo_round_trip():
    for text in ("0.01", "3000.00", "19.99", "9999999999.99"):
        assert fmt_money(from_kobo(to_kobo(Decimal(text)))) == text


def test_offline_sale_classification():
    closed = T0 + timedelta(hours=10)
    assert rules.classify_offline_sale("OPEN", None, T0) is rules.Disposition.ATTACH
    assert rules.classify_offline_sale("CLOSED", closed, closed - timedelta(minutes=1)) is rules.Disposition.HOLD_BEFORE_CLOSE
    assert rules.classify_offline_sale("CLOSED", closed, closed + timedelta(minutes=1)) is rules.Disposition.HOLD_AFTER_CLOSE


def test_expense_three_step_assignment():
    open_day = rules.DaySpan("d1", "OPEN", T0, None)
    closed_day = rules.DaySpan("d0", "CLOSED", T0 - timedelta(days=1), T0 - timedelta(hours=2))
    # (1) day open at occurred_at
    assert rules.choose_expense_day(open_day, None) == rules.ExpenseAssignment("d1", "OCCURRED_AT")
    # (1) but that day is closed -> adjustment workflow, never attached silently
    result = rules.choose_expense_day(closed_day, open_day)
    assert result.day_id is None and result.rule == "NEEDS_ADJUSTMENT" and result.adjustment_day_id == "d0"
    # (2) nothing open at occurred_at, a day is open at entry
    assert rules.choose_expense_day(None, open_day) == rules.ExpenseAssignment("d1", "ENTERED_AT")
    # (3) otherwise unassigned
    assert rules.choose_expense_day(None, None) == rules.ExpenseAssignment(None, "UNASSIGNED")


def test_span_contains_is_half_open():
    span = rules.DaySpan("d", "CLOSED", T0, T0 + timedelta(hours=5))
    assert rules.span_contains(span, T0)
    assert not rules.span_contains(span, T0 + timedelta(hours=5))
    assert not rules.span_contains(span, T0 - timedelta(seconds=1))


def test_reconcile_and_device_staleness():
    diff = rules.reconcile({"CASH": Decimal("100.00")}, {"CASH": Decimal("90.00")})
    assert diff["CASH"] == Decimal("-10.00")
    now = T0
    assert rules.device_is_stale(None, 0, now, 12)
    assert rules.device_is_stale(now, 1, now, 12)
    assert rules.device_is_stale(now - timedelta(hours=13), 0, now, 12)
    assert not rules.device_is_stale(now - timedelta(hours=1), 0, now, 12)
