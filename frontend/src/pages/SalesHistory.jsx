import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { CircleX, CloudUpload, Receipt, Search } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Badge, Banner, Button, Card, Empty, Field, Input, Modal, Pager, Segmented, Skeleton, Textarea } from "@/components/kit"
import { fmtDateTime } from "@/lib/dates"
import { formatNaira, money } from "@/lib/money"
import { qs } from "@/lib/utils"
import { useOutbox } from "@/offline/useOutbox"

const STATUS = { COMPLETED: ["ok", "Completed"], VOIDED: ["bad", "Voided"], DRAFT: ["neutral", "Draft"] }
const METHOD = { CASH: "Cash", TRANSFER: "Transfer", POS: "POS" }

export default function SalesHistory() {
  const online = useOnline()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("ALL")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState(null)
  const reference = useDeferredValue(search.trim())
  const { rows: outbox, dismiss } = useOutbox()

  const q = useQuery({
    queryKey: ["sales", reference, status, from, to, page],
    queryFn: () => api(`/sales${qs({ reference, status, date_from: from, date_to: to, page, page_size: 20 })}`),
    enabled: online,
    placeholderData: (prev) => prev,
  })
  const onDevice = outbox.filter((r) => r.type === "SALE")

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">Sales</h1>
        <p className="mt-1 text-sm text-ink-soft">Search completed, voided and saved sales.</p>
      </div>

      {onDevice.length > 0 && (
        <section aria-label="Saved on this device" className="space-y-2">
          <h2 className="font-display text-lg font-semibold">Saved on this device</h2>
          {onDevice.map((r) => {
            const tone = r.status === "pending" ? ["butter", "Waiting to sync"] : r.status === "conflict" ? ["warn", "Held for review"] : ["bad", "Rejected"]
            return (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{r.summary.reference || r.summary.label} <Badge tone={tone[0]} className="ml-1">{tone[1]}</Badge></p>
                  {r.detail && <p className="mt-1 text-sm text-ink-soft">{r.detail}</p>}
                  {r.status === "conflict" && <p className="mt-1 text-xs text-ink-soft">The owner or manager will decide where this sale belongs. Nothing is lost.</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="num font-display text-lg font-semibold">{formatNaira(r.summary.amountKobo || 0)}</span>
                  {r.status === "failed" && <Button size="sm" variant="outline" onClick={() => dismiss(r.id)}>Dismiss</Button>}
                  {r.status === "pending" && <CloudUpload className="size-5 text-ink-soft" aria-hidden />}
                </div>
              </Card>
            )
          })}
        </section>
      )}

      {!online ? (
        <Banner tone="warn" title="Sales history needs a connection">Reconnect to search past sales. Sales you made offline are listed above.</Banner>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-ink-soft" aria-hidden />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search by reference, for example UE-A1" className="pl-11" aria-label="Search by reference" />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Segmented value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: "ALL", label: "All" }, { value: "COMPLETED", label: "Completed" }, { value: "VOIDED", label: "Voided" }, { value: "DRAFT", label: "Drafts" }]} />
              <Field label="From" htmlFor="f"><Input id="f" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-40" /></Field>
              <Field label="To" htmlFor="t"><Input id="t" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="w-40" /></Field>
            </div>
          </Card>

          {q.isPending && <Skeleton className="h-56" />}
          {q.error && <Banner tone="bad" title="Can't load sales">{q.error.message}</Banner>}
          {q.data && (q.data.items.length === 0 ? (
            <Card><Empty icon={Receipt} title="No sales found">Try a different search, date or status.</Empty></Card>
          ) : (
            <>
              <ul className="space-y-2">
                {q.data.items.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setOpenId(s.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:bg-ground">
                      <div className="min-w-0">
                        <p className="font-semibold">{s.reference} <Badge tone={STATUS[s.status][0]} className="ml-1">{STATUS[s.status][1]}</Badge></p>
                        <p className="mt-0.5 truncate text-sm text-ink-soft">{s.items.map((i) => `${i.quantity} × ${i.product_name}`).join(", ")}</p>
                        <p className="mt-0.5 text-xs text-ink-soft">{s.staff_name}, {fmtDateTime(s.occurred_at)}</p>
                      </div>
                      <span className={`num font-display text-xl font-semibold ${s.status === "VOIDED" ? "text-ink-soft line-through" : ""}`}>{money(s.total_amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Pager page={page} pageSize={20} total={q.data.total} onPage={setPage} />
            </>
          ))}
        </>
      )}
      <SaleDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function SaleDetail({ id, onClose }) {
  const { user } = useAuth()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const q = useQuery({ queryKey: ["sale", id], queryFn: () => api(`/sales/${id}`), enabled: !!id })
  const void_ = useAction(() => api(`/sales/${id}/void`, { method: "POST", body: { reason: reason.trim(), password } }), {
    success: "Sale voided", invalidate: ["sales", "sale", "dashboard"], onDone: () => { setVoiding(false); setReason(""); setPassword(""); onClose() },
  })
  const s = q.data

  return (
    <Modal open={!!id} onClose={() => { setVoiding(false); onClose() }} title={s ? s.reference : "Sale"} description={s ? `${s.staff_name}, ${fmtDateTime(s.occurred_at)}` : ""}
      footer={s && s.status === "COMPLETED" && !voiding ? <Button variant="outline" className="text-bad" onClick={() => setVoiding(true)}><CircleX className="size-4" /> Void this sale</Button> : null}>
      {q.isPending && <Skeleton className="h-40" />}
      {s && (
        <div className="space-y-5">
          <div className="flex items-center justify-between"><Badge tone={STATUS[s.status][0]}>{STATUS[s.status][1]}</Badge><span className="num font-display text-3xl font-semibold">{money(s.total_amount)}</span></div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {s.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
                <span>{i.quantity} × {i.product_name}, {i.variant_name} <span className="text-ink-soft">at {money(i.unit_price)}</span>{i.price_flagged && <Badge tone="warn" className="ml-2">Price differs from menu</Badge>}</span>
                <span className="num font-medium">{money(i.subtotal)}</span>
              </li>
            ))}
          </ul>
          {s.payments.length > 0 && (
            <div>
              <h3 className="mb-2 font-display text-base font-semibold">Payments</h3>
              <ul className="space-y-1.5 text-sm">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex justify-between"><span>{METHOD[p.method]}{p.method === "CASH" && p.change_given && p.change_given !== "0.00" ? <span className="text-ink-soft">, received {money(p.cash_received)}, change {money(p.change_given)}</span> : null}</span><span className="num font-medium">{money(p.amount_applied)}</span></li>
                ))}
              </ul>
            </div>
          )}
          {s.status === "VOIDED" && <Banner tone="bad" title="Voided">{s.void_reason}. Cancelling a sale does not mean a refund was paid.</Banner>}
          {voiding && (
            <div className="space-y-3 rounded-xl border border-bad/30 bg-bad-soft/50 p-4">
              <p className="text-sm font-medium">Voiding keeps the record but removes it from sales totals. Confirm with your password.</p>
              <Field label="Reason" htmlFor="vr"><Textarea id="vr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: customer changed the order" /></Field>
              <Field label="Your password" htmlFor="vp"><Input id="vp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setVoiding(false)}>Cancel</Button>
                <Button variant="danger" loading={void_.isPending} disabled={reason.trim().length < 3 || !password} onClick={() => void_.mutate()}>Void sale</Button>
              </div>
            </div>
          )}
          {user.role === "ATTENDANT" && s.status === "COMPLETED" && <p className="text-xs text-ink-soft">To change a sale, void it and record it again. Changes are kept in the audit log.</p>}
        </div>
      )}
    </Modal>
  )
}
