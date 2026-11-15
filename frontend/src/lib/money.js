// Money is calculated in integer kobo and exchanged with the API as decimal strings.
// No floating-point arithmetic is ever used for money.

export function parseKobo(input) {
  const s = String(input ?? "").replace(/[,\s₦]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ""] = s.split(".")
  return parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10)
}

export function koboToDecimal(kobo) {
  const sign = kobo < 0 ? "-" : ""
  const abs = Math.abs(kobo)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}

export function decimalToKobo(value) {
  if (value === null || value === undefined || value === "") return 0
  const s = String(value).trim()
  const negative = s.startsWith("-")
  const kobo = parseKobo(negative ? s.slice(1) : s)
  if (kobo === null) return 0
  return negative ? -kobo : kobo
}

const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")

export function formatNaira(kobo, { showSign = false } = {}) {
  const abs = Math.abs(kobo)
  const body = `₦${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`
  if (kobo < 0) return `−${body}`
  return showSign && kobo > 0 ? `+${body}` : body
}

// Format a decimal string from the API ("3000.00") for display.
export const money = (decimalString, opts) => formatNaira(decimalToKobo(decimalString), opts)
