import type { CosmeticKind } from '@/services/chain/types'

export type UnlockRule =
  | { kind: 'default' }
  | { kind: 'level'; n: number }
  | { kind: 'streak'; n: number }
  | { kind: 'wins'; n: number }
  | { kind: 'flawless'; n: number }
  | { kind: 'daily'; n: number }
  | { kind: 'built'; n: number }
  | { kind: 'shop'; skinId: number; price?: number }
  | { kind: 'coin'; price: number }

export interface Cosmetic {
  id: string
  kind: CosmeticKind
  name: string
  /** Primary colour. */
  color: string
  /** Secondary glow / accent colour. */
  accent: string
  rule: UnlockRule
}

/** Cosmetics are earned through play or bought with in-game coins. */
export const COSMETICS: Cosmetic[] = [
  { id: 'skin-wisp', kind: 'skin', name: 'Neon Wisp', color: '#b9ff3b', accent: '#e8ffb0', rule: { kind: 'default' } },
  { id: 'skin-violet', kind: 'skin', name: 'Violet Phantom', color: '#b57bff', accent: '#e4ccff', rule: { kind: 'level', n: 3 } },
  { id: 'skin-ember', kind: 'skin', name: 'Ember Imp', color: '#ff8a1f', accent: '#ffd19a', rule: { kind: 'level', n: 5 } },
  { id: 'skin-ghost', kind: 'skin', name: 'Pale Ghost', color: '#e8e8ff', accent: '#ffffff', rule: { kind: 'wins', n: 10 } },
  { id: 'skin-gold', kind: 'skin', name: 'Golden Runner', color: '#ffd23f', accent: '#fff2b0', rule: { kind: 'streak', n: 7 } },
  { id: 'skin-void', kind: 'skin', name: 'Void Walker', color: '#5b3bff', accent: '#9fa0ff', rule: { kind: 'level', n: 10 } },
  { id: 'skin-prism', kind: 'skin', name: 'Prism', color: '#5bf0ff', accent: '#ff7ad9', rule: { kind: 'shop', skinId: 1, price: 150 } },
  { id: 'skin-crimson', kind: 'skin', name: 'Crimson Knight', color: '#ff3d5a', accent: '#ffb3c0', rule: { kind: 'shop', skinId: 2, price: 250 } },
  { id: 'skin-aqua', kind: 'skin', name: 'Aqua Sprite', color: '#2dd4bf', accent: '#c8fff4', rule: { kind: 'shop', skinId: 3, price: 200 } },
  { id: 'skin-onyx', kind: 'skin', name: 'Onyx Royal', color: '#1f1f2e', accent: '#ffd23f', rule: { kind: 'shop', skinId: 4, price: 350 } },
  { id: 'skin-cyber', kind: 'skin', name: 'Cyber Rogue', color: '#00f5d4', accent: '#7b2cbf', rule: { kind: 'coin', price: 400 } },
  { id: 'skin-phoenix', kind: 'skin', name: 'Solar Phoenix', color: '#ffbe0b', accent: '#fb5607', rule: { kind: 'coin', price: 500 } },
  { id: 'trail-spark', kind: 'trail', name: 'Spark', color: '#b9ff3b', accent: '#ffffff', rule: { kind: 'default' } },
  { id: 'trail-embers', kind: 'trail', name: 'Embers', color: '#ff8a1f', accent: '#ff3d5a', rule: { kind: 'level', n: 4 } },
  { id: 'trail-glitch', kind: 'trail', name: 'Glitch', color: '#b57bff', accent: '#5bf0ff', rule: { kind: 'daily', n: 5 } },
  { id: 'trail-comet', kind: 'trail', name: 'Comet', color: '#8fe9ff', accent: '#ffffff', rule: { kind: 'flawless', n: 5 } },
  { id: 'trail-forge', kind: 'trail', name: 'Forgeflame', color: '#ffb347', accent: '#ff5a1f', rule: { kind: 'built', n: 3 } },
  { id: 'trail-neon', kind: 'trail', name: 'Neon Pulse', color: '#00f5d4', accent: '#ffffff', rule: { kind: 'coin', price: 120 } },
  { id: 'trail-plasma', kind: 'trail', name: 'Plasma Vortex', color: '#e0aaff', accent: '#7b2cbf', rule: { kind: 'coin', price: 220 } },
]

export const DEFAULT_SKIN = 'skin-wisp'
export const DEFAULT_TRAIL = 'trail-spark'

export const getCosmetic = (id: string): Cosmetic => COSMETICS.find((c) => c.id === id) ?? COSMETICS[0]

export function describeRule(rule: UnlockRule): string {
  switch (rule.kind) {
    case 'default':
      return 'Unlocked from the start'
    case 'level':
      return `Reach level ${rule.n}`
    case 'streak':
      return `Reach a ${rule.n}-day daily streak`
    case 'wins':
      return `Escape ${rule.n} dungeons`
    case 'flawless':
      return `${rule.n} escapes without losing a life`
    case 'daily':
      return `Clear ${rule.n} daily challenges`
    case 'built':
      return `Publish ${rule.n} dungeons`
    case 'shop':
      return rule.price ? `${rule.price} Coins in Shop` : 'Sold in the shop'
    case 'coin':
      return `${rule.price} Coins in Shop`
  }
}
