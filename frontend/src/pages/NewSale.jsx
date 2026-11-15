import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarX2, Clock, Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useCatalogue, useOnline, useOpenDay } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Badge, Banner, Button, Card, Empty, Field, Input, Modal, Naira, Skeleton } from "@/components/kit"
import { fmtTime } from "@/lib/dates"
import { decimalToKobo, formatNaira, koboToDecimal, parseKobo } from "@/lib/money"
import { cn, PRIVILEGED, uuid } from "@/lib/utils"
import { enqueue } from "@/offline/outbox"
import { nextReference } from "@/offline/references"
import { useSync } from "@/offline/SyncProvider"

// Menu tiles take a tint from the category, so the counter reads like the menu board.
const TONES = [
  [/shawarma|wrap|grill/i, "border-orange-200 bg-orange-50"],
  [/milk ?shake/i, "border-pink-200 bg-pink-50"],
  [/smoothie|juice/i, "border-lime-200 bg-lime-50"],
  [/parfait|dessert/i, "border-rose-200 bg-rose-50"],
  [/popcorn|snack/i, "border-amber-200 bg-amber-50"],
]
const tone = (name = "") => TONES.find(([re]) => re.test(name))?.[1] ?? "border-line bg-surface"
const METHODS = [["CASH", "Cash"], ["TRANSFER", "Transfer"], ["POS", "POS"]]

export default function NewSale() {
  const { user, hasRole } = useAuth()
  const online = useOnline()
  const sync = useSync()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const draftId = params.get("draft")

  const catQ = useCatalogue()
  const dayQ = useOpenDay()
  const day = dayQ.data?.data
  const privileged = PRIVILEGED.includes(user.role)

  const [cart, setCart] = useState([])
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [payOpen, setPayOpen] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const draft = useRef(null) // { id, version } when continuing a saved draft

  const openDay = useAction(() => api("/business-days/open", { method: "POST" }), { success: "Business day opened", invalidate: ["openDay", "dashboard"] })

  // Resume a saved draft (online only).
  const draftQ = useQuery({ queryKey: ["sale", draftId], queryFn: () => api(`/sales/${draftId}`), enabled: !!draftId && online })
  useEffect(() => {
    const sale = draftQ.data
    if (!sale || draft.current?.id === sale.id) return
    draft.current = { id: sale.id, version: sale.version }
    setCart(sale.items.map((i) => ({ variantId: i.variant_id, productName: i.product_name, variantName: i.variant_name, unitKobo: decimalToKobo(i.unit_price), qty: i.quantity })))
  }, [draftQ.data])

  const products = catQ.data?.data.products ?? []
  const categories = catQ.data?.data.categories ?? []
  const shown = useMemo(() => products.filter((p) => {
    if (filter !== "all" && p.category_id !== filter) return false
    return !search || p.name.toLowerCase().includes(search.toLowerCase())
  }), [products, filter, search])

  const total = cart.reduce((s, l) => s + l.unitKobo * l.qty, 0)
  const count = cart.reduce((s, l) => s + l.qty, 0)
  const qtyOf = (variantId) => cart.find((l) => l.variantId === variantId)?.qty ?? 0

  const add = (p, v) => setCart((c) => {
    const i = c.findIndex((l) => l.variantId === v.id)
    if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n }
    return [...c, { variantId: v.id, productName: p.name, variantName: v.name, unitKobo: decimalToKobo(v.price), qty: 1 }]
  })
  const step = (id, d) => setCart((c) => c.flatMap((l) => (l.variantId !== id ? [l] : l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }])))
  const reset = () => { setCart([]); draft.current = null; setPayOpen(false); setTicketOpen(false) }
  const itemsBody = () => cart.map((l) => ({ variant_id: l.variantId, quantity: l.qty }))

  async function saveDraft() {
    if (!online) return toast.error("Drafts are saved online. Complete the sale instead, or reconnect first.")
    setBusy(true)
    try {
      if (draft.current) await api(`/sales/${draft.current.id}`, { method: "PATCH", body: { version: draft.current.version, items: itemsBody() } })
      else await api("/sales", { method: "POST", body: { status: "DRAFT", reference: await nextReference(), items: itemsBody() } })
      toast.success("Draft saved")
      reset()
      navigate("/drafts")
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function complete(payments) {
    setBusy(true)
    try {
      if (draft.current) { // finishing a saved draft needs the server (it holds the version)
        if (!online) throw new Error("Finish saved drafts while online.")
        await api(`/sales/${draft.current.id}/complete`, { method: "POST", body: { version: draft.current.version, items: itemsBody(), payments } })
        toast.success("Sale completed")
        reset(); sync.syncNow(); navigate("/sales")
        return
      }
      const id = uuid()
      const now = new Date().toISOString()
      const reference = await nextReference()
      const payload = {
        id, reference, status: "COMPLETED", business_day_id: day.id, user_id: user.id, occurred_at: now, entered_at: now,
        items: cart.map((l) => ({ variant_id: l.variantId, quantity: l.qty, unit_price: koboToDecimal(l.unitKobo) })),
        payments,
      }
      await enqueue("SALE", payload, { label: reference, amountKobo: total, reference }) // saved on this device first
      const result = (await sync.syncNow())?.results.get(id)
      if (!result) toast.success(`Saved on this device: ${reference}`, { description: "It uploads automatically when you're back online." })
      else if (result.outcome === "ACCEPTED") toast.success(`Sale recorded: ${reference}`)
      else toast.warning(`${reference} needs attention`, { description: result.reason_detail })
      reset()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  /* ---------- blocked states ---------- */
  if (catQ.isPending || dayQ.isPending) return <div className="grid gap-4 lg:grid-cols-[1fr_22rem]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
  if (catQ.error) return <Banner tone="bad" title="Can't load the menu">{catQ.error.message} Connect to the internet once so the menu can be saved on this device.</Banner>
  if (!day && !draft.current) {
    return (
      <Card><Empty icon={CalendarX2} title={online ? "No business day is open" : "Offline sales need an open day"}
        action={online && privileged ? <Button loading={openDay.isPending} onClick={() => openDay.mutate()}>Open business day</Button> : null}>
        {online ? (privileged ? "Open the business day to start selling." : "Ask the owner or manager to open the business day.")
          : "This device hasn't seen an open business day. Connect to the internet once while a day is open, then you can keep selling offline."}
      </Empty></Card>
    )
  }

  const ticket = (
    <Ticket cart={cart} total={total} step={step} remove={(id) => setCart((c) => c.filter((l) => l.variantId !== id))}
      onPay={() => { setTicketOpen(false); setPayOpen(true) }} onDraft={saveDraft} busy={busy} isDraft={!!draft.current} online={online} />
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto font-display text-2xl font-semibold sm:text-3xl">New sale</h1>
          {dayQ.data?.stale && <Badge tone="butter"><Clock className="size-3.5" /> Day open as of last sync, {fmtTime(new Date(dayQ.data.at).toISOString())}</Badge>}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-ink-soft" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the menu" className="h-12 pl-11" aria-label="Search the menu" />
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categories">
          {[{ id: "all", name: "Everything" }, ...categories].map((c) => (
            <button key={c.id} role="tab" aria-selected={filter === c.id} onClick={() => setFilter(c.id)}
              className={cn("h-10 shrink-0 rounded-full px-4 text-sm font-semibold", filter === c.id ? "bg-ink text-white" : "bg-surface text-ink ring-1 ring-line hover:bg-ground")}>
              {c.name}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <Card><Empty icon={ShoppingBag} title="Nothing on the menu matches">{products.length ? "Try a different search or category." : "Ask the owner or manager to add products."}</Empty></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => {
              const cat = categories.find((c) => c.id === p.category_id)
              return (
                <div key={p.id} className={cn("rounded-2xl border p-3.5", tone(cat?.name))}>
                  <p className="font-display text-lg font-semibold leading-snug">{p.name}</p>
                  {cat && <p className="text-xs text-ink-soft">{cat.name}</p>}
                  <div className="mt-3 grid gap-2">
                    {p.variants.map((v) => {
                      const q = qtyOf(v.id)
                      return (
                        <button key={v.id} onClick={() => add(p, v)} aria-label={`Add ${p.name}, ${v.name}`}
                          className="relative flex min-h-14 items-center justify-between gap-3 rounded-xl bg-surface px-3.5 text-left shadow-sm ring-1 ring-black/5 transition active:scale-[0.98]">
                          <span className="text-[15px] font-medium">{v.name}</span>
                          <span className="num font-semibold">{formatNaira(decimalToKobo(v.price))}</span>
                          {q > 0 && <span className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-brand text-xs font-bold text-white">{q}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <aside className="hidden lg:block"><div className="sticky top-6">{ticket}</div></aside>

      {count > 0 && (
        <button onClick={() => setTicketOpen(true)} className="fixed inset-x-3 bottom-[4.75rem] z-20 flex h-14 items-center justify-between rounded-2xl bg-brand px-5 font-semibold text-white shadow-xl lg:hidden">
          <span>View order, {count} item{count === 1 ? "" : "s"}</span>
          <Naira kobo={total} className="font-display text-lg" />
        </button>
      )}
      <Modal open={ticketOpen} onClose={() => setTicketOpen(false)} title="Order">{ticket}</Modal>
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} total={total} busy={busy} onSubmit={complete} />
    </div>
  )
}

function Ticket({ cart, total, step, remove, onPay, onDraft, busy, isDraft, online }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{isDraft ? "Saved draft" : "Order"}</h2>
        {cart.length > 0 && <Badge tone="brand">{cart.reduce((s, l) => s + l.qty, 0)} items</Badge>}
      </div>
      <div className="tear my-4" />
      {cart.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft">Tap a size on the menu to add it.</p>
      ) : (
        <ul className="space-y-4">
          {cart.map((l) => (
            <li key={l.variantId}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-medium leading-snug">{l.productName}</p><p className="text-sm text-ink-soft">{l.variantName}, <Naira kobo={l.unitKobo} /></p></div>
                <Naira kobo={l.unitKobo * l.qty} className="font-semibold" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="icon-sm" variant="outline" aria-label={`Remove one ${l.productName}`} onClick={() => step(l.variantId, -1)}><Minus className="size-4" /></Button>
                <span className="num w-8 text-center font-semibold" aria-live="polite">{l.qty}</span>
                <Button size="icon-sm" variant="outline" aria-label={`Add one ${l.productName}`} onClick={() => step(l.variantId, 1)}><Plus className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" className="ml-auto text-bad" aria-label={`Remove ${l.productName}`} onClick={() => remove(l.variantId)}><Trash2 className="size-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="tear my-4" />
      <div className="flex items-baseline justify-between"><span className="text-ink-soft">Total</span><Naira kobo={total} className="font-display text-3xl font-semibold" /></div>
      <div className="mt-4 grid gap-2">
        <Button size="lg" disabled={cart.length === 0} loading={busy} onClick={onPay}>Take payment</Button>
        <Button variant="outline" disabled={cart.length === 0 || busy || !online} onClick={onDraft} title={online ? "" : "Drafts are saved online"}>{isDraft ? "Save changes" : "Save as draft"}</Button>
      </div>
    </Card>
  )
}

function PaymentModal({ open, onClose, total, busy, onSubmit }) {
  const [rows, setRows] = useState({ CASH: { amount: "", received: "" }, TRANSFER: { amount: "" }, POS: { amount: "" } })
  useEffect(() => { if (open) setRows({ CASH: { amount: "", received: "" }, TRANSFER: { amount: "" }, POS: { amount: "" } }) }, [open])

  const set = (m, key, v) => setRows((r) => ({ ...r, [m]: { ...r[m], [key]: v } }))
  const kobo = (m) => (rows[m].amount.trim() === "" ? 0 : parseKobo(rows[m].amount))
  const bad = METHODS.some(([m]) => kobo(m) === null) || (rows.CASH.received.trim() !== "" && parseKobo(rows.CASH.received) === null)
  const applied = bad ? 0 : METHODS.reduce((s, [m]) => s + kobo(m), 0)
  const remaining = total - applied
  const cashApplied = bad ? 0 : kobo("CASH")
  const received = rows.CASH.received.trim() === "" ? cashApplied : parseKobo(rows.CASH.received)
  const short = cashApplied > 0 && received < cashApplied
  const change = !bad && received > cashApplied ? received - cashApplied : 0
  const ready = !bad && applied === total && total > 0 && !short

  const fill = (m) => {
    const other = applied - (kobo(m) || 0)
    const need = Math.max(0, total - other)
    set(m, "amount", koboToDecimal(need))
    if (m === "CASH") set("CASH", "received", "")
  }
  const submit = () => onSubmit(METHODS.filter(([m]) => kobo(m) > 0).map(([m]) => ({
    method: m, amount_applied: koboToDecimal(kobo(m)), ...(m === "CASH" ? { cash_received: koboToDecimal(received) } : {}),
  })))

  return (
    <Modal open={open} onClose={onClose} title="Take payment" description="Split across cash, transfer and POS if needed. Only confirmed money counts."
      footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button size="lg" disabled={!ready} loading={busy} onClick={submit}>Complete sale</Button></>}>
      <div className="mb-4 flex items-baseline justify-between rounded-xl bg-ground px-4 py-3">
        <span className="text-sm text-ink-soft">Sale total</span><Naira kobo={total} className="font-display text-2xl font-semibold" />
      </div>
      <div className="space-y-4">
        {METHODS.map(([m, label]) => (
          <div key={m} className="rounded-xl border border-line p-3.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`pay-${m}`} className="font-medium">{label}</label>
              <button type="button" className="text-sm font-semibold text-brand underline underline-offset-4" onClick={() => fill(m)}>{applied === 0 || m === "CASH" ? "Full amount" : "Remaining"}</button>
            </div>
            <Input id={`pay-${m}`} inputMode="decimal" placeholder="0.00" className="mt-2 h-12 text-lg num" value={rows[m].amount} onChange={(e) => set(m, "amount", e.target.value)} invalid={kobo(m) === null} />
            {m === "CASH" && cashApplied > 0 && (
              <Field className="mt-3" label="Cash handed over" htmlFor="pay-received" error={short ? "That is less than the cash amount." : ""} hint={change > 0 ? `Change to give: ${formatNaira(change)}` : "Leave empty if it is the exact amount."}>
                <Input id="pay-received" inputMode="decimal" placeholder={koboToDecimal(cashApplied)} className="num" value={rows.CASH.received} onChange={(e) => set("CASH", "received", e.target.value)} invalid={short} />
              </Field>
            )}
            {m === "TRANSFER" && <p className="mt-2 text-xs text-ink-soft">Enter a transfer only after you've confirmed the money arrived.</p>}
          </div>
        ))}
      </div>
      <div className={cn("mt-4 flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold", remaining === 0 && total > 0 ? "bg-ok-soft text-ok" : "bg-butter-soft text-butter-ink")}>
        <span>{remaining === 0 ? "Fully paid" : remaining > 0 ? "Still to pay" : "Over by"}</span>
        <Naira kobo={Math.abs(remaining)} />
      </div>
    </Modal>
  )
}
