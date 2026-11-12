// Trap Run: Supabase Profile & Progression Cloud Synchronization
// Provides seamless, non-blocking cloud persistence for authenticated NEAR players
// Preserves 100% offline gameplay for guests and handles network errors gracefully

import { getSupabaseClient, isSupabaseConfigured } from './client'
import type { Json } from './types'
import { type Profile, mergeEconomyLedgers } from '../../progress/profile'

export interface CloudProfilePayload {
  near_account_id: string
  display_name: string
  xp: number
  coins: number
  economy_ledger: Profile['economyLedger']
  inventory: Profile['inventory']
  equipped: Profile['equipped']
  unlocked: string[]
  stats: {
    runs: number
    wins: number
    losses: number
    playMs: number
    flawlessRuns: number
    keysCollected: number
    nearMisses: number
    bestCombo: number
    livesLost: number
  }
  streak: Profile['streak']
  bests: Profile['bests']
  clears: Profile['clears']
}

let syncInProgress = false
let pendingSyncPayload: CloudProfilePayload | null = null

/**
 * Loads the player's saved cloud profile from Supabase.
 * Returns null if Supabase is offline, unconfigured, or no record exists yet.
 */
export async function fetchCloudProfile(nearAccountId: string): Promise<Partial<Profile> | null> {
  if (!isSupabaseConfigured || !nearAccountId) return null

  const client = getSupabaseClient()
  if (!client) return null

  try {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('near_account_id', nearAccountId.toLowerCase())
      .maybeSingle()

    if (error || !data) {
      return null
    }

    const row = data as Record<string, unknown>
    return {
      displayName: (row.display_name as string) || undefined,
      xp: typeof row.xp === 'number' ? row.xp : undefined,
      coins: typeof row.coins === 'number' ? row.coins : undefined,
      economyLedger: Array.isArray(row.economy_ledger) ? (row.economy_ledger as Profile['economyLedger']) : undefined,
      inventory: (row.inventory as Profile['inventory']) || undefined,
      equipped: (row.equipped as Profile['equipped']) || undefined,
      unlocked: Array.isArray(row.unlocked) ? (row.unlocked as string[]) : undefined,
      streak: (row.streak as Profile['streak']) || undefined,
      bests: (row.bests as Profile['bests']) || undefined,
      clears: (row.clears as Profile['clears']) || undefined,
      ...(row.stats && typeof row.stats === 'object' ? (row.stats) : {}),
    }
  } catch (err) {
    console.warn('[ProfileSync] Failed to fetch cloud profile:', err)
    return null
  }
}

/**
 * Merges a remote cloud profile with the local profile state.
 * Adopts max progressive values (e.g., higher XP, higher clears, union of unlocks)
 * for permanent progression metrics, while strictly using ledger-based union
 * reconciliation for spendable currency (coins) to prevent restoring spent currency.
 */
export function mergeCloudProfile(local: Profile, cloud: Partial<Profile>): Profile {
  const mergedUnlocked = Array.from(new Set([...(local.unlocked || []), ...(cloud.unlocked || [])]))

  const mergedClears: Record<string, number> = { ...(local.clears || {}) }
  if (cloud.clears) {
    for (const [key, val] of Object.entries(cloud.clears)) {
      mergedClears[key] = Math.max(mergedClears[key] || 0, val || 0)
    }
  }

  const mergedBests: Profile['bests'] = { ...(local.bests || {}) }
  if (cloud.bests) {
    for (const [key, best] of Object.entries(cloud.bests)) {
      if (!mergedBests[key] || (best && best.score > mergedBests[key].score)) {
        mergedBests[key] = best
      }
    }
  }

  // Reconcile spendable currency through idempotent ledger union (NOT Math.max)
  const { ledger: mergedLedger, balance: reconciledCoins } = mergeEconomyLedgers(
    local.economyLedger || [],
    cloud.economyLedger || [],
  )

  return {
    ...local,
    displayName: cloud.displayName || local.displayName,
    xp: Math.max(local.xp || 0, cloud.xp || 0),
    coins: reconciledCoins,
    economyLedger: mergedLedger,
    runs: Math.max(local.runs || 0, cloud.runs || 0),
    wins: Math.max(local.wins || 0, cloud.wins || 0),
    losses: Math.max(local.losses || 0, cloud.losses || 0),
    flawlessRuns: Math.max(local.flawlessRuns || 0, cloud.flawlessRuns || 0),
    keysCollected: Math.max(local.keysCollected || 0, cloud.keysCollected || 0),
    nearMisses: Math.max(local.nearMisses || 0, cloud.nearMisses || 0),
    bestCombo: Math.max(local.bestCombo || 0, cloud.bestCombo || 0),
    unlocked: mergedUnlocked,
    equipped: cloud.equipped || local.equipped,
    inventory: cloud.inventory || local.inventory,
    streak: {
      current: Math.max(local.streak?.current || 0, cloud.streak?.current || 0),
      best: Math.max(local.streak?.best || 0, cloud.streak?.best || 0),
      last: cloud.streak?.last || local.streak?.last || null,
    },
    bests: mergedBests,
    clears: mergedClears,
  }
}

export interface SignedSyncAuth {
  publicKey: string
  signature: string
  nonce: string
  message: string
  recipient: string
  callbackUrl?: string
  timestamp?: number
}

/**
 * Saves or updates player profile data in Supabase asynchronously.
 * When signed auth is provided, securely verifies through the sync-profile Edge Function.
 * Throttles rapid invocations and queues subsequent updates.
 */
export async function syncProfileToSupabase(
  profile: Profile,
  nearAccountId: string,
  auth?: SignedSyncAuth,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !nearAccountId) {
    return { ok: false, error: 'Supabase unconfigured or no wallet account' }
  }

  const payload: CloudProfilePayload = {
    near_account_id: nearAccountId.toLowerCase(),
    display_name: profile.displayName,
    xp: profile.xp || 0,
    coins: profile.coins || 0,
    economy_ledger: profile.economyLedger || [],
    inventory: profile.inventory,
    equipped: profile.equipped,
    unlocked: profile.unlocked,
    stats: {
      runs: profile.runs || 0,
      wins: profile.wins || 0,
      losses: profile.losses || 0,
      playMs: profile.playMs || 0,
      flawlessRuns: profile.flawlessRuns || 0,
      keysCollected: profile.keysCollected || 0,
      nearMisses: profile.nearMisses || 0,
      bestCombo: profile.bestCombo || 0,
      livesLost: profile.livesLost || 0,
    },
    streak: profile.streak,
    bests: profile.bests,
    clears: profile.clears,
  }

  // 1. If cryptographic wallet signature is provided, invoke the secure sync-profile Edge Function
  if (auth?.signature && auth?.publicKey) {
    try {
      const client = getSupabaseClient()
      if (client) {
        interface FunctionResponse {
          success?: boolean
          message?: string
          error?: string
        }
        const res = await client.functions.invoke<FunctionResponse>('sync-profile', {
          body: {
            nearAccountId,
            publicKey: auth.publicKey,
            signature: auth.signature,
            nonce: auth.nonce,
            message: auth.message,
            recipient: auth.recipient,
            callbackUrl: auth.callbackUrl,
            timestamp: auth.timestamp,
            profile: {
              displayName: payload.display_name,
              xp: payload.xp,
              coins: payload.coins,
              economyLedger: payload.economy_ledger,
              inventory: payload.inventory,
              equipped: payload.equipped,
              unlocked: payload.unlocked,
              stats: payload.stats,
              streak: payload.streak,
              bests: payload.bests,
              clears: payload.clears,
            },
          },
        })

        if (!res.error && res.data?.success) {
          return { ok: true }
        }
        if (res.error) {
          console.warn('[ProfileSync] Edge function sync returned error:', String(res.error))
        }
      }
    } catch (err) {
      console.warn('[ProfileSync] Edge function invocation failed:', err)
    }
  }

  // 2. Direct client fallback / standard upsert
  if (syncInProgress) {
    pendingSyncPayload = payload
    return { ok: true }
  }

  syncInProgress = true
  try {
    const client = getSupabaseClient()
    if (!client) {
      syncInProgress = false
      return { ok: false, error: 'Client unavailable' }
    }

    const now = new Date().toISOString()
    const { error } = await client
      .from('profiles')
      .upsert(
        {
          near_account_id: payload.near_account_id,
          display_name: payload.display_name,
          xp: payload.xp,
          coins: payload.coins,
          economy_ledger: payload.economy_ledger as unknown as Json,
          inventory: payload.inventory as unknown as Json,
          equipped: payload.equipped as unknown as Json,
          unlocked: payload.unlocked as unknown as Json,
          stats: payload.stats as unknown as Json,
          streak: payload.streak as unknown as Json,
          bests: payload.bests as unknown as Json,
          clears: payload.clears as unknown as Json,
          updated_at: now,
        },
        { onConflict: 'near_account_id' },
      )

    if (error) {
      // If table doesn't have the new columns yet (PGRST204/PGRST205), fall back to basic profile upsert
      if (error.code === 'PGRST204' || error.code === 'PGRST205' || error.message.includes('column')) {
        await client.from('profiles').upsert(
          {
            near_account_id: payload.near_account_id,
            display_name: payload.display_name,
            updated_at: now,
          },
          { onConflict: 'near_account_id' },
        )
      } else {
        console.warn('[ProfileSync] Upsert error:', error.message)
        return { ok: false, error: error.message }
      }
    }

    return { ok: true }
  } catch (err) {
    console.warn('[ProfileSync] Network error during sync:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    syncInProgress = false
    if (pendingSyncPayload) {
      const next = pendingSyncPayload
      pendingSyncPayload = null
      void syncProfileToSupabase(profile, next.near_account_id)
    }
  }
}
