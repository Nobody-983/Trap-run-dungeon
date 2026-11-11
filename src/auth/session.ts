/** Wallet sign-in session for NEAR Protocol. Holds only public data: account ID and connection timestamp. */

const KEY = 'trap-run:near-session:v1'
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface NearAuthSession {
  accountId: string
  publicKey?: string
  connectedAt: number
  expiresAt: number
}

export function readSession(): NearAuthSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<NearAuthSession>
    if (typeof s.accountId !== 'string' || typeof s.expiresAt !== 'number') return null
    if (s.expiresAt < Date.now()) {
      clearSession()
      return null
    }
    return s as NearAuthSession
  } catch {
    return null
  }
}

export function writeSession(s: NearAuthSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function createNearSession(accountId: string, publicKey?: string): NearAuthSession {
  const now = Date.now()
  return {
    accountId,
    publicKey,
    connectedAt: now,
    expiresAt: now + TTL_MS,
  }
}
