const KEY = "ue_device_id"

// Browsers give no dependable hardware ID, so the app makes its own and keeps it in browser storage.
// Clearing browser data creates a new identity, which the owner must register again.
export function getDeviceId() {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = `ue-${crypto.randomUUID()}`
    localStorage.setItem(KEY, id)
  }
  return id
}
