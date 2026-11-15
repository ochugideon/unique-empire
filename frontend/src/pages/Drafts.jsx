import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { FileText, Trash2 } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Badge, Banner, Button, Card, ConfirmModal, Empty, PageHeader, Skeleton } from "@/components/kit"
import { fmtDateTime } from "@/lib/dates"
import { money } from "@/lib/money"
import { PRIVILEGED } from "@/lib/utils"

export default function Drafts() {
  const online = useOnline()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [target, setTarget] = useState(null)
  const q = useQuery({ queryKey: ["drafts"], queryFn: () => api("/sales?status=DRAFT&page_size=100"), enabled: online })
  const del = useAction((id) => api(`/sales/${id}?confirm=true`, { method: "DELETE" }), { success: "Draft deleted", invalidate: ["drafts"], onDone: () => setTarget(null) })

  return (
    <div>
      <PageHeader title="Saved drafts" description={PRIVILEGED.includes(user.role) ? "Unfinished orders from everyone. Drafts never count as sales until they are paid." : "Your unfinished orders. They never count as sales until paid."} />
      {!online && <Banner tone="warn" title="Drafts need a connection">Reconnect to see or finish saved drafts.</Banner>}
      {online && q.isPending && <Skeleton className="h-40" />}
      {q.error && <Banner tone="bad" title="Can't load drafts">{q.error.message}</Banner>}
      {q.data && (q.data.items.length === 0 ? (
        <Card><Empty icon={FileText} title="No saved drafts">When you save an order for later, it waits here.</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {q.data.items.map((d) => (
            <Card key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold">{d.reference} <Badge className="ml-1">Draft</Badge></p>
                <p className="mt-0.5 text-sm text-ink-soft">{d.items.map((i) => `${i.quantity} × ${i.product_name}`).join(", ")}</p>
                <p className="mt-0.5 text-xs text-ink-soft">{d.staff_name}, saved {fmtDateTime(d.entered_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num mr-2 font-display text-xl font-semibold">{money(d.total_amount)}</span>
                <Button onClick={() => navigate(`/sell?draft=${d.id}`)}>Continue</Button>
                <Button variant="ghost" size="icon" aria-label="Delete draft" className="text-bad" onClick={() => setTarget(d)}><Trash2 className="size-5" /></Button>
              </div>
            </Card>
          ))}
        </ul>
      ))}
      <ConfirmModal open={!!target} onClose={() => setTarget(null)} title="Delete this draft?" danger confirmLabel="Delete draft" loading={del.isPending} onConfirm={() => del.mutate(target.id)}>
        {target?.reference} will be removed for good. The deletion is recorded in the audit log.
      </ConfirmModal>
    </div>
  )
}
