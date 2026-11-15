import { useCallback, useEffect, useState } from "react"
import { dismiss, listOutbox, subscribeOutbox } from "@/offline/outbox"

export function useOutbox() {
  const [rows, setRows] = useState([])
  const load = useCallback(async () => setRows(await listOutbox()), [])
  useEffect(() => { load(); return subscribeOutbox(load) }, [load])
  return { rows, dismiss }
}
