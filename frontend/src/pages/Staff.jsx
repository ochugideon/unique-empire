import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { KeyRound, UserPlus } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Badge, Banner, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Skeleton } from "@/components/kit"

const ROLE = { OWNER: "Owner", MANAGER: "Manager", ATTENDANT: "Sales attendant" }
const createSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, "3 to 50 letters, digits, dots, dashes or underscores"),
  full_name: z.string().trim().min(2, "Enter the full name"),
  password: z.string().min(8, "At least 8 characters").refine((v) => new TextEncoder().encode(v).length <= 72, "Too long"),
  role: z.enum(["OWNER", "MANAGER", "ATTENDANT"]),
})

export default function Staff() {
  const online = useOnline()
  const { user: me } = useAuth()
  const [modal, setModal] = useState(null)
  const q = useQuery({ queryKey: ["staff"], queryFn: () => api("/users"), enabled: online })
  return (
    <div>
      <PageHeader title="Staff" description="Only the owner creates accounts and assigns roles. Deactivated staff keep their history but can no longer sign in."
        actions={<Button onClick={() => setModal({ type: "create" })} disabled={!online}><UserPlus className="size-4" /> Add staff</Button>} />
      {!online && <Banner tone="warn" title="Needs a connection">Reconnect to manage staff.</Banner>}
      {q.isPending && online && <Skeleton className="h-40" />}
      {q.error && <Banner tone="bad" title="Can't load staff">{q.error.message}</Banner>}
      <ul className="space-y-2">
        {q.data?.map((u) => (
          <Card key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold">{u.full_name} {u.id === me.id && <Badge className="ml-1">You</Badge>}</p>
              <p className="text-sm text-ink-soft">@{u.username}</p>
              <div className="mt-2 flex gap-2"><Badge tone="brand">{ROLE[u.role]}</Badge>{!u.is_active && <Badge tone="bad">Deactivated</Badge>}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setModal({ type: "edit", user: u })}>Edit</Button>
              <Button size="sm" variant="outline" onClick={() => setModal({ type: "reset", user: u })}><KeyRound className="size-4" /> Reset password</Button>
            </div>
          </Card>
        ))}
      </ul>
      <CreateModal open={modal?.type === "create"} onClose={() => setModal(null)} />
      <EditModal user={modal?.type === "edit" ? modal.user : null} isSelf={modal?.user?.id === me.id} onClose={() => setModal(null)} />
      <ResetModal user={modal?.type === "reset" ? modal.user : null} onClose={() => setModal(null)} />
    </div>
  )
}

function CreateModal({ open, onClose }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(createSchema), defaultValues: { role: "ATTENDANT" } })
  const save = useAction((v) => api("/users", { method: "POST", body: v }), { success: "Account created", invalidate: ["staff"], onDone: () => { reset(); onClose() } })
  return (
    <Modal open={open} onClose={onClose} title="Add a staff member" description="Give them the username and password. They can change the password after signing in."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="create-staff" loading={save.isPending}>Create account</Button></>}>
      <form id="create-staff" onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="sn" error={errors.full_name?.message}><Input id="sn" invalid={!!errors.full_name} {...register("full_name")} /></Field>
        <Field label="Username" htmlFor="su" error={errors.username?.message}><Input id="su" autoCapitalize="none" invalid={!!errors.username} {...register("username")} /></Field>
        <Field label="Temporary password" htmlFor="sp" error={errors.password?.message}><Input id="sp" type="text" autoComplete="off" invalid={!!errors.password} {...register("password")} /></Field>
        <Field label="Role" htmlFor="sr"><Select id="sr" {...register("role")}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </form>
    </Modal>
  )
}

function EditModal({ user, isSelf, onClose }) {
  const [name, setName] = useState("")
  const [role, setRole] = useState("ATTENDANT")
  const [active, setActive] = useState(true)
  const [seed, setSeed] = useState(null)
  if (user && seed !== user.id) { setSeed(user.id); setName(user.full_name); setRole(user.role); setActive(user.is_active) }
  const save = useAction(() => api(`/users/${user.id}`, { method: "PATCH", body: { full_name: name.trim(), role, is_active: active } }), { success: "Saved", invalidate: ["staff"], onDone: () => { setSeed(null); onClose() } })
  return (
    <Modal open={!!user} onClose={() => { setSeed(null); onClose() }} title="Edit staff member" size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Full name" htmlFor="en"><Input id="en" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role" htmlFor="er" hint={isSelf ? "You can't change your own role." : "Changing a role signs the person out."}><Select id="er" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Checkbox checked={active} disabled={isSelf} onChange={(e) => setActive(e.target.checked)} label="Account is active" />
        {!active && <Banner tone="warn">They will be signed out and can't sign in. A device that is offline may keep working until it reconnects, for up to 7 days.</Banner>}
      </div>
    </Modal>
  )
}

function ResetModal({ user, onClose }) {
  const [pw, setPw] = useState("")
  const save = useAction(() => api(`/users/${user.id}/reset-password`, { method: "POST", body: { new_password: pw } }), { success: "Password reset", onDone: () => { setPw(""); onClose() } })
  return (
    <Modal open={!!user} onClose={onClose} size="sm" title="Reset password" description={user?.full_name}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={pw.length < 8} onClick={() => save.mutate()}>Reset password</Button></>}>
      <Field label="New password" htmlFor="rp" hint="At least 8 characters. You never see the old one. They're signed out everywhere."><Input id="rp" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
    </Modal>
  )
}
