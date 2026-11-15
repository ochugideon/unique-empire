import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart3 } from "lucide-react"
import { api } from "@/api/client"
import { useOnline } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Banner, Card, Empty, Field, Input, PageHeader, Segmented, Skeleton, TableWrap, Td, Th } from "@/components/kit"
import { fmtBusinessDate } from "@/lib/dates"
import { money } from "@/lib/money"
import { PRIVILEGED, qs } from "@/lib/utils"

const PERIODS = [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "custom", label: "Custom" }]

function bucketLabel(period, bucket) {
  if (period === "daily") return fmtBusinessDate(bucket)
  if (period === "weekly") return `Week of ${fmtBusinessDate(bucket)}`
  if (period === "monthly") return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${bucket}-15T12:00:00Z`))
  return "Selected range"
}

export default function Reports() {
  const { user } = useAuth()
  const online = useOnline()
  const privileged = PRIVILEGED.includes(user.role)
  const [period, setPeriod] = useState("daily")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const custom = period === "custom"
  const ready = !custom || (from && to)
  const q = useQuery({
    queryKey: ["report", period, from, to],
    queryFn: () => api(`/reports/summary${qs({ period, date_from: custom || from ? from : "", date_to: custom || to ? to : "" })}`),
    enabled: online && !!ready,
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description="Totals are grouped by business day, so a late night stays with the day it started." />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented value={period} onChange={setPeriod} options={PERIODS} />
        {custom && <>
          <Field label="From" htmlFor="rf"><Input id="rf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
          <Field label="To" htmlFor="rt"><Input id="rt" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
        </>}
      </div>

      {!online && <Banner tone="warn" title="Reports need a connection">Reconnect to load reports.</Banner>}
      {online && custom && !ready && <Card><Empty icon={BarChart3} title="Choose a date range">Pick both dates to see the report.</Empty></Card>}
      {q.isPending && online && ready && <Skeleton className="h-56" />}
      {q.error && <Banner tone="bad" title="Can't load the report">{q.error.message}</Banner>}
      {q.data && (q.data.rows.length === 0 ? (
        <Card><Empty icon={BarChart3} title="No business days in this range">Try a wider range.</Empty></Card>
      ) : (
        <TableWrap>
          <thead><tr>
            <Th>{period === "daily" ? "Day" : period === "weekly" ? "Week" : period === "monthly" ? "Month" : "Range"}</Th>
            <Th className="text-right">Sales</Th><Th className="text-right">Transactions</Th><Th className="text-right">Items</Th>
            <Th className="text-right">Cash</Th><Th className="text-right">Transfer</Th><Th className="text-right">POS</Th>
            {privileged && <><Th className="text-right">Expenses</Th><Th className="text-right">Sales less recorded expenses</Th></>}
          </tr></thead>
          <tbody className="num">
            {[...q.data.rows.map((r) => ({ ...r, label: bucketLabel(period, r.bucket) })), { ...q.data.totals, label: "Total", total: true }].map((r) => (
              <tr key={r.label} className={r.total ? "bg-ground/60 font-semibold" : ""}>
                <Td className="font-medium">{r.label}</Td>
                <Td className="text-right">{money(r.completed_sales_total)}</Td><Td className="text-right">{r.completed_sales_count}</Td><Td className="text-right">{r.items_sold}</Td>
                <Td className="text-right">{money(r.payments_by_method.CASH)}</Td><Td className="text-right">{money(r.payments_by_method.TRANSFER)}</Td><Td className="text-right">{money(r.payments_by_method.POS)}</Td>
                {privileged && <><Td className="text-right">{money(r.expenses_total)}</Td><Td className="text-right">{money(r.sales_less_recorded_expenses)}</Td></>}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ))}
    </div>
  )
}
