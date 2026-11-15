import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Wallet } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Badge, Banner, Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Segmented, Select, Skeleton, Textarea } from "@/components/kit"
import { fmtBusinessDate, fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/dates"
import { koboToDecimal, money, parseKobo } from "@/lib/money"
import { PRIVILEGED, qs, uuid } from "@/lib/utils"
import { enqueue } from "@/offline/outbox"
import { useSync } from "@/offline/SyncProvider"

const CATEGORIES = ["ingredients", "transport", "electricity", "packaging", "maintenance", "other"]
const METHOD = { CASH: "Cash", TRANSFER: "Transfer", POS: "POS" }
const label = (c) => c.charAt(0).toUpperCase() + c.slice(1)

const schema = z.object({
  amount: z.string().refine((v) => (parseKobo(v) ?? 0) > 0, "Enter an amount like 1500 or 1500.50"),
  category: z.enum(CATEGORIES),
  payment_method: z.enum(["CASH", "TRANSFER", "POS"]),
  description: z.string().trim().min(2, "Say what it was for"),
  occurred_at: z.string().min(1),
})

export default function Expenses() {
  const { user } = useAuth()
  const privileged = PRIVILEGED.includes(user.role)
  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" description={privileged ? "Record money spent and review what was recorded." : "Record money the business spent. Only the owner and manager can see expense details."} />
      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <ExpenseForm />
        {privileged && <ExpenseList />}
      </div>
    </div>
  )
}

function ExpenseForm() {
  const { user } = useAuth()
  const sync = useSync()
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { amount: "", category: "ingredients", payment_method: "CASH", description: "", occurred_at: toLocalInput() },
  })

  const onSubmit = async (v) => {
    const id = uuid()
    const now = new Date().toISOString()
    const amount = koboToDecimal(parseKobo(v.amount))
    await enqueue("EXPENSE", { id, amount, category: v.category, description: v.description, payment_method: v.payment_method, occurred_at: fromLocalInput(v.occurred_at), entered_at: now, user_id: user.id },
      { label: v.description, amountKobo: parseKobo(v.amount) })
    const result = (await sync.syncNow())?.results.get(id)
    if (!result) toast.success("Expense saved on this device", { description: "It uploads when you're back online." })
    else if (result.outcome === "ACCEPTED") toast.success(result.reason_code ? "Expense recorded, waiting for a business day" : "Expense recorded", result.reason_code ? { description: "The owner or manager will assign it to the right day." } : undefined)
    else toast.warning("Expense needs attention", { description: result.reason_detail })
    reset({ amount: "", category: v.category, payment_method: v.payment_method, description: "", occurred_at: toLocalInput() })
  }

  return (
    <Card className="self-start p-5">
      <h2 className="font-display text-lg font-semibold">Record an expense</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
        <Field label="Amount (₦)" htmlFor="amount" error={errors.amount?.message}><Input id="amount" inputMode="decimal" placeholder="0.00" className="h-12 text-lg num" invalid={!!errors.amount} {...register("amount")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="cat"><Select id="cat" {...register("category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
          <Field label="Paid by" htmlFor="pm"><Select id="pm" {...register("payment_method")}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </div>
        <Field label="What was it for?" htmlFor="desc" error={errors.description?.message}><Textarea id="desc" rows={2} placeholder="For example: chicken and vegetables from the market" invalid={!!errors.description} {...register("description")} /></Field>
        <Field label="When did it happen?" htmlFor="when" hint="Change this if you're entering it later."><Input id="when" type="datetime-local" {...register("occurred_at")} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Save expense</Button>
      </form>
    </Card>
  )
}

function ExpenseList() {
  const online = useOnline()
  const [view, setView] = useState("all")
  const [page, setPage] = useState(1)
  const [assigning, setAssigning] = useState(null)
  const q = useQuery({
    queryKey: ["expenses", view, page],
    queryFn: () => api(`/expenses${qs({ unassigned: view === "unassigned" ? "true" : "", page, page_size: 15 })}`),
    enabled: online,
  })

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Recorded expenses</h2>
        <Segmented value={view} onChange={(v) => { setView(v); setPage(1) }} options={[{ value: "all", label: "All" }, { value: "unassigned", label: "Need a day" }]} />
      </div>
      {!online && <Banner tone="warn" title="Needs a connection">Reconnect to see recorded expenses.</Banner>}
      {online && q.isPending && <Skeleton className="h-48" />}
      {q.error && <Banner tone="bad" title="Can't load expenses">{q.error.message}</Banner>}
      {q.data && (q.data.items.length === 0 ? (
        <Card><Empty icon={Wallet} title={view === "unassigned" ? "Nothing waiting" : "No expenses yet"}>{view === "unassigned" ? "Every expense belongs to a business day." : "Expenses you record appear here."}</Empty></Card>
      ) : (
        <>
          <ul className="space-y-2">
            {q.data.items.map((e) => (
              <Card key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{label(e.category)} <Badge className="ml-1">{METHOD[e.payment_method]}</Badge></p>
                  <p className="mt-0.5 text-sm text-ink-soft">{e.description}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{fmtDateTime(e.occurred_at)}</p>
                  {!e.business_day_id && <Badge tone="warn" className="mt-2">{e.suggested_business_day_id ? "Belongs to a closed day" : "Not on a business day"}</Badge>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="num font-display text-xl font-semibold">{money(e.amount)}</span>
                  {!e.business_day_id && <Button size="sm" onClick={() => setAssigning(e)}>Assign to a day</Button>}
                </div>
              </Card>
            ))}
          </ul>
          <Pager page={page} pageSize={15} total={q.data.total} onPage={setPage} />
        </>
      ))}
      <AssignModal expense={assigning} onClose={() => setAssigning(null)} />
    </section>
  )
}

function AssignModal({ expense, onClose }) {
  const [dayId, setDayId] = useState("")
  const [reason, setReason] = useState("")
  const days = useQuery({ queryKey: ["days", "pick"], queryFn: () => api("/business-days?page_size=30"), enabled: !!expense })
  const save = useAction(() => api(`/expenses/${expense.id}/assign-day`, { method: "PATCH", body: { business_day_id: dayId, reason: reason.trim() } }), {
    success: "Expense assigned", invalidate: ["expenses", "dashboard"], onDone: () => { setDayId(""); setReason(""); onClose() },
  })
  const picked = days.data?.items.find((d) => d.id === dayId)
  return (
    <Modal open={!!expense} onClose={onClose} title="Assign to a business day" description={expense ? `${label(expense.category)}, ${money(expense.amount)}` : ""}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!dayId || reason.trim().length < 3} onClick={() => save.mutate()}>Assign</Button></>}>
      <div className="space-y-4">
        <Field label="Business day" htmlFor="day">
          <Select id="day" value={dayId} onChange={(e) => setDayId(e.target.value)}>
            <option value="">Choose a day</option>
            {days.data?.items.map((d) => <option key={d.id} value={d.id}>{fmtBusinessDate(d.business_date)} ({d.status.toLowerCase()})</option>)}
          </Select>
        </Field>
        {picked?.status === "CLOSED" && <Banner tone="warn" title="This day is closed">Assigning adds a new closing version. The earlier versions stay as they are.</Banner>}
        <Field label="Reason" htmlFor="why"><Textarea id="why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: bought before opening" /></Field>
      </div>
    </Modal>
  )
}
