import { delMeta, getMeta, setMeta } from "@/offline/db"
import { decryptJson, encryptJson } from "@/offline/crypto"

// Offline access is allowed only after an online sign-in on this device, for at most the
// period the server grants (7 days). Tokens are never stored: only who signed in and until when.
export async function saveOfflineSession(user, expiresAt) {
  await setMeta("offlineSession", await encryptJson({ user, expiresAt }))
}

export async function touchOfflineSession(expiresAt) {
  const current = await loadOfflineSession()
  if (current) await saveOfflineSession(current.user, expiresAt)
}

export async function loadOfflineSession() {
  try {
    const cipher = await getMeta("offlineSession")
    if (!cipher) return null
    const session = await decryptJson(cipher)
    return new Date(session.expiresAt).getTime() > Date.now() ? session : null
  } catch {
    return null
  }
}

export const clearOfflineSession = () => delMeta("offlineSession")
