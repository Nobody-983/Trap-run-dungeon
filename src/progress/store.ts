import { useSyncExternalStore } from 'react'
import { readSession } from '@/auth/session'
import type { RunResult } from '@/game/result'
import type { Dungeon } from '@/game/types'
import { applyPurchase, type CatalogItem } from '@/economy/catalog'
import { COSMETICS } from './cosmetics'
import { creditPurchased, rollDay, spendOne, totalHealth } from './health'
import { applyPublish, applyRun, type ProgressReport } from './progression'
import {
  createProfile,
  hydrateProfile,
  type ChallengeRecord,
  type Draft,
  type NearChallengeRecord,
  type PaymentRecord,
  type Profile,
  type Settings,
  type EconomyTransaction,
  reconcileEconomyBalance,
} from './profile'
import {
  fetchCloudProfile,
  mergeCloudProfile,
  syncProfileToSupabase,
} from '@/services/supabase/profileSync'

const GUEST_KEY = 'trap-run:profile:v1'
const BACKUP_KEY = 'trap-run:profile:corrupt'
// Profiles are keyed by NEAR account ID
const keyFor = (address: string | null): string => (address ? `${GUEST_KEY}:near:${address.toLowerCase()}` : GUEST_KEY)

export interface StorageInfo {
  /** Set when saved data could not be read or written. */
  error: string | null
}

let storageInfo: StorageInfo = { error: null }
let activeAddress: string | null = readSession()?.accountId.toLowerCase() ?? null
let profile: Profile = loadOrCreate(activeAddress)
const listeners = new Set<() => void>()
const infoListeners = new Set<() => void>()

function readKey(key: string): Profile | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const parsed = hydrateProfile(JSON.parse(raw))
  if (!parsed) throw new Error('Saved profile has an unexpected shape')
  return parsed
}

function loadOrCreate(address: string | null): Profile {
  try {
    const existing = readKey(keyFor(address))
    if (existing) return { ...existing, health: rollDay(existing.health) }
    if (!address) return createProfile()
    // First sign-in for this wallet: bring over this device's guest progress once.
    const fresh = createProfile()
    const guest = readKey(GUEST_KEY)
    const base = guest && guest.runs > 0 && !guest.claimedBy ? { ...guest, id: fresh.id, createdAt: fresh.createdAt, payments: [], challenges: [], ownedSkins: [], claimedBy: undefined } : fresh
    if (guest && base !== fresh) localStorage.setItem(GUEST_KEY, JSON.stringify({ ...guest, claimedBy: address }))
    return {
      ...base,
      wallets: [{ chain: 'near', network: 'testnet', accountId: address, verified: true, linkedAt: Date.now() }],
    }
  } catch (err) {
    try {
      const raw = localStorage.getItem(keyFor(address))
      if (raw) localStorage.setItem(BACKUP_KEY, raw)
    } catch {
      /* storage unavailable */
    }
    storageInfo = { error: err instanceof Error ? `Your saved progress could not be read (${err.message}). A fresh profile was started.` : 'Your saved progress could not be read.' }
    return createProfile()
  }
}

function persist(): void {
  try {
    localStorage.setItem(keyFor(activeAddress), JSON.stringify(profile))
    if (storageInfo.error?.startsWith('Progress could not be saved')) {
      storageInfo = { error: null }
      infoListeners.forEach((l) => l())
    }
  } catch {
    storageInfo = { error: 'Progress could not be saved in this browser. You can keep playing, but it will not persist.' }
    infoListeners.forEach((l) => l())
  }
}

function commit(next: Profile): void {
  profile = next
  persist()
  listeners.forEach((l) => l())
  // Asynchronously synchronize authenticated wallet progression to Supabase
  if (activeAddress) {
    void syncProfileToSupabase(next, activeAddress)
  }
}

// Background initial sync if wallet was already authenticated on session restoration
if (activeAddress) {
  const accountId = activeAddress
  void fetchCloudProfile(accountId).then((cloud) => {
    if (cloud && activeAddress === accountId) {
      const merged = mergeCloudProfile(profile, cloud)
      if (merged !== profile) {
        commit(merged)
      }
    }
  })
}

export const profileStore = {
  get: (): Profile => profile,
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  },

  /** The signed-in wallet address (lowercase), or null while playing as a guest. */
  address: (): string | null => activeAddress,
  hasAccount: (address: string): boolean => {
    try {
      return localStorage.getItem(keyFor(address)) !== null
    } catch {
      return false
    }
  },
  /** Switch to a wallet's profile, or back to the guest profile with `null`. */
  switchTo(address: string | null): void {
    const next = address ? address.toLowerCase() : null
    if (next === activeAddress) return
    activeAddress = next
    commit(loadOrCreate(next))

    // On wallet switch, background fetch cloud state and merge
    if (next) {
      void fetchCloudProfile(next).then((cloud) => {
        if (cloud && activeAddress === next) {
          const merged = mergeCloudProfile(profile, cloud)
          if (merged !== profile) {
            commit(merged)
          }
        }
      })
    }
  },

  recordRun(result: RunResult): ProgressReport {
    const { profile: next, report } = applyRun(profile, result)
    if (next !== profile) commit(next)
    return report
  },
  publishDungeon(dungeon: Dungeon): ProgressReport {
    const { profile: next, report } = applyPublish(profile, dungeon)
    commit(next)
    return report
  },

  // ---- health ----
  /** Spends one health. Returns false (and changes nothing) when there is none. */
  spendHealth(): boolean {
    const rolled = rollDay(profile.health)
    const spent = spendOne(rolled)
    if (!spent) {
      if (rolled !== profile.health) commit({ ...profile, health: rolled })
      return false
    }
    commit({ ...profile, health: spent })
    return true
  },
  refreshDay(): void {
    const rolled = rollDay(profile.health)
    if (rolled !== profile.health) commit({ ...profile, health: rolled })
  },
  /** Credit lifetime purchased health reported by the shop contract. */
  syncPurchasedHealth(lifetimeTotal: number): void {
    const next = creditPurchased(rollDay(profile.health), lifetimeTotal)
    if (next !== profile.health) commit({ ...profile, health: next })
  },
  /** Mirror skin ownership from the shop contract. */
  setOwnedSkins(ids: number[]): void {
    const sorted = [...ids].sort((a, b) => a - b)
    const same = sorted.length === profile.ownedSkins.length && sorted.every((v, i) => v === profile.ownedSkins[i])
    const unlocked = COSMETICS.filter((c) => c.rule.kind === 'shop' && ids.includes(c.rule.skinId)).map((c) => c.id)
    const merged = Array.from(new Set([...profile.unlocked, ...unlocked]))
    if (same && merged.length === profile.unlocked.length) return
    commit({ ...profile, ownedSkins: sorted, unlocked: merged })
  },
  recordPayment(rec: PaymentRecord): void {
    commit({ ...profile, payments: [rec, ...profile.payments].slice(0, 50) })
  },
  recordChallenge(rec: ChallengeRecord): void {
    commit({ ...profile, challenges: [rec, ...profile.challenges].slice(0, 100) })
  },
  recordNearChallenge(rec: NearChallengeRecord): void {
    commit({ ...profile, nearChallenges: [rec, ...profile.nearChallenges].slice(0, 100) })
  },

  // ---- coins & economy ----
  addCoins(amount: number, referenceId = 'bonus'): void {
    if (amount <= 0) return
    const creditTx: EconomyTransaction = {
      id: `credit:manual:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'credit',
      amount: Math.floor(amount),
      category: 'starter',
      referenceId,
      createdAt: Date.now(),
    }
    const nextLedger = [...(profile.economyLedger || []), creditTx]
    const reconciled = reconcileEconomyBalance(nextLedger)
    commit({ ...profile, coins: reconciled, economyLedger: nextLedger })
  },
  spendCoins(amount: number, referenceId = 'manual'): boolean {
    if (amount <= 0) return true
    if ((profile.coins ?? 0) < amount) return false
    const debitTx: EconomyTransaction = {
      id: `debit:manual:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'debit',
      amount: Math.floor(amount),
      category: 'consumable_use',
      referenceId,
      createdAt: Date.now(),
    }
    const nextLedger = [...(profile.economyLedger || []), debitTx]
    const reconciled = reconcileEconomyBalance(nextLedger)
    commit({ ...profile, coins: reconciled, economyLedger: nextLedger })
    return true
  },
  buyItem(itemId: string): CatalogItem {
    const { profile: next, item } = applyPurchase(profile, itemId)
    commit(next)
    return item
  },
  useHealthPotion(): boolean {
    if ((profile.inventory?.healthPotions ?? 0) <= 0) return false
    commit({
      ...profile,
      inventory: {
        ...profile.inventory,
        healthPotions: profile.inventory.healthPotions - 1,
      },
    })
    return true
  },
  useFullElixir(): boolean {
    if ((profile.inventory?.fullElixirs ?? 0) <= 0) return false
    commit({
      ...profile,
      inventory: {
        ...profile.inventory,
        fullElixirs: profile.inventory.fullElixirs - 1,
      },
    })
    return true
  },
  useEnergyCell(): boolean {
    if ((profile.inventory?.energyCells ?? 0) <= 0) return false
    const rolled = rollDay(profile.health)
    commit({
      ...profile,
      inventory: {
        ...profile.inventory,
        energyCells: profile.inventory.energyCells - 1,
      },
      health: {
        ...rolled,
        bonus: rolled.bonus + 3,
      },
    })
    return true
  },

  // ---- named drafts ----
  saveNamedDraft(name: string, draft: Draft): void {
    const clean = name.trim().slice(0, 32)
    if (!clean) return
    commit({
      ...profile,
      drafts: { ...profile.drafts, [clean]: draft },
    })
  },
  deleteNamedDraft(name: string): void {
    const nextDrafts = { ...profile.drafts }
    delete nextDrafts[name]
    commit({ ...profile, drafts: nextDrafts })
  },
  loadNamedDraft(name: string): Draft | null {
    return profile.drafts?.[name] ?? null
  },

  setSettings(patch: Partial<Settings>): void {
    commit({ ...profile, settings: { ...profile.settings, ...patch } })
  },
  setName(name: string): void {
    const clean = name.replace(/[^\w \-.]/g, '').trim().slice(0, 16)
    if (clean) commit({ ...profile, displayName: clean })
  },
  equip(kind: 'skin' | 'trail', id: string): void {
    if (!profile.unlocked.includes(id)) return
    commit({ ...profile, equipped: { ...profile.equipped, [kind]: id } })
  },
  saveDraft(draft: Draft | null): void {
    commit({ ...profile, draft })
  },
  saveRoom(code: string, shareCode: string): void {
    commit({ ...profile, rooms: { ...profile.rooms, [code]: shareCode } })
  },
  resetAll(): void {
    try {
      localStorage.removeItem(keyFor(activeAddress))
    } catch {
      /* ignore */
    }
    storageInfo = { error: null }
    infoListeners.forEach((l) => l())
    const fresh = createProfile()
    commit(
      activeAddress
        ? { ...fresh, wallets: [{ chain: 'near', network: 'testnet', accountId: activeAddress, verified: true, linkedAt: Date.now() }] }
        : fresh,
    )
  },
  dismissStorageError(): void {
    storageInfo = { error: null }
    infoListeners.forEach((l) => l())
  },
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    (l) => profileStore.subscribe(l),
    () => profileStore.get(),
  )
}

export function useStorageInfo(): StorageInfo {
  return useSyncExternalStore(
    (l) => {
      infoListeners.add(l)
      return () => infoListeners.delete(l)
    },
    () => storageInfo,
  )
}

export const healthTotal = (p: Profile): number => totalHealth(rollDay(p.health))
