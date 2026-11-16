import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { LogOut } from "lucide-react"
import { api } from "@/api/client"
import { cached, useAction } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { Badge, Banner, Button, Card, Field, Input, PageHeader } from "@/components/kit"
import { fmtDateTime } from "@/lib/dates"
import { getDeviceId } from "@/lib/device"
import { useSync } from "@/offline/SyncProvider"

const schema = z.object({
  current_password: z.string().min(1, "Enter your current password"),
  new_password: z.string().min(8, "At least 8 characters"),
  confirm: z.string(),
}).refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "The two passwords don't match" })

const nameSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9._-]{3,50}$/,
      "3 to 50 letters, digits, dots, dashes or underscores",
    ),
  password: z.string().min(1, "Enter your password to confirm"),
});

const ROLE = { OWNER: "Owner", MANAGER: "Manager", ATTENDANT: "Sales attendant" }

export default function Settings() {
  const { user, logout, offline, updateUser } = useAuth();
  const { online, pending, failed, conflict, lastSyncAt, syncNow, syncing } = useSync()
  const device = useQuery({ queryKey: ["device"], queryFn: () => cached("device", () => api("/devices/me")) })
  const d = device.data?.data
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema) })
  const change = useAction((v) => api("/auth/change-password", { method: "POST", body: { current_password: v.current_password, new_password: v.new_password } }), {
    success: "Password changed. Other devices were signed out.", onDone: () => reset(),
  })

  const nameForm = useForm({
    resolver: zodResolver(nameSchema),
    defaultValues: { username: "", password: "" },
  });
  const rename = useAction(
    (v) => api("/auth/change-username", { method: "POST", body: v }),
    {
      success: "Username changed. Use the new one the next time you sign in.",
      invalidate: ["staff"],
      onDone: (updated) => {
        updateUser(updated);
        nameForm.reset();
      },
    },
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" />

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Your account</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Name</dt>
            <dd className="font-medium">{user.full_name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Username</dt>
            <dd className="font-medium">@{user.username}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Role</dt>
            <dd>
              <Badge tone="brand">{ROLE[user.role]}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Change username</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Your current username is <b>@{user.username}</b>. Your records and
          history stay with you.
        </p>
        <form
          onSubmit={nameForm.handleSubmit((v) => rename.mutate(v))}
          className="mt-4 space-y-4"
          noValidate
        >
          <Field
            label="New username"
            htmlFor="nu"
            error={nameForm.formState.errors.username?.message}
          >
            <Input
              id="nu"
              autoCapitalize="none"
              spellCheck={false}
              invalid={!!nameForm.formState.errors.username}
              {...nameForm.register("username")}
            />
          </Field>
          <Field
            label="Your password"
            htmlFor="npw"
            error={nameForm.formState.errors.password?.message}
          >
            <Input
              id="npw"
              type="password"
              autoComplete="current-password"
              invalid={!!nameForm.formState.errors.password}
              {...nameForm.register("password")}
            />
          </Field>
          <Button type="submit" loading={rename.isPending} disabled={!online}>
            Change username
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">
          Connection and sync
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={online ? "ok" : "butter"}>
            {online ? "Online" : "Offline"}
          </Badge>
          {offline && <Badge tone="warn">Offline sign-in</Badge>}
          <Badge tone={pending ? "butter" : "neutral"}>
            {pending} waiting to sync
          </Badge>
          {conflict > 0 && (
            <Badge tone="warn">{conflict} held for review</Badge>
          )}
          {failed > 0 && <Badge tone="bad">{failed} rejected</Badge>}
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Last sync:{" "}
          {lastSyncAt
            ? fmtDateTime(new Date(lastSyncAt).toISOString())
            : "not yet"}
          . The app checks every 30 seconds while it's open. It can't sync while
          closed, so open it when you're back online.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          loading={syncing}
          disabled={!online || offline}
          onClick={() => syncNow()}
        >
          Sync now
        </Button>
        {offline && (
          <Banner tone="warn" className="mt-4">
            You signed in offline. Connect and sign in again to upload your
            saved records.
          </Banner>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">This device</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-soft">Device ID</dt>
            <dd className="break-all text-right font-mono text-xs">
              {getDeviceId()}
            </dd>
          </div>
          {d && (
            <>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Name</dt>
                <dd className="font-medium">{d.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Code in references</dt>
                <dd className="font-medium">{d.device_code}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Status</dt>
                <dd>
                  <Badge tone={d.status === "ACTIVE" ? "ok" : "bad"}>
                    {d.status.toLowerCase()}
                  </Badge>
                </dd>
              </div>
            </>
          )}
        </dl>
        <p className="mt-3 text-xs text-ink-soft">
          Clearing this browser's data creates a new device identity and can
          erase records that haven't synced yet.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Change password</h2>
        <form
          onSubmit={handleSubmit((v) => change.mutate(v))}
          className="mt-4 space-y-4"
          noValidate
        >
          <Field
            label="Current password"
            htmlFor="cp"
            error={errors.current_password?.message}
          >
            <Input
              id="cp"
              type="password"
              autoComplete="current-password"
              invalid={!!errors.current_password}
              {...register("current_password")}
            />
          </Field>
          <Field
            label="New password"
            htmlFor="np"
            error={errors.new_password?.message}
          >
            <Input
              id="np"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.new_password}
              {...register("new_password")}
            />
          </Field>
          <Field
            label="Repeat new password"
            htmlFor="cf"
            error={errors.confirm?.message}
          >
            <Input
              id="cf"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.confirm}
              {...register("confirm")}
            />
          </Field>
          <Button type="submit" loading={change.isPending} disabled={!online}>
            Change password
          </Button>
        </form>
      </Card>

      <Button
        variant="outline"
        size="lg"
        className="w-full text-bad"
        onClick={() => logout()}
      >
        <LogOut className="size-5" /> Sign out
      </Button>
      <p className="pb-4 text-center text-xs text-ink-soft">
        Unique Empire, version 1.1
      </p>
    </div>
  );
}
