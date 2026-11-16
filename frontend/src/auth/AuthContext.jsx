import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { api, setAccessToken, setAuthHooks } from "@/api/client"
import {
  clearOfflineSession,
  loadOfflineSession,
  saveOfflineSession,
  touchOfflineSession,
  updateOfflineUser,
} from "@/offline/session";

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const CSRF = { "X-Requested-With": "UniqueEmpire" }
const IDLE_MS = 15 * 60 * 1000 // FR-009

export const NOTICES = {
  SESSION_TIMEOUT: "You were signed out after a period of inactivity. Your saved records are safe.",
  SESSION_ENDED: "Your session has ended. Please sign in again.",
  ACCOUNT_DISABLED: "This account has been deactivated.",
  IDLE: "You were signed out after 15 minutes of inactivity. Your saved records are safe.",
  SYNC: "Sign in again to upload the records saved on this device.",
}

let inflight = null
const refreshOnce = () =>
  (inflight ??= api("/auth/refresh", { method: "POST", headers: CSRF, noRefresh: true }).finally(() => { inflight = null }))

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null, offline: false, notice: "" })
  const timer = useRef(null)
  const idle = useRef(null)

  const clear = useCallback((notice = "") => {
    clearTimeout(timer.current)
    clearTimeout(idle.current)
    setAccessToken(null)
    setState({ status: "guest", user: null, offline: false, notice })
  }, [])

  // Renew the access token shortly before it expires.
  const schedule = useCallback((expiresIn) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const t = await refreshOnce()
        setAccessToken(t.access_token)
        touchOfflineSession(t.offline_authorization_expires_at)
        schedule(t.expires_in)
      } catch (e) {
        if (e.status === 0) schedule(60)
        else clear(NOTICES[e.code] || NOTICES.SESSION_ENDED)
      }
    }, Math.max((expiresIn - 60) * 1000, 10_000))
  }, [clear])

  const refreshForHooks = useCallback(async () => {
    try {
      const t = await refreshOnce()
      setAccessToken(t.access_token)
      schedule(t.expires_in)
      return true
    } catch {
      return false
    }
  }, [schedule])

  useEffect(() => {
    setAuthHooks({ refresh: refreshForHooks, lost: (code) => clear(NOTICES[code] || NOTICES.SESSION_ENDED) })
  }, [refreshForHooks, clear])

  // On start: restore the session from the secure refresh cookie, or fall back to offline access.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = await refreshOnce()
        setAccessToken(t.access_token)
        const me = await api("/auth/me")
        if (cancelled) return
        await saveOfflineSession(me, t.offline_authorization_expires_at)
        setState({ status: "authed", user: me, offline: false, notice: "" })
        schedule(t.expires_in)
      } catch (e) {
        if (cancelled) return
        if (e.status === 0) {
          const session = await loadOfflineSession()
          if (session) return setState({ status: "authed", user: session.user, offline: true, notice: "" })
        }
        setState((s) => ({ ...s, status: "guest" }))
      }
    })()
    return () => { cancelled = true }
  }, [schedule])

  // Back online after working offline: re-check the session so pending records can upload.
  useEffect(() => {
    if (!(state.status === "authed" && state.offline)) return
    const tryReconnect = async () => {
      if (!navigator.onLine) return
      try {
        const t = await refreshOnce()
        setAccessToken(t.access_token)
        const me = await api("/auth/me")
        await saveOfflineSession(me, t.offline_authorization_expires_at)
        setState({ status: "authed", user: me, offline: false, notice: "" })
        schedule(t.expires_in)
      } catch (e) {
        if (e.status === 401) clear(NOTICES.SYNC)
      }
    }
    window.addEventListener("online", tryReconnect)
    const id = setInterval(tryReconnect, 30_000)
    return () => { window.removeEventListener("online", tryReconnect); clearInterval(id) }
  }, [state.status, state.offline, schedule, clear])

  const login = useCallback(async (username, password) => {
    const data = await api("/auth/login", { method: "POST", body: { username, password }, noRefresh: true })
    setAccessToken(data.access_token)
    await saveOfflineSession(data.user, data.offline_authorization_expires_at)
    setState({ status: "authed", user: data.user, offline: false, notice: "" })
    schedule(data.expires_in)
  }, [schedule])

  const logout = useCallback(async (notice = "") => {
    try { await api("/auth/logout", { method: "POST", headers: CSRF, noRefresh: true }) } catch { /* sign out locally anyway */ }
    await clearOfflineSession()
    clear(notice) // pending records stay in the outbox
  }, [clear])

const updateUser = useCallback(async (user) => {
  setState((s) => ({ ...s, user }));
  await updateOfflineUser(user);
}, []);

  // Sign out after 15 minutes without activity while online.
  useEffect(() => {
    if (!(state.status === "authed" && !state.offline)) return
    const reset = () => {
      clearTimeout(idle.current)
      idle.current = setTimeout(() => logout(NOTICES.IDLE), IDLE_MS)
    }
    const events = ["pointerdown", "keydown", "touchstart", "scroll"]
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { events.forEach((e) => window.removeEventListener(e, reset)); clearTimeout(idle.current) }
  }, [state.status, state.offline, logout])

    const value = useMemo(
      () => ({
        ...state,
        login,
        logout,
        updateUser,
        hasRole: (...roles) => !!state.user && roles.includes(state.user.role),
      }),
      [state, login, logout, updateUser],
    );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
