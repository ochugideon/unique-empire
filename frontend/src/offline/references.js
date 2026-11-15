import { db, getMeta, setMeta } from "@/offline/db"
import { makeReference } from "@/lib/reference"

// Keep the device code and reference counter locally so references can be made offline.
export async function saveDevice(serverDevice) {
  const local = (await getMeta("device")) || {}
  await setMeta("device", {
    code: serverDevice.device_code,
    counter: Math.max(local.counter || 0, serverDevice.reference_counter || 0),
  })
}

export async function nextReference() {
  return db.transaction("rw", db.meta, async () => {
    const device = (await db.meta.get("device"))?.value
    if (!device?.code) throw new Error("This device has not finished setting up. Connect to the internet once and try again.")
    const counter = (device.counter || 0) + 1
    await db.meta.put({ key: "device", value: { ...device, counter } })
    return makeReference(device.code, counter)
  })
}
