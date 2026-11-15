import { db } from "@/offline/db"

// AES-GCM with a device-specific, NON-extractable key kept in IndexedDB (never sent to the server).
// Losing browser data loses the key: unsynced records are then unrecoverable. This is expected and documented.
let keyPromise

async function getKey() {
  keyPromise ??= (async () => {
    const row = await db.keys.get("main")
    if (row) return row.key
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
    await db.keys.put({ id: "main", key })
    return key
  })()
  return keyPromise
}

export async function encryptJson(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(), new TextEncoder().encode(JSON.stringify(value)))
  return { iv, data }
}

export async function decryptJson({ iv, data }) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await getKey(), data)
  return JSON.parse(new TextDecoder().decode(plain))
}
