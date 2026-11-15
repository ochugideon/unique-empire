import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Check, Copy, Smartphone, ShieldOff } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/api/client"
import { cached, useAction } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Button, Card, Empty, Field, Input, Spinner } from "@/components/kit"
import { getDeviceId } from "@/lib/device"
import { saveDevice } from "@/offline/references"

// Every business record needs a registered, active device (FR-120). This gate explains what to do if not.
export default function DeviceGate({ children }) {
  const q = useQuery({ queryKey: ["device"], queryFn: () => cached("device", () => api("/devices/me")), retry: false })
  useEffect(() => { if (q.data?.data) saveDevice(q.data.data) }, [q.data])

  if (q.isPending) return <div className="grid min-h-dvh place-items-center"><Spinner className="size-8" /></div>
  if (q.error?.code === "DEVICE_REQUIRED") return <DeviceSetup onDone={() => q.refetch()} />
  if (q.error?.code === "DEVICE_NOT_ACTIVE") return <Screen><Empty icon={ShieldOff} title="This device has been disabled" action={<Button onClick={() => q.refetch()}>Check again</Button>}>The owner marked this device as lost or removed it. Ask the owner to help you.</Empty></Screen>
  if (q.error) return <Screen><Empty icon={Smartphone} title="Can't set up this device yet" action={<Button onClick={() => q.refetch()}>Try again</Button>}>{q.error.message} Connect to the internet once so the device can finish setting up.</Empty></Screen>
  return children
}

const Screen = ({ children }) => <div className="grid min-h-dvh place-items-center bg-ground p-4"><Card className="w-full max-w-md">{children}</Card></div>

const schema = z.object({
  device_code: z.string().regex(/^[A-Z0-9]{2,4}$/, "Use 2 to 4 capital letters or digits, like A1"),
  name: z.string().min(2, "Give the device a name").max(100),
})

function DeviceSetup({ onDone }) {
  const { user, logout } = useAuth()
  const id = getDeviceId()
  const [copied, setCopied] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) })
  const save = useAction((v) => api("/devices", { method: "POST", body: { device_identifier: id, ...v } }), { success: "Device registered", onDone })

  const copy = async () => {
    try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { toast.error("Couldn't copy. Select the ID and copy it by hand.") }
  }

  return (
    <Screen>
      <div className="space-y-5 p-6">
        <div>
          <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-butter-soft text-butter-ink"><Smartphone className="size-6" aria-hidden /></div>
          <h1 className="font-display text-2xl font-semibold">Register this device</h1>
          <p className="mt-1 text-sm text-ink-soft">Sales and expenses are recorded against the device that made them. Only the owner can register one.</p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">This device's ID</p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-ground p-2 pl-3.5">
            <code className="min-w-0 flex-1 break-all text-sm">{id}</code>
            <Button size="icon-sm" variant="outline" onClick={copy} aria-label="Copy device ID">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
          </div>
        </div>
        {user.role === "OWNER" ? (
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
            <Field label="Device code" htmlFor="code" error={errors.device_code?.message} hint="Appears in every sale reference from this device, e.g. UE-A1-261113-001. Codes can never be reused.">
              <Input id="code" autoCapitalize="characters" maxLength={4} invalid={!!errors.device_code} {...register("device_code", { setValueAs: (v) => v.toUpperCase() })} />
            </Field>
            <Field label="Device name" htmlFor="name" error={errors.name?.message}>
              <Input id="name" placeholder="Counter phone" invalid={!!errors.name} {...register("name")} />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Register this device</Button>
          </form>
        ) : (
          <div className="space-y-3 rounded-xl bg-ground p-4 text-sm">
            <p>Give this ID to the owner. They enter it under <b>Devices</b>, choose a short code, and register it.</p>
            <Button variant="outline" onClick={onDone}>I've been registered, check again</Button>
          </div>
        )}
        <button onClick={() => logout()} className="text-sm font-medium text-ink-soft underline underline-offset-4">Sign out</button>
      </div>
    </Screen>
  )
}
