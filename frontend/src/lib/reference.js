import { yymmdd } from "@/lib/dates"

// UE-{DEV}-{YYMMDD}-{NNN}: device code + device-local date + per-device counter (FR-151)
export const makeReference = (deviceCode, counter, date = new Date()) =>
  `UE-${deviceCode}-${yymmdd(date)}-${String(counter).padStart(3, "0")}`
