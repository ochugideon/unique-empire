import { db } from "@/offline/db"
import { decryptJson, encryptJson } from "@/offline/crypto"

// status: pending (not yet acknowledged) | failed (server rejected) | conflict (held for owner/manager review)
const listeners = new Set()
export const subscribeOutbox = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = () => listeners.forEach((fn) => fn())

// `summary` is display-only text for staff (label, amountKobo). Both parts are encrypted at rest.
export async function enqueue(type, payload, summary) {
  await db.outbox.put({
    id: payload.id, // idempotency key
    type,
    status: "pending",
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    cipher: await encryptJson({ payload, summary }),
  })
  notify()
  return payload.id
}

export async function outboxCounts() {
  const rows = await db.outbox.toArray()
  const count = (s) => rows.filter((r) => r.status === s).length
  return { pending: count("pending"), failed: count("failed"), conflict: count("conflict") }
}

export async function listOutbox() {
  const rows = await db.outbox.orderBy("createdAt").reverse().toArray()
  return Promise.all(
    rows.map(async (r) => {
      let summary = {}
      try {
        summary = (await decryptJson(r.cipher)).summary || {}
      } catch {
        summary = { label: "Unreadable record" }
      }
      return { id: r.id, type: r.type, status: r.status, createdAt: r.createdAt, reasonCode: r.reasonCode, detail: r.detail, summary }
    })
  )
}

// Failed/conflict rows stay visible to staff until they dismiss them.
export async function dismiss(id) {
  const row = await db.outbox.get(id)
  if (row && row.status !== "pending") {
    await db.outbox.delete(id)
    notify()
  }
}

export const touch = notify
