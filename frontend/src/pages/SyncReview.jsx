import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2 } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { Badge, Banner, Button, Card, Empty, Field, Modal, PageHeader, Skeleton, Textarea } from "@/components/kit"
import { fmtDateTime } from "@/lib/dates"
import { decimalToKobo, formatNaira } from "@/lib/money"

const REASONS = {
  LATE_DAY_CLOSED: ["warn", "Sold before the day closed", ["ATTACH_TO_CLOSED_DAY", "REJECT"]],
  AFTER_CLOSE_TIME: ["warn", "Sold after the day closed", ["ASSIGN_TO_OPEN_DAY", "REJECT"]],
  RESTORE_REUPLOAD: ["butter", "Re-sent after a restore", ["ATTACH_TO_CLOSED_DAY", "ASSIGN_TO_OPEN_DAY", "REJECT"]],
}
const ACTIONS = {
  ATTACH_TO_CLOSED_DAY: ["Attach to its day", "Adds the record to the closed day and creates a new closing version. Earlier versions stay."],
  ASSIGN_TO_OPEN_DAY: ["Add to the open day", "Counts the record in the business day that is open now."],
  REJECT: ["Reject", "The record is not added. Use this for duplicates or mistakes."],
}

function describe(r) {
  const p = r.payload || {}
  if (r.record_type === "EXPENSE") return { title: `Expense, ${p.category || ""}`, amount: decimalToKobo(p.amount), line: p.description }
  if (r.record_type === "SALE_UPDATE") return { title: "Completing a saved sale", amount: (p.payments || []).reduce((s, x) => s + decimalToKobo(x.amount_applied), 0), line: p.sale_id }
  const amount = (p.payments || []).reduce((s, x) => s + decimalToKobo(x.amount_applied), 0)
  return { title: `Sale ${p.reference || ""}`, amount, line: `${(p.items || []).reduce((s, i) => s + i.quantity, 0)} items` }
}

export default function SyncReview() {
  const online = useOnline()
  const [picked, setPicked] = useState(null)
  const q = useQuery({ queryKey: ["syncReview"], queryFn: () => api("/sync/review"), enabled: online, refetchInterval: online ? 30_000 : false })

  return (
    <div>
      <PageHeader title="Sync review" description="Offline records the system could not place on its own. Nothing here is lost, and nothing is added until you decide." />
      {!online && <Banner tone="warn" title="Needs a connection">Reconnect to review offline records.</Banner>}
      {online && q.isPending && <Skeleton className="h-40" />}
      {q.error && <Banner tone="bad" title="Can't load the review queue">{q.error.message}</Banner>}
      {q.data && (q.data.length === 0 ? (
        <Card><Empty icon={CheckCircle2} title="Nothing to review">Late or conflicting offline records will show up here.</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {q.data.map((r) => {
            const meta = REASONS[r.reason_code] || ["bad", r.reason_code || "Rejected", ["REJECT"]]
            const d = describe(r)
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{d.title} <Badge tone={meta[0]} className="ml-1">{meta[1]}</Badge></p>
                    <p className="mt-1 text-sm text-ink-soft">{r.reason_detail}</p>
                    <p className="mt-1 text-xs text-ink-soft">{d.line}. Uploaded {fmtDateTime(r.received_at)}.</p>
                  </div>
                  <span className="num font-display text-xl font-semibold">{formatNaira(d.amount)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {meta[2].map((a) => <Button key={a} size="sm" variant={a === "REJECT" ? "outline" : "primary"} onClick={() => setPicked({ record: r, action: a })}>{ACTIONS[a][0]}</Button>)}
                </div>
              </Card>
            )
          })}
        </ul>
      ))}
      <Decision picked={picked} onClose={() => setPicked(null)} />
    </div>
  )
}

function Decision({ picked, onClose }) {
  const [reason, setReason] = useState("")
  const save = useAction(() => api(`/sync/review/${picked.record.id}/resolve`, { method: "POST", body: { action: picked.action, reason: reason.trim() } }), {
    success: "Decision saved", invalidate: ["syncReview", "dashboard", "days", "sales", "expenses"], onDone: () => { setReason(""); onClose() },
  })
  return (
    <Modal open={!!picked} onClose={onClose} size="sm" title={picked ? ACTIONS[picked.action][0] : ""} description={picked ? ACTIONS[picked.action][1] : ""}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={picked?.action === "REJECT" ? "danger" : "primary"} loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>Confirm</Button></>}>
      <Field label="Reason (saved in the audit log)" htmlFor="dr"><Textarea id="dr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  )
}
