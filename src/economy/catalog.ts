import type { RunResult } from '@/game/result'
import { COSMETICS } from '@/progress/cosmetics'
import { rollDay } from '@/progress/health'
import {
  type Profile,
  type EconomyTransaction,
  reconcileEconomyBalance,
} from '@/progress/profile'

export type ItemKind = 'skin' | 'trail' | 'consumable'

export interface CatalogItem {
  id: string
  kind: ItemKind
  name: string
  description: string
  price: number
  /** Color badge / icon hint */
  color: string
  accent: string
  /** For consumables: what it replenishes */
  effect?: 'heal-1' | 'heal-full' | 'energy-3'
}

export const CONSUMABLE_ITEMS: CatalogItem[] = [
  {
    id: 'potion-health',
    kind: 'consumable',
    name: 'Health Potion',
    description: 'Instantly restores +1 life during an active dungeon run (up to max 3 lives).',
    price: 30,
    color: '#ff3d5a',
    accent: '#ff8a9f',
    effect: 'heal-1',
  },
  {
    id: 'potion-elixir',
    kind: 'consumable',
    name: 'Full Life Elixir',
    description: 'Restores all 3 lives to maximum during an active dungeon run.',
    price: 75,
    color: '#a855f7',
    accent: '#d8b4fe',
    effect: 'heal-full',
  },
  {
    id: 'energy-cell',
    kind: 'consumable',
    name: 'Runner Energy Cell',
    description: 'Adds +3 bonus runner energy for attempting additional dungeon runs.',
    price: 50,
    color: '#b9ff3b',
    accent: '#e8ffb0',
    effect: 'energy-3',
  },
]

export const SHOP_COSMETICS: CatalogItem[] = COSMETICS.filter((c) => {
  if (c.rule.kind === 'coin') return true
  if (c.rule.kind === 'shop' && c.rule.price !== undefined) return true
  return false
}).map((c) => {
  const price = c.rule.kind === 'coin' ? c.rule.price : c.rule.kind === 'shop' && c.rule.price ? c.rule.price : 200
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    description: c.kind === 'skin' ? 'Premium custom runner avatar' : 'Vibrant motion particle trail',
    price,
    color: c.color,
    accent: c.accent,
  }
})

export const ALL_CATALOG_ITEMS: CatalogItem[] = [...CONSUMABLE_ITEMS, ...SHOP_COSMETICS]

export function getCatalogItem(id: string): CatalogItem | undefined {
  return ALL_CATALOG_ITEMS.find((item) => item.id === id)
}

/**
 * Calculates earned coins for a completed or attempted dungeon run.
 * Implements strict anti-farming diminishing returns for repeated clears.
 */
export function calculateCoinReward(
  r: RunResult,
  clearsBefore: number,
  dailyStreak: number = 0,
): { coins: number; breakdown: Array<{ label: string; coins: number }> } {
  if (r.mode === 'test') {
    return { coins: 0, breakdown: [] }
  }

  const breakdown: Array<{ label: string; coins: number }> = []

  if (r.outcome === 'loss') {
    if (r.progress >= 0.5) {
      breakdown.push({ label: 'Runner Effort (50%+)', coins: 2 })
    }
  } else {
    // Win outcome
    const flawless = r.livesLost === 0
    const underPar = r.par !== undefined && r.par > 0 && r.moves <= r.par

    if (r.mode === 'daily') {
      breakdown.push({ label: 'Daily Challenge Clear', coins: 100 })
      if (dailyStreak > 1) {
        const streakBonus = Math.min(50, dailyStreak * 10)
        breakdown.push({ label: `${dailyStreak}-Day Streak Bonus`, coins: streakBonus })
      }
      if (flawless) {
        breakdown.push({ label: 'Flawless Daily Escape', coins: 25 })
      }
    } else if (clearsBefore === 0) {
      // First clear of this dungeon: High reward
      breakdown.push({ label: 'First Escape', coins: 50 })
      const diffBonus = (r.difficulty ?? 1) * 10
      breakdown.push({ label: `Difficulty Rating (D${r.difficulty ?? 1})`, coins: diffBonus })
      if (flawless) {
        breakdown.push({ label: 'Flawless Escape', coins: 25 })
      }
      if (underPar) {
        breakdown.push({ label: 'Under Par Time', coins: 15 })
      }
    } else {
      // Repeat clear: Anti-farming diminishing returns
      breakdown.push({ label: 'Practice Run Stipend', coins: 5 })
      if (flawless) {
        breakdown.push({ label: 'Flawless Repeat', coins: 3 })
      }
    }
  }

  const coins = breakdown.reduce((sum, item) => sum + item.coins, 0)
  return { coins, breakdown }
}

/**
 * Validates whether a profile can purchase the given item.
 */
export function canPurchase(profile: Profile, itemId: string): { ok: boolean; reason?: string } {
  const item = getCatalogItem(itemId)
  if (!item) {
    return { ok: false, reason: 'Item not found in catalog.' }
  }

  if (profile.coins < item.price) {
    return {
      ok: false,
      reason: `Insufficient coins. Need ${item.price} coins, but you have ${profile.coins}.`,
    }
  }

  // Cosmetics cannot be purchased twice
  if (item.kind === 'skin' || item.kind === 'trail') {
    if (profile.unlocked.includes(item.id)) {
      return { ok: false, reason: 'You already own this item.' }
    }
  }

  return { ok: true }
}

/**
 * Executes a purchase on the profile, deducting coins and adding items.
 */
export function applyPurchase(profile: Profile, itemId: string): { profile: Profile; item: CatalogItem } {
  const check = canPurchase(profile, itemId)
  if (!check.ok) {
    throw new Error(check.reason)
  }

  const item = getCatalogItem(itemId)!

  const purchaseRecord = {
    id: `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    name: item.name,
    price: item.price,
    kind: item.kind,
    at: Date.now(),
  }

  const baseLedger = [...(profile.economyLedger || [])]
  const currentLedgerBalance = reconcileEconomyBalance(baseLedger)
  if (profile.coins > currentLedgerBalance) {
    baseLedger.push({
      id: `seed:${profile.id}:${profile.coins - currentLedgerBalance}`,
      kind: 'credit',
      amount: profile.coins - currentLedgerBalance,
      category: 'starter',
      referenceId: 'balance_sync',
      createdAt: purchaseRecord.at - 1,
    })
  }

  const debitTx: EconomyTransaction = {
    id: `spend:${item.id}:${purchaseRecord.id}`,
    kind: 'debit',
    amount: item.price,
    category: 'shop_purchase',
    referenceId: item.id,
    createdAt: purchaseRecord.at,
  }
  const nextLedger = [...baseLedger, debitTx]
  const reconciledCoins = reconcileEconomyBalance(nextLedger)

  let nextProfile: Profile = {
    ...profile,
    coins: reconciledCoins,
    economyLedger: nextLedger,
    purchases: [purchaseRecord, ...profile.purchases].slice(0, 100),
  }

  if (item.kind === 'skin' || item.kind === 'trail') {
    nextProfile = {
      ...nextProfile,
      unlocked: Array.from(new Set([...nextProfile.unlocked, item.id])),
    }
  } else if (item.kind === 'consumable') {
    const inv = { ...nextProfile.inventory }
    if (item.id === 'potion-health') {
      inv.healthPotions = (inv.healthPotions ?? 0) + 1
    } else if (item.id === 'potion-elixir') {
      inv.fullElixirs = (inv.fullElixirs ?? 0) + 1
    } else if (item.id === 'energy-cell') {
      inv.energyCells = (inv.energyCells ?? 0) + 1
      // Also directly replenish bonus energy
      const rolled = rollDay(nextProfile.health)
      nextProfile = {
        ...nextProfile,
        health: { ...rolled, bonus: rolled.bonus + 3 },
      }
    }
    nextProfile.inventory = inv
  }

  return { profile: nextProfile, item }
}

