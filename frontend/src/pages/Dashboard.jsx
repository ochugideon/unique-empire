import { Link } from "react-router-dom"
import { AlertTriangle, CalendarClock, CircleDot, History, ShoppingBag } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useDashboard, useOnline, useOpenDay } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Banner, Button, Card, Skeleton } from "@/components/kit"
import { duration, fmtBusinessDate, fmtTime } from "@/lib/dates"
import { decimalToKobo, formatNaira, money } from "@/lib/money"
import { PRIVILEGED } from "@/lib/utils"
import ProductBreakdown from "@/components/ProductBreakdown";

const MIX = [["CASH", "Cash", "bg-butter"], ["TRANSFER", "Transfer", "bg-white"], ["POS", "POS", "bg-[#7fd0bb]"]]

function greeting(name) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", hour12: false }).format(new Date()))
  return `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, ${name.split(" ")[0]}`
}

export default function Dashboard() {
  const { user } = useAuth()
  const online = useOnline()
  const q = useDashboard()
  const dayQ = useOpenDay()
  const privileged = PRIVILEGED.includes(user.role)
  const openDay = useAction(() => api("/business-days/open", { method: "POST" }), { success: "Business day opened", invalidate: ["dashboard", "openDay"] })

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /><Skeleton className="h-32" /></div>
  if (q.error) return <Banner tone="bad" icon={AlertTriangle} title="Can't load the dashboard">{q.error.message}</Banner>

  const { data, at, stale } = q.data
  const cur = data.current_day
  const prev = data.previous_day
  const isOpen = data.business_day_status === "OPEN" && cur
  const day = dayQ.data?.data
  const mix = cur ? MIX.map(([k, label, color]) => ({ k, label, color, kobo: decimalToKobo(cur.payments_by_method[k]) })) : []
  const mixTotal = mix.reduce((s, m) => s + m.kobo, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">
          {greeting(user.full_name)}
        </h1>
        {day && isOpen && (
          <p className="mt-1 text-sm text-ink-soft">
            Business day open for {duration(day.opened_at)}, since{" "}
            {fmtTime(day.opened_at)}
          </p>
        )}
      </div>

      {(stale || !online) && (
        <Banner
          tone="warn"
          icon={History}
          title={`Showing figures from ${fmtTime(new Date(at).toISOString())}`}
        >
          These are the last synchronized numbers and may be out of date. They
          refresh by themselves when you're back online.
        </Banner>
      )}

      {isOpen ? (
        <section
          aria-label="Today"
          className="overflow-hidden rounded-3xl bg-brand p-6 text-white sm:p-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-sm text-white/80">Completed sales today</p>
              <p className="num mt-1 font-display text-5xl font-semibold tracking-tight sm:text-6xl">
                {money(cur.completed_sales_total)}
              </p>
            </div>
            <dl className="flex gap-8 text-right">
              <div>
                <dt className="text-sm text-white/80">Transactions</dt>
                <dd className="num font-display text-3xl font-semibold">
                  {cur.completed_sales_count}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-white/80">Items sold</dt>
                <dd className="num font-display text-3xl font-semibold">
                  {cur.items_sold}
                </dd>
              </div>
            </dl>
          </div>
          <div className="mt-8">
            <div
              className="flex h-3 overflow-hidden rounded-full bg-white/15"
              role="img"
              aria-label="Share of sales by payment method"
            >
              {mixTotal > 0 &&
                mix.map(
                  (m) =>
                    m.kobo > 0 && (
                      <div
                        key={m.k}
                        className={m.color}
                        style={{ width: `${(m.kobo / mixTotal) * 100}%` }}
                      />
                    ),
                )}
            </div>
            <ul className="mt-4 grid grid-cols-3 gap-3 text-sm">
              {mix.map((m) => (
                <li key={m.k}>
                  <p className="flex items-center gap-2 text-white/80">
                    <span className={`size-2.5 rounded-full ${m.color}`} />
                    {m.label}
                  </p>
                  <p className="num mt-0.5 font-semibold">
                    {formatNaira(m.kobo)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <Card className="p-6 text-center sm:p-10">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-butter-soft text-butter-ink">
            <CalendarClock className="size-7" aria-hidden />
          </div>
          <h2 className="font-display text-xl font-semibold">
            No business day is open
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
            Sales can only be recorded while a business day is open.{" "}
            {privileged
              ? "Open one when trading starts."
              : "Ask the owner or manager to open it."}
          </p>
          {privileged && (
            <Button
              size="lg"
              className="mt-5"
              loading={openDay.isPending}
              disabled={!online}
              onClick={() => openDay.mutate()}
            >
              Open business day
            </Button>
          )}
        </Card>
      )}

      {isOpen && (
        <div className="flex flex-wrap gap-3">
          <Link
            to="/sell"
            className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-strong sm:flex-none"
          >
            <ShoppingBag className="size-5" /> New sale
          </Link>
          {privileged && (
            <Link
              to="/days"
              className="inline-flex h-14 flex-1 items-center justify-center rounded-xl border border-line bg-surface px-6 font-semibold hover:bg-ground sm:flex-none"
            >
              Close the day
            </Link>
          )}
        </div>
      )}

      {privileged &&
        (data.review_queue_count > 0 || data.unassigned_expenses > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.review_queue_count > 0 && (
              <Link to="/sync-review" className="block">
                <Banner
                  tone="warn"
                  icon={CircleDot}
                  title={`${data.review_queue_count} offline record${data.review_queue_count === 1 ? "" : "s"} need a decision`}
                >
                  Late or conflicting sales are waiting in Sync review.
                </Banner>
              </Link>
            )}
            {data.unassigned_expenses > 0 && (
              <Link to="/expenses" className="block">
                <Banner
                  tone="warn"
                  icon={CircleDot}
                  title={`${data.unassigned_expenses} expense${data.unassigned_expenses === 1 ? "" : "s"} not on a business day`}
                >
                  Assign them so they count in the right day.
                </Banner>
              </Link>
            )}
          </div>
        )}

      {isOpen && cur && (
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold">
            Items sold today
          </h2>
          <p className="mb-1 text-sm text-ink-soft">
            How many of each product, and what they came to.
          </p>
          <ProductBreakdown products={cur.products} />
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {privileged && isOpen && (
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">
              Today's expenses
            </h2>
            <p className="num mt-2 font-display text-3xl font-semibold">
              {money(cur.expenses_total)}
            </p>
            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Sales less recorded expenses</dt>
                <dd className="num font-semibold">
                  {money(cur.sales_less_recorded_expenses)}
                </dd>
              </div>
            </dl>
          </Card>
        )}
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold">
            Previous business day
          </h2>
          {prev ? (
            <>
              <p className="text-sm text-ink-soft">
                {fmtBusinessDate(prev.business_date)}
              </p>
              <p className="num mt-2 font-display text-3xl font-semibold">
                {money(prev.completed_sales_total)}
              </p>
              <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Transactions</dt>
                  <dd className="num font-semibold">
                    {prev.completed_sales_count}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Items sold</dt>
                  <dd className="num font-semibold">{prev.items_sold}</dd>
                </div>
                {privileged && (
                  <div className="flex justify-between">
                    <dt className="text-ink-soft">
                      Sales less recorded expenses
                    </dt>
                    <dd className="num font-semibold">
                      {money(prev.sales_less_recorded_expenses)}
                    </dd>
                  </div>
                )}
              </dl>
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand">
                  Items sold that day
                </summary>
                <div className="mt-2">
                  <ProductBreakdown products={prev.products} />
                </div>
              </details>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">
              No business day has been closed yet.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
