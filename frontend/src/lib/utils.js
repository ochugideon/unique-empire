import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export const cn = (...inputs) => twMerge(clsx(inputs))
export const PRIVILEGED = ["OWNER", "MANAGER"]
export const uuid = () => crypto.randomUUID()
export const qs = (params) => {
  const s = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v))
  })
  const out = s.toString()
  return out ? `?${out}` : ""
}
