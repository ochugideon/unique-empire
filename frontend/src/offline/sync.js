import { api } from "@/api/client"
import { db, setMeta } from "@/offline/db"
import { decryptJson } from "@/offline/crypto"
import { touch } from "@/offline/outbox"

let running = false
const BATCH = 25
const MAX_DELAY_MS = 5 * 60 * 1000

// Upload pending records. Each record syncs independently; the server returns
// ACCEPTED | REJECTED | CONFLICT per idempotency key. Local status changes only after that answer.
export async function syncNow() {
  if (running || !navigator.onLine) return null
  running = true
  const results = new Map()
  let changed = false
  try {
    const now = Date.now()
    const due = (await db.outbox.where("status").equals("pending").toArray())
      .filter((r) => !r.nextAttemptAt || r.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)
    const totalPending = await db.outbox.where("status").equals("pending").count()

    for (let i = 0; i < due.length; i += BATCH) {
      const batch = due.slice(i, i + BATCH)
      const records = await Promise.all(
        batch.map(async (r) => ({ idempotency_key: r.id, record_type: r.type, payload: (await decryptJson(r.cipher)).payload }))
      )
      let response
      try {
        response = await api("/sync/upload", {
          method: "POST",
          body: { records, pending_remaining: Math.max(0, totalPending - i - batch.length) },
        })
      } catch (e) {
        if (e.status === 0 || e.status >= 500) await backoff(batch)
        break // 401/403: the user must sign in again or the device is disabled; try later
      }
      for (const result of response.results) {
        results.set(result.idempotency_key, result)
        const row = await db.outbox.get(result.idempotency_key)
        if (!row) continue
        if (result.outcome === "ACCEPTED") {
          await db.outbox.delete(row.id)
        } else if (result.outcome === "ERROR") {
          await backoff([row])
        } else {
          await db.outbox.update(row.id, {
            status: result.outcome === "CONFLICT" ? "conflict" : "failed",
            reasonCode: result.reason_code,
            detail: result.reason_detail,
          })
        }
        changed = true
      }
    }
    if (due.length) await setMeta("lastSyncAt", Date.now())
    return { results, changed }
  } finally {
    running = false
    touch()
  }
}

async function backoff(rows) {
  const now = Date.now()
  await Promise.all(
    rows.map((r) => {
      const attempts = (r.attempts || 0) + 1
      return db.outbox.update(r.id, { attempts, nextAttemptAt: now + Math.min(2 ** attempts * 5000, MAX_DELAY_MS) })
    })
  )
}

// Tell the server how many records are still waiting on this device (closing checks this).
export async function heartbeat() {
  const pending = await db.outbox.where("status").equals("pending").count()
  return api("/devices/me/heartbeat", { method: "POST", body: { pending_count: pending } })
}
