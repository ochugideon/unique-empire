import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { Badge, Banner, Button, Card, Empty, Input, PageHeader, Pager, Segmented, Skeleton } from "@/components/kit"
import { fmtDateTime } from "@/lib/dates"
import { qs } from "@/lib/utils"
import { ScrollText } from "lucide-react"

const SEVERITY = { INFO: "neutral", WARNING: "warn", ERROR: "bad", CRITICAL: "bad" }
const pretty = (a) => a.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())

export default function Activity() {
  const online = useOnline()
  const [tab, setTab] = useState("audit")
  return (
    <div className="space-y-5">
      <PageHeader title="Activity log" description="What happened, who did it, and why. Only you can see this. Entries can't be edited or deleted." />
      <Segmented value={tab} onChange={setTab} options={[{ value: "audit", label: "Audit log" }, { value: "tech", label: "Technical events" }]} />
      {!online ? <Banner tone="warn" title="Needs a connection">Reconnect to view the activity log.</Banner> : tab === "audit" ? <Audit /> : <Tech />}
    </div>
  )
}

function Audit() {
  const [action, setAction] = useState("")
  const [page, setPage] = useState(1)
  const users = useQuery({ queryKey: ["staff"], queryFn: () => api("/users") })
  const q = useQuery({ queryKey: ["audit", action, page], queryFn: () => api(`/audit-logs${qs({ action: action.trim().toUpperCase().replaceAll(" ", "_"), page, page_size: 25 })}`), placeholderData: (p) => p })
  const who = (id) => users.data?.find((u) => u.id === id)?.full_name ?? (id ? "Unknown" : "Not signed in")
  return (
    <>
      <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} placeholder="Filter by action, for example SALE_VOID" aria-label="Filter by action" className="max-w-md" />
      {q.isPending && <Skeleton className="h-48" />}
      {q.error && <Banner tone="bad">{q.error.message}</Banner>}
      {q.data && (q.data.items.length === 0 ? <Card><Empty icon={ScrollText} title="No matching entries" /></Card> : (
        <>
          <ul className="space-y-2">
            {q.data.items.map((e) => (
              <Card key={e.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{pretty(e.action)}</p>
                  <span className="text-xs text-ink-soft">{fmtDateTime(e.created_at)}</span>
                </div>
                <p className="mt-0.5 text-sm text-ink-soft">By {who(e.actor_id)}{e.entity_type ? `, on ${e.entity_type.replace("_", " ")}` : ""}</p>
                {e.reason && <p className="mt-1 text-sm">Reason: {e.reason}</p>}
                {(e.before || e.after) && (
                  <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium text-brand">Details</summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-ground p-3 text-xs">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
                  </details>
                )}
              </Card>
            ))}
          </ul>
          <Pager page={page} pageSize={25} total={q.data.total} onPage={setPage} />
        </>
      ))}
    </>
  )
}

function Tech() {
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ["tech", page], queryFn: () => api(`/technical-events?page=${page}&page_size=25`) })
  const resolve = useAction((id) => api(`/technical-events/${id}/resolve`, { method: "POST" }), { success: "Marked as handled", invalidate: ["tech"] })
  return (
    <>
      {q.isPending && <Skeleton className="h-48" />}
      {q.error && <Banner tone="bad">{q.error.message}</Banner>}
      {q.data && (q.data.items.length === 0 ? <Card><Empty icon={ScrollText} title="No technical problems recorded">Failed backups, sync errors and unexpected errors appear here.</Empty></Card> : (
        <>
          <ul className="space-y-2">
            {q.data.items.map((e) => (
              <Card key={e.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{e.message} <Badge tone={SEVERITY[e.severity]} className="ml-1">{e.severity.toLowerCase()}</Badge> <Badge className="ml-1">{e.event_type.toLowerCase()}</Badge></p>
                    <p className="mt-0.5 text-xs text-ink-soft">{fmtDateTime(e.created_at)}</p>
                  </div>
                  {e.resolved ? <Badge tone="ok">Handled</Badge> : <Button size="sm" variant="outline" loading={resolve.isPending && resolve.variables === e.id} onClick={() => resolve.mutate(e.id)}>Mark as handled</Button>}
                </div>
                {e.context && <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium text-brand">Details</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-ground p-3 text-xs">{JSON.stringify(e.context, null, 2)}</pre></details>}
              </Card>
            ))}
          </ul>
          <Pager page={page} pageSize={25} total={q.data.total} onPage={setPage} />
        </>
      ))}
    </>
  )
}
