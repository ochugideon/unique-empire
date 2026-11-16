import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, History, LockOpen, ListChecks } from "lucide-react";
import { api } from "@/api/client";
import { useAction, useOnline, useOpenDay } from "@/api/hooks";
import { useAuth } from "@/auth/AuthContext";
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Pager,
  Skeleton,
  Textarea,
} from "@/components/kit";
import { duration, fmtDateTime, fmtBusinessDate, fmtTime } from "@/lib/dates";
import {
  decimalToKobo,
  formatNaira,
  koboToDecimal,
  money,
  parseKobo,
} from "@/lib/money";
import { cn } from "@/lib/utils";
import ProductBreakdown from "@/components/ProductBreakdown";

const METHODS = [
  ["CASH", "Cash"],
  ["TRANSFER", "Transfer"],
  ["POS", "POS"],
];
const REFRESH = ["days", "openDay", "dashboard"];

export default function BusinessDays() {
  const online = useOnline();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [closing, setClosing] = useState(null);
  const [reopening, setReopening] = useState(null);
  const [history, setHistory] = useState(null);
    const [items, setItems] = useState(null);
  const openQ = useOpenDay();
  const open = openQ.data?.data;
  const list = useQuery({
    queryKey: ["days", page],
    queryFn: () => api(`/business-days?page=${page}&page_size=15`),
    enabled: online,
  });
  const openDay = useAction(
    () => api("/business-days/open", { method: "POST" }),
    { success: "Business day opened", invalidate: REFRESH },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business days"
        description="A business day is a trading session, not a calendar date. It can run past midnight."
      />
      {!online && (
        <Banner
          tone="warn"
          title="Opening, closing and reopening need a connection"
        >
          Reconnect to manage business days.
        </Banner>
      )}

      <Card className="p-5">
        {open ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Badge tone="ok">Open</Badge>
              <p className="mt-2 font-display text-xl font-semibold">
                {fmtBusinessDate(open.business_date)}
              </p>
              <p className="text-sm text-ink-soft">
                Open for {duration(open.opened_at)}, since{" "}
                {fmtTime(open.opened_at)}
              </p>
            </div>
            <Button
              size="lg"
              disabled={!online}
              onClick={() => setClosing(open)}
            >
              Close the day
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Badge>No day open</Badge>
              <p className="mt-2 text-sm text-ink-soft">
                Sales are blocked until a business day is open.
              </p>
            </div>
            <Button
              size="lg"
              loading={openDay.isPending}
              disabled={!online}
              onClick={() => openDay.mutate()}
            >
              <CalendarClock className="size-5" /> Open business day
            </Button>
          </div>
        )}
      </Card>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Past days</h2>
        {list.isPending && online && <Skeleton className="h-40" />}
        {list.data && (
          <>
            <ul className="space-y-2">
              {list.data.items.map((d) => (
                <Card
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="font-semibold">
                      {fmtBusinessDate(d.business_date)}{" "}
                      <Badge
                        tone={d.status === "OPEN" ? "ok" : "neutral"}
                        className="ml-1"
                      >
                        {d.status === "OPEN" ? "Open" : "Closed"}
                      </Badge>
                      {d.reopen_count > 0 && (
                        <Badge tone="warn" className="ml-1">
                          Reopened {d.reopen_count}×
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {fmtDateTime(d.opened_at)}
                      {d.closed_at ? ` to ${fmtDateTime(d.closed_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setItems(d)}
                    >
                      <ListChecks className="size-4" /> Items sold
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setHistory(d)}
                    >
                      <History className="size-4" /> Closings
                    </Button>
                    {d.status === "CLOSED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!online || !!open}
                        title={open ? "Close the open day first" : ""}
                        onClick={() => setReopening(d)}
                      >
                        <LockOpen className="size-4" /> Reopen
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </ul>
            <Pager
              page={page}
              pageSize={15}
              total={list.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      <CloseModal
        day={closing}
        isOwner={user.role === "OWNER"}
        onClose={() => setClosing(null)}
      />
      <ReopenModal day={reopening} onClose={() => setReopening(null)} />
      <HistoryModal day={history} onClose={() => setHistory(null)} />
      <ItemsModal day={items} onClose={() => setItems(null)} />
    </div>
  );
}

function CloseModal({ day, isOwner, onClose }) {
  const [counted, setCounted] = useState({ CASH: "", TRANSFER: "", POS: "" });
  const [why, setWhy] = useState({});
  const [exception, setException] = useState("");
  const [blocked, setBlocked] = useState(null);
  const [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["summary", day?.id],
    queryFn: () => api(`/business-days/${day.id}/summary`),
    enabled: !!day,
  });
  const s = q.data;

  const expected = (m) =>
    s
      ? decimalToKobo(s.payments_by_method[m]) -
        decimalToKobo(s.expenses_by_method[m])
      : 0;
  const countedKobo = (m) =>
    counted[m].trim() === "" ? null : parseKobo(counted[m]);
  const diff = (m) =>
    countedKobo(m) === null ? null : countedKobo(m) - expected(m);
  const allCounted = METHODS.every(([m]) => countedKobo(m) !== null);
  const needsWhy = METHODS.filter(([m]) => diff(m) && !(why[m] || "").trim());

  const submit = useAction(
    (finalize) =>
      api(`/business-days/${day.id}/close`, {
        method: "POST",
        body: {
          actual_cash: koboToDecimal(countedKobo("CASH")),
          actual_transfer: koboToDecimal(countedKobo("TRANSFER")),
          actual_pos: koboToDecimal(countedKobo("POS")),
          explanations: Object.fromEntries(
            METHODS.filter(([m]) => (why[m] || "").trim()).map(([m]) => [
              m,
              why[m].trim(),
            ]),
          ),
          finalize,
          ...(exception.trim()
            ? { exceptional_closing_reason: exception.trim() }
            : {}),
        },
      }),
    {
      success: (r) =>
        r.closing.status === "FINAL"
          ? "Business day closed"
          : "Closing prepared",
      invalidate: REFRESH,
      onDone: () => {
        setCounted({ CASH: "", TRANSFER: "", POS: "" });
        setWhy({});
        setException("");
        setBlocked(null);
        onClose();
      },
    },
  );
  const run = (finalize) => {
    setError("");
    setBlocked(null);
    submit.mutate(finalize, {
      onError: (e) => {
        if (e.code === "DEVICES_NOT_SYNCED")
          setBlocked(e.details?.devices || []);
        else setError(e.message);
      },
    });
  };

  return (
    <Modal
      open={!!day}
      onClose={onClose}
      size="lg"
      title="Close the business day"
      description="Count the money, compare it with what the system expects, then close."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={!allCounted}
            loading={submit.isPending && submit.variables === false}
            onClick={() => run(false)}
          >
            Save as prepared
          </Button>
          <Button
            disabled={
              !allCounted ||
              needsWhy.length > 0 ||
              (blocked && !isOwner) ||
              (blocked && !exception.trim())
            }
            loading={submit.isPending && submit.variables === true}
            onClick={() => run(true)}
          >
            Close day
          </Button>
        </>
      }
    >
      {q.isPending && <Skeleton className="h-48" />}
      {s && (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl bg-ground p-3">
              <dt className="text-ink-soft">Sales</dt>
              <dd className="num font-display text-lg font-semibold">
                {money(s.completed_sales_total)}
              </dd>
            </div>
            <div className="rounded-xl bg-ground p-3">
              <dt className="text-ink-soft">Expenses</dt>
              <dd className="num font-display text-lg font-semibold">
                {money(s.expenses_total)}
              </dd>
            </div>
            <div className="rounded-xl bg-ground p-3">
              <dt className="text-ink-soft">Transactions</dt>
              <dd className="num font-display text-lg font-semibold">
                {s.completed_sales_count}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-ink-soft">
            Expected = money received by that method minus expenses paid by that
            method. "Sales less recorded expenses" is not profit.
          </p>
          <div className="space-y-3">
            {METHODS.map(([m, label]) => {
              const d = diff(m);
              return (
                <div key={m} className="rounded-xl border border-line p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{label}</p>
                    <p className="text-sm text-ink-soft">
                      Expected{" "}
                      <span className="num font-semibold text-ink">
                        {formatNaira(expected(m))}
                      </span>
                    </p>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Input
                      aria-label={`${label} counted`}
                      inputMode="decimal"
                      placeholder="Counted amount"
                      className="num"
                      value={counted[m]}
                      onChange={(e) =>
                        setCounted((c) => ({ ...c, [m]: e.target.value }))
                      }
                      invalid={counted[m] !== "" && countedKobo(m) === null}
                    />
                    {d !== null && (
                      <Badge tone={d === 0 ? "ok" : "bad"}>
                        {d === 0
                          ? "Matches"
                          : formatNaira(d, { showSign: true })}
                      </Badge>
                    )}
                  </div>
                  {d ? (
                    <Textarea
                      aria-label={`${label} explanation`}
                      rows={2}
                      className="mt-2"
                      placeholder="Explain the difference (required)"
                      value={why[m] || ""}
                      onChange={(e) =>
                        setWhy((w) => ({ ...w, [m]: e.target.value }))
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          {blocked && (
            <Banner tone="bad" title="Some devices haven't synchronized">
              <ul className="mt-1 list-disc pl-5">
                {blocked.map((d) => (
                  <li key={d.id}>
                    {d.name} ({d.code}): {d.pending_count} waiting, last report{" "}
                    {d.last_reported_at
                      ? fmtDateTime(d.last_reported_at)
                      : "never"}
                  </li>
                ))}
              </ul>
              {isOwner ? (
                <Field
                  className="mt-3"
                  label="Owner exception: why can you close anyway?"
                  htmlFor="ex"
                >
                  <Textarea
                    id="ex"
                    value={exception}
                    onChange={(e) => setException(e.target.value)}
                    placeholder="For example: the kitchen tablet is broken"
                  />
                </Field>
              ) : (
                <p className="mt-2">
                  Ask the owner to authorize an exception, or have these devices
                  sync first.
                </p>
              )}
            </Banner>
          )}
          {error && <Banner tone="bad">{error}</Banner>}
        </div>
      )}
    </Modal>
  );
}

function ReopenModal({ day, onClose }) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const save = useAction(
    () =>
      api(`/business-days/${day.id}/reopen`, {
        method: "POST",
        body: { reason: reason.trim(), password },
      }),
    {
      success: "Business day reopened",
      invalidate: REFRESH,
      onDone: () => {
        setReason("");
        setPassword("");
        onClose();
      },
    },
  );
  return (
    <Modal
      open={!!day}
      onClose={onClose}
      size="sm"
      title="Reopen this day"
      description={day ? fmtBusinessDate(day.business_date) : ""}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={reason.trim().length < 3 || !password}
            onClick={() => save.mutate()}
          >
            Reopen
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Banner tone="warn">
          Closing again creates a new closing version. The earlier versions are
          kept.
        </Banner>
        <Field label="Reason" htmlFor="rr">
          <Textarea
            id="rr"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field label="Your password" htmlFor="rp">
          <Input
            id="rp"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function HistoryModal({ day, onClose }) {
  const q = useQuery({
    queryKey: ["closings", day?.id],
    queryFn: () => api(`/business-days/${day.id}/closings`),
    enabled: !!day,
  });
  return (
    <Modal
      open={!!day}
      onClose={onClose}
      size="lg"
      title="Closing history"
      description={day ? fmtBusinessDate(day.business_date) : ""}
    >
      {q.isPending && <Skeleton className="h-32" />}
      {q.data?.length === 0 && (
        <p className="text-sm text-ink-soft">
          This day hasn't been closed yet.
        </p>
      )}
      <ul className="space-y-3">
        {q.data?.map((c) => (
          <li key={c.id} className="rounded-xl border border-line p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                Version {c.version}{" "}
                <Badge
                  className="ml-1"
                  tone={c.status === "FINAL" ? "ok" : "neutral"}
                >
                  {c.kind === "ADJUSTMENT"
                    ? "Adjustment"
                    : c.status === "FINAL"
                      ? "Closed"
                      : "Prepared"}
                </Badge>
              </p>
              <span className="text-ink-soft">{fmtDateTime(c.created_at)}</span>
            </div>
            <table className="num mt-2 w-full">
              <tbody>
                {[
                  ["Cash", c.expected_cash, c.actual_cash],
                  ["Transfer", c.expected_transfer, c.actual_transfer],
                  ["POS", c.expected_pos, c.actual_pos],
                ].map(([l, e, a]) => (
                  <tr key={l}>
                    <td className="py-0.5 text-ink-soft">{l}</td>
                    <td>Expected {money(e)}</td>
                    <td>Counted {money(a)}</td>
                    <td
                      className={cn(
                        "text-right font-semibold",
                        decimalToKobo(a) !== decimalToKobo(e) && "text-bad",
                      )}
                    >
                      {formatNaira(decimalToKobo(a) - decimalToKobo(e), {
                        showSign: true,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c.reason && (
              <p className="mt-2 text-ink-soft">Reason: {c.reason}</p>
            )}
            {c.exceptional_reason && (
              <Badge tone="warn" className="mt-2">
                Owner exception: {c.exceptional_reason}
              </Badge>
            )}
            {c.explanations &&
              Object.entries(c.explanations)
                .filter(([k]) => k !== "ADJUSTMENT")
                .map(([k, v]) => (
                  <p key={k} className="mt-1 text-ink-soft">
                    {k.charAt(0) + k.slice(1).toLowerCase()}: {v}
                  </p>
                ))}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ItemsModal({ day, onClose }) {
  const q = useQuery({
    queryKey: ["summary", day?.id],
    queryFn: () => api(`/business-days/${day.id}/summary`),
    enabled: !!day,
  });
  return (
    <Modal
      open={!!day}
      onClose={onClose}
      title="Items sold"
      description={day ? fmtBusinessDate(day.business_date) : ""}
    >
      {q.isPending && <Skeleton className="h-40" />}
      {q.data && <ProductBreakdown products={q.data.products} />}
    </Modal>
  );
}