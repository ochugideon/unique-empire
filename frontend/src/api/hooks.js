import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, reachable } from "@/api/client"
import { getMeta, setMeta } from "@/offline/db"

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine && reachable.get())
  useEffect(() => {
    const update = () => setOnline(navigator.onLine && reachable.get())
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    const unsub = reachable.subscribe(update)
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); unsub() }
  }, [])
  return online
}

// Fetch from the server and remember the answer; if the network is down, return the last answer marked stale.
export async function cached(key, fetcher) {
  try {
    const data = await fetcher()
    const at = Date.now()
    await setMeta(key, { data, at })
    return { data, at, stale: false }
  } catch (e) {
    if (e.status === 0) {
      const hit = await getMeta(key)
      if (hit) return { data: hit.data, at: hit.at, stale: true }
    }
    throw e
  }
}

export const useDashboard = () => {
  const online = useOnline()
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => cached("dashboard", () => api("/dashboard")),
    refetchInterval: online ? 15_000 : false, // polling, not WebSockets
    refetchIntervalInBackground: false,
  })
}

export const useOpenDay = () =>
  useQuery({ queryKey: ["openDay"], queryFn: () => cached("openDay", () => api("/business-days/current")) })

export const useCatalogue = () =>
  useQuery({
    queryKey: ["catalogue"],
    queryFn: () => cached("catalogue", async () => ({ products: await api("/products"), categories: await api("/categories") })),
  })

// Mutation helper: toast on success/failure and refresh the listed queries.
export function useAction(fn, { success, invalidate = [], onDone } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: [key] }))
      if (success) toast.success(typeof success === "function" ? success(data, vars) : success)
      onDone?.(data, vars)
    },
    onError: (e) => toast.error(e.message),
  })
}
