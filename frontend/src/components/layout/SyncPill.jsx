import { AlertTriangle, CloudUpload, Loader2, Wifi, WifiOff } from "lucide-react"
import { useSync } from "@/offline/SyncProvider"
import { cn } from "@/lib/utils"

// One small, always-visible answer to "is my work safe?"
export default function SyncPill({ className }) {
  const { online, syncing, pending, failed, conflict, syncNow } = useSync()
  const attention = failed + conflict
  let tone = "bg-ok-soft text-ok", Icon = Wifi, label = "All synced"
  if (!online) { tone = "bg-butter-soft text-butter-ink"; Icon = WifiOff; label = pending ? `Offline, ${pending} saved` : "Offline" }
  else if (syncing) { tone = "bg-brand-soft text-brand-strong"; Icon = Loader2; label = "Syncing" }
  else if (attention) { tone = "bg-bad-soft text-bad"; Icon = AlertTriangle; label = `${attention} need${attention === 1 ? "s" : ""} attention` }
  else if (pending) { tone = "bg-butter-soft text-butter-ink"; Icon = CloudUpload; label = `${pending} waiting to sync` }
  return (
    <button
      onClick={() => syncNow()}
      title="Tap to sync now"
      className={cn("inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold", tone, className)}
    >
      <Icon className={cn("size-4", syncing && online && "animate-spin")} aria-hidden />
      {label}
    </button>
  )
}
