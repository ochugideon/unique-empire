import { getDeviceId } from "@/lib/device"

let token = null
let hooks = { refresh: null, lost: null }
export const setAccessToken = (t) => { token = t }
export const setAuthHooks = (h) => { hooks = h }

// Whether the server was reachable on the last request (drives the offline indicator).
const reach = { ok: true, subs: new Set() }
export const reachable = {
  get: () => reach.ok,
  subscribe: (fn) => { reach.subs.add(fn); return () => reach.subs.delete(fn) },
}
const setReach = (v) => {
  if (reach.ok !== v) { reach.ok = v; reach.subs.forEach((fn) => fn(v)) }
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status // 0 = network failure
    this.code = code
    this.details = details
  }
}

async function request(path, { method = "GET", body, headers = {} } = {}) {
  let res
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "X-Device-Id": getDeviceId(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    setReach(false)
    throw new ApiError(0, "NETWORK", "You are offline, or the server can't be reached right now.")
  }
  setReach(true)
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? "Something went wrong. Please try again.", err?.details)
  }
  return data
}

const LOST = ["SESSION_TIMEOUT", "SESSION_ENDED", "ACCOUNT_DISABLED"]

export async function api(path, opts = {}) {
  try {
    return await request(path, opts)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !opts.noRefresh) {
      if (["TOKEN_EXPIRED", "TOKEN_INVALID"].includes(e.code) && hooks.refresh && (await hooks.refresh())) {
        return request(path, opts)
      }
      if (LOST.includes(e.code)) hooks.lost?.(e.code)
    }
    throw e
  }
}
