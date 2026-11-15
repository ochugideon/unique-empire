import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useOnline } from "@/api/hooks"
import { useAuth } from "@/auth/AuthContext"
import { getMeta } from "@/offline/db"
import { outboxCounts, subscribeOutbox } from "@/offline/outbox"
import { heartbeat, syncNow as uploadPending } from "@/offline/sync"

const SyncContext = createContext(null)
export const useSync = () => useContext(SyncContext)

const INTERVAL_MS = 30_000 // pending check + device heartbeat while the app is active and online

export function SyncProvider({ children }) {
  const { status, offline: offlineAuth } = useAuth()
  const online = useOnline()
  const qc = useQueryClient()
  const [counts, setCounts] = useState({ pending: 0, failed: 0, conflict: 0 })
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const canSync = useRef(false)
  canSync.current = status === "authed" && !offlineAuth

  const refreshCounts = useCallback(async () => setCounts(await outboxCounts()), [])
  useEffect(() => { refreshCounts(); return subscribeOutbox(refreshCounts) }, [refreshCounts])
  useEffect(() => { getMeta("lastSyncAt").then((t) => t && setLastSyncAt(t)) }, [])

  const syncNow = useCallback(async () => {
    if (!canSync.current || !navigator.onLine) return null
    setSyncing(true)
    try {
      const result = await uploadPending()
      await heartbeat().catch(() => {})
      if (result?.changed) qc.invalidateQueries()
      if (result) setLastSyncAt(Date.now())
      return result
    } finally {
      setSyncing(false)
      refreshCounts()
    }
  }, [qc, refreshCounts])

  // Triggers: app start / sign-in, connectivity returns, app returns to the foreground, every 30 s.
  // Browsers may suspend a closed PWA, so nothing here promises background sync.
  useEffect(() => {
    if (status !== "authed" || offlineAuth) return
    syncNow()
    const onVisible = () => document.visibilityState === "visible" && syncNow()
    window.addEventListener("online", syncNow)
    document.addEventListener("visibilitychange", onVisible)
    const id = setInterval(() => document.visibilityState === "visible" && syncNow(), INTERVAL_MS)
    return () => { window.removeEventListener("online", syncNow); document.removeEventListener("visibilitychange", onVisible); clearInterval(id) }
  }, [status, offlineAuth, syncNow])

  const value = useMemo(() => ({ online, syncing, lastSyncAt, syncNow, ...counts }), [online, syncing, lastSyncAt, syncNow, counts])
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
