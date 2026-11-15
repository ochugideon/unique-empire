import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Smartphone } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { Badge, Banner, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from "@/components/kit"
import { fmtDateTime } from "@/lib/dates"
import { getDeviceId } from "@/lib/device"

const STATUS = { ACTIVE: ["ok", "Active"], LOST: ["bad", "Lost"], REVOKED: ["neutral", "Revoked"] }

export default function Devices() {
  const online = useOnline()
  const [register, setRegister] = useState(false)
  const [change, setChange] = useState(null)
  const q = useQuery({ queryKey: ["devices"], queryFn: () => api("/devices"), enabled: online, refetchInterval: online ? 30_000 : false })
  const mine = getDeviceId()

  return (
    <div>
      <PageHeader title="Devices" description="Every phone or computer that records sales must be registered by you. Revoking or marking a device lost blocks it at once."
        actions={<Button onClick={() => setRegister(true)} disabled={!online}>Register a device</Button>} />
      {!online && <Banner tone="warn" title="Needs a connection">Reconnect to manage devices.</Banner>}
      {q.isPending && online && <Skeleton className="h-40" />}
      {q.data && (q.data.length === 0 ? <Card><Empty icon={Smartphone} title="No devices yet" /></Card> : (
        <ul className="space-y-3">
          {q.data.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{d.name} <Badge tone="brand" className="ml-1">{d.device_code}</Badge>{d.device_identifier === mine && <Badge className="ml-1">This device</Badge>}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone={STATUS[d.status][0]}>{STATUS[d.status][1]}</Badge>
                    {d.status === "ACTIVE" && d.is_stale && <Badge tone="warn">Not up to date</Badge>}
                    {d.pending_count > 0 && <Badge tone="butter">{d.pending_count} waiting to sync</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">Last report {fmtDateTime(d.last_reported_at)}. Last sync {fmtDateTime(d.last_sync_at)}.</p>
                  {d.status_reason && <p className="mt-1 text-sm text-ink-soft">Note: {d.status_reason}</p>}
                </div>
                {d.status !== "REVOKED" && <Button size="sm" variant="outline" onClick={() => setChange(d)}>Change status</Button>}
              </div>
            </Card>
          ))}
        </ul>
      ))}
      <RegisterModal open={register} onClose={() => setRegister(false)} mine={mine} />
      <StatusModal device={change} onClose={() => setChange(null)} />
    </div>
  )
}

function RegisterModal({ open, onClose, mine }) {
  const [identifier, setIdentifier] = useState("")
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const valid = identifier.trim().length >= 8 && /^[A-Z0-9]{2,4}$/.test(code) && name.trim().length >= 2
  const save = useAction(() => api("/devices", { method: "POST", body: { device_identifier: identifier.trim(), device_code: code, name: name.trim() } }), {
    success: "Device registered", invalidate: ["devices"], onDone: () => { setIdentifier(""); setCode(""); setName(""); onClose() },
  })
  return (
    <Modal open={open} onClose={onClose} title="Register a device" description="Open the app on the new device. It shows an ID on its setup screen. Enter it here."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Register</Button></>}>
      <div className="space-y-4">
        <Field label="Device ID" htmlFor="di"><Input id="di" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="ue-…" autoCapitalize="none" spellCheck={false} /></Field>
        <button type="button" className="text-sm font-semibold text-brand underline underline-offset-4" onClick={() => setIdentifier(mine)}>Use this device's ID</button>
        <Field label="Device code" htmlFor="dc" hint="2 to 4 capital letters or digits. It appears in every sale reference and can never be reused.">
          <Input id="dc" value={code} maxLength={4} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1" />
        </Field>
        <Field label="Name" htmlFor="dn"><Input id="dn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Counter phone" /></Field>
      </div>
    </Modal>
  )
}

function StatusModal({ device, onClose }) {
  const [status, setStatus] = useState("LOST")
  const [reason, setReason] = useState("")
  const save = useAction(() => api(`/devices/${device.id}/status`, { method: "PATCH", body: { status, reason: reason.trim() } }), {
    success: "Device updated", invalidate: ["devices"], onDone: () => { setReason(""); onClose() },
  })
  return (
    <Modal open={!!device} onClose={onClose} size="sm" title={device ? `Change ${device.name}` : ""}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={status === "ACTIVE" ? "primary" : "danger"} loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>Confirm</Button></>}>
      <div className="space-y-4">
        <Field label="New status" htmlFor="ds">
          <Select id="ds" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="LOST">Lost (can be reactivated if found)</option>
            <option value="REVOKED">Revoked (permanent)</option>
            {device?.status === "LOST" && <option value="ACTIVE">Active again (recovered)</option>}
          </Select>
        </Field>
        {status !== "ACTIVE" && <Banner tone="warn">Records still saved on that device may not be recoverable. If it is found, its records go through review before they count.</Banner>}
        <Field label="Reason" htmlFor="dr"><Textarea id="dr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
