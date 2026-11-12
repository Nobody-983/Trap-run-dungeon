import type { CellType, Dungeon } from '@/game/types'
import type { AchievementRecord, WalletIdentity } from '@/services/chain/types'
import { DEFAULT_SKIN, DEFAULT_TRAIL } from './cosmetics'
import { newHealth, type HealthState } from './health'

export interface BestRun {
  timeMs: number
  moves: number
  score: number
  actions: string
  at: number
}

export interface Settings {
  sound: boolean
  volume: number
  reducedMotion: boolean
  buildTimer: boolean
  touchControls: 'auto' | 'on' | 'off'
}

/** In-progress Creator Mode layout, so leaving to test a dungeon never loses work. */
export interface Draft {
  cells: CellType[]
  /** Order cells were placed in, newest last (used by auto-repair). */
  order: number[]
  remainingMs: number
  started: boolean
  locked: boolean
}

export interface PaymentRecord {
  kind: 'health' | 'skin' | 'dungeon' | 'challenge'
  label: string
  /** USDC base units (6 decimals) as a decimal string. */
  amount: string
  txHash: string
  at: number
}

export interface ChallengeRecord {
  dungeonId: string
  challengeId: number
  txHash: string
  at: number
}

export interface NearChallengeRecord {
  dungeonId: string
  /** Decimal u64 string; never coerce NEAR challenge IDs through a JS number. */
  challengeId: string
  creator: string
  txHash: string
  shareCode: string
  at: number
}

export interface PlayerInventory {
  healthPotions: number
  fullElixirs: number
  energyCells: number
}

export interface PurchaseRecord {
  id: string
  itemId: string
  name: string
  price: number
  kind: 'skin' | 'trail' | 'consumable'
  at: number
}

export interface EconomyTransaction {
  id: string
  kind: 'credit' | 'debit'
  amount: number
  category: 'starter' | 'run_reward' | 'shop_purchase' | 'consumable_use'
  referenceId: string
  createdAt: number
}

export function reconcileEconomyBalance(ledger: EconomyTransaction[]): number {
  if (!Array.isArray(ledger)) return 50
  const seen = new Set<string>()
  let balance = 0
  for (const tx of ledger) {
    if (!tx || !tx.id || seen.has(tx.id)) continue
    seen.add(tx.id)
    const amt = typeof tx.amount === 'number' && Number.isFinite(tx.amount) ? Math.max(0, Math.floor(tx.amount)) : 0
    if (tx.kind === 'credit') {
      balance += amt
    } else if (tx.kind === 'debit') {
      balance -= amt
    }
  }
  return Math.max(0, balance)
}

export function mergeEconomyLedgers(
  ledgerA: EconomyTransaction[] = [],
  ledgerB: EconomyTransaction[] = [],
): { ledger: EconomyTransaction[]; balance: number } {
  const mergedMap = new Map<string, EconomyTransaction>()
  for (const tx of [...ledgerA, ...ledgerB]) {
    if (tx && tx.id && !mergedMap.has(tx.id)) {
      mergedMap.set(tx.id, tx)
    }
  }
  const merged = Array.from(mergedMap.values()).sort((a, b) => a.createdAt - b.createdAt)
  const balance = reconcileEconomyBalance(merged)
  return { ledger: merged, balance }
}

export interface Profile {
  version: 1
  id: string
  displayName: string
  createdAt: number
  /** Linked wallet identities, per chain. Empty until a real chain adapter is connected. */
  wallets: WalletIdentity[]

  xp: number
  coins: number
  economyLedger: EconomyTransaction[]
  inventory: PlayerInventory
  purchases: PurchaseRecord[]
  runs: number
  wins: number
  losses: number
  playMs: number
  flawlessRuns: number
  keysCollected: number
  nearMisses: number
  bestCombo: number
  livesLost: number

  bests: Record<string, BestRun>
  clears: Record<string, number>
  attempts: Record<string, number>
  /** How many practice levels are open. */
  practiceUnlocked: number

  streak: { current: number; best: number; last: string | null }
  daily: Record<string, { timeMs: number; moves: number; score: number }>

  unlocked: string[]
  equipped: { skin: string; trail: string }
  achievements: AchievementRecord[]

  published: Dungeon[]
  /** Short room code to share code, resolved on this device until a backend exists. */
  rooms: Record<string, string>
  draft: Draft | null
  drafts: Record<string, Draft>
  settings: Settings

  health: HealthState
  /** Shop skin ids owned onchain, mirrored from the shop contract. */
  ownedSkins: number[]
  payments: PaymentRecord[]
  challenges: ChallengeRecord[]
  nearChallenges: NearChallengeRecord[]
  /** Set on the guest profile once its progress has been copied into a wallet account. */
  claimedBy?: string
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.6,
  reducedMotion: false,
  buildTimer: true,
  touchControls: 'auto',
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const DEFAULT_INVENTORY: PlayerInventory = {
  healthPotions: 1, // Starter health potion
  fullElixirs: 0,
  energyCells: 0,
}

export function createProfile(): Profile {
  const profileId = newId()
  const createdAt = Date.now()
  const starterTx: EconomyTransaction = {
    id: `starter:${profileId}`,
    kind: 'credit',
    amount: 50,
    category: 'starter',
    referenceId: 'welcome',
    createdAt,
  }
  return {
    version: 1,
    id: profileId,
    displayName: `RUNNER-${Math.floor(1000 + Math.random() * 9000)}`,
    createdAt,
    wallets: [],
    xp: 0,
    coins: 50, // Welcome gift of 50 coins
    economyLedger: [starterTx],
    inventory: { ...DEFAULT_INVENTORY },
    purchases: [],
    runs: 0,
    wins: 0,
    losses: 0,
    playMs: 0,
    flawlessRuns: 0,
    keysCollected: 0,
    nearMisses: 0,
    bestCombo: 0,
    livesLost: 0,
    bests: {},
    clears: {},
    attempts: {},
    practiceUnlocked: 2,
    streak: { current: 0, best: 0, last: null },
    daily: {},
    unlocked: [DEFAULT_SKIN, DEFAULT_TRAIL],
    equipped: { skin: DEFAULT_SKIN, trail: DEFAULT_TRAIL },
    achievements: [],
    published: [],
    rooms: {},
    draft: null,
    drafts: {},
    settings: { ...DEFAULT_SETTINGS },
    health: newHealth(),
    ownedSkins: [],
    payments: [],
    challenges: [],
    nearChallenges: [],
  }
}

/** Fill any missing fields from older saves with defaults. */
export function hydrateProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const base = createProfile()
  const src = raw as Partial<Profile>
  if (typeof src.id !== 'string' || typeof src.xp !== 'number') return null

  const rawLedger = Array.isArray(src.economyLedger) ? src.economyLedger : []
  const ledger: EconomyTransaction[] =
    rawLedger.length > 0
      ? rawLedger
      : [
          {
            id: `legacy:starter:${src.id}`,
            kind: 'credit',
            amount: typeof src.coins === 'number' ? Math.max(0, Math.floor(src.coins)) : 50,
            category: 'starter',
            referenceId: 'legacy_hydrate',
            createdAt: typeof src.createdAt === 'number' ? src.createdAt : Date.now(),
          },
        ]
  const reconciledCoins = reconcileEconomyBalance(ledger)

  return {
    ...base,
    ...src,
    version: 1,
    coins: reconciledCoins,
    economyLedger: ledger,
    inventory: {
      healthPotions: typeof src.inventory?.healthPotions === 'number' ? Math.max(0, Math.floor(src.inventory.healthPotions)) : base.inventory.healthPotions,
      fullElixirs: typeof src.inventory?.fullElixirs === 'number' ? Math.max(0, Math.floor(src.inventory.fullElixirs)) : base.inventory.fullElixirs,
      energyCells: typeof src.inventory?.energyCells === 'number' ? Math.max(0, Math.floor(src.inventory.energyCells)) : base.inventory.energyCells,
    },
    purchases: Array.isArray(src.purchases) ? src.purchases : [],
    drafts: src.drafts && typeof src.drafts === 'object' ? src.drafts : {},
    streak: { ...base.streak, ...(src.streak ?? {}) },
    equipped: { ...base.equipped, ...(src.equipped ?? {}) },
    settings: { ...base.settings, ...(src.settings ?? {}) },
    health: { ...base.health, ...(src.health ?? {}) },
    unlocked: Array.from(new Set([...base.unlocked, ...(src.unlocked ?? [])])),
  }
}

export const levelFromXp = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1
export const xpForLevel = (level: number): number => 100 * (level - 1) * (level - 1)

export function levelProgress(xp: number): { level: number; into: number; needed: number; ratio: number } {
  const level = levelFromXp(xp)
  const floor = xpForLevel(level)
  const needed = xpForLevel(level + 1) - floor
  const into = xp - floor
  return { level, into, needed, ratio: needed > 0 ? into / needed : 0 }
}
