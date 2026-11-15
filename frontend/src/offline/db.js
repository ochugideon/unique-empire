import Dexie from "dexie"

// Dexie/IndexedDB holds pending records and small caches. PostgreSQL stays the source of truth.
export const db = new Dexie("unique_empire")
db.version(1).stores({
  outbox: "id, status, createdAt", // id = idempotency key (the record's own UUID)
  meta: "key",                     // device code + counter, cached open day, catalogue, offline session
  keys: "id",                      // the device's non-extractable encryption key
})

export const getMeta = async (key) => (await db.meta.get(key))?.value
export const setMeta = (key, value) => db.meta.put({ key, value })
export const delMeta = (key) => db.meta.delete(key)
