import { useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { Banner, Button, Card, Checkbox, Field, Input, PageHeader, Textarea } from "@/components/kit"
import { fromLocalInput, toLocalInput } from "@/lib/dates"

export default function Restoration() {
  const online = useOnline()
  const [point, setPoint] = useState(toLocalInput(new Date(Date.now() - 3600_000)))
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [ack, setAck] = useState(false)
  const [done, setDone] = useState(null)
  const send = useAction(() => api("/restoration-requests", { method: "POST", body: { password, reason: reason.trim(), recovery_point: fromLocalInput(point), acknowledge_data_loss: ack } }), {
    onDone: (r) => { setDone(r); setPassword(""); setReason(""); setAck(false) },
  })

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 className="size-7" /></div>
          <h1 className="font-display text-2xl font-semibold">Request recorded</h1>
          <p className="mt-2 text-sm text-ink-soft">{done.message}</p>
          <p className="mt-4 rounded-xl bg-ground p-3 text-xs text-ink-soft">Request ID: <code className="break-all">{done.request_id}</code></p>
          <Button variant="outline" className="mt-5" onClick={() => setDone(null)}>Make another request</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title="Restoration" description="Ask the administrator to restore the database to an earlier point. This request does not restore anything by itself." />
      {!online && <Banner tone="warn" title="Needs a connection">Restoration requests need online authorization.</Banner>}
      <Banner tone="bad" icon={AlertTriangle} title="Everything recorded after the recovery point will be lost">
        Sales, expenses and changes made after that moment are removed from the server. Devices then re-send what they hold, and those records come to Sync review for a decision.
      </Banner>
      <Card className="space-y-4 p-5">
        <Field label="Recover to this point in time" htmlFor="pt"><Input id="pt" type="datetime-local" value={point} onChange={(e) => setPoint(e.target.value)} /></Field>
        <Field label="Reason" htmlFor="rr" hint="Saved in the audit log and in a separate log outside the database."><Textarea id="rr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What went wrong?" /></Field>
        <Field label="Your password" htmlFor="rpw"><Input id="rpw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} label="I understand that data created after this point will be lost." />
        <Button size="lg" variant="danger" className="w-full" loading={send.isPending} disabled={!online || !ack || reason.trim().length < 3 || !password || !point} onClick={() => send.mutate()}>Send restoration request</Button>
      </Card>
    </div>
  )
}
