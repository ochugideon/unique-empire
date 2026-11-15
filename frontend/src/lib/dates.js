const TZ = "Africa/Lagos"

const parts = (date, opts) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).formatToParts(date).map((p) => [p.type, p.value]))

export function lagosYmd(date = new Date()) {
  const p = parts(date, { year: "numeric", month: "2-digit", day: "2-digit" })
  return `${p.year}-${p.month}-${p.day}`
}

// YYMMDD in business time, used inside sale references.
export const yymmdd = (date = new Date()) => lagosYmd(date).slice(2).replaceAll("-", "")

export const fmtTime = (iso) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) : "—"

export const fmtDate = (iso) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "—"

export const fmtDateTime = (iso) => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "—")

// Business dates arrive as plain "YYYY-MM-DD" strings (no timezone shift).
export const fmtBusinessDate = (ymd) =>
  ymd ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${ymd}T12:00:00Z`)) : "—"

export function timeAgo(ts) {
  if (!ts) return "never"
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 10) return "just now"
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export function duration(fromIso, to = Date.now()) {
  const mins = Math.max(0, Math.floor((to - new Date(fromIso).getTime()) / 60000))
  const h = Math.floor(mins / 60)
  return h ? `${h} h ${mins % 60} min` : `${mins} min`
}

// <input type="datetime-local"> helpers (browser-local time <-> ISO UTC)
export const toLocalInput = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
export const fromLocalInput = (value) => new Date(value).toISOString()
