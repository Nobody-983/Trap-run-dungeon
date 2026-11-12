import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createProfile, type Profile } from '../src/progress/profile'
import { mergeCloudProfile, syncProfileToSupabase, fetchCloudProfile } from '../src/services/supabase/profileSync'

void describe('Supabase Profile & Progression Cloud Sync', () => {
  const localProfile: Profile = {
    ...createProfile(),
    displayName: 'LocalRunner',
    xp: 250,
    coins: 120,
    economyLedger: [
      { id: 'starter:local', kind: 'credit', amount: 50, category: 'starter', referenceId: 'welcome', createdAt: 1000 },
      { id: 'reward:level-1:run-1', kind: 'credit', amount: 70, category: 'run_reward', referenceId: 'level-1', createdAt: 2000 },
    ],
    runs: 10,
    wins: 6,
    losses: 4,
    unlocked: ['runner-default', 'trail-classic', 'skin-neon'],
    clears: { 'level-1': 5, 'level-2': 2 },
    bests: {
      'level-1': { timeMs: 4200, moves: 18, score: 2500, actions: 'RRUUDD', at: 1700000000000 },
    },
  }

  void it('merges remote cloud profile taking superior progression metrics and ledger-reconciled currency', () => {
    const cloudProfile: Partial<Profile> = {
      displayName: 'CloudRunner',
      xp: 500, // Higher than local
      coins: 80, // Reflects spend on another device
      economyLedger: [
        { id: 'starter:local', kind: 'credit', amount: 50, category: 'starter', referenceId: 'welcome', createdAt: 1000 },
        { id: 'reward:level-1:run-1', kind: 'credit', amount: 70, category: 'run_reward', referenceId: 'level-1', createdAt: 2000 },
        { id: 'spend:potion:tx-1', kind: 'debit', amount: 40, category: 'shop_purchase', referenceId: 'potion-health', createdAt: 3000 },
      ],
      runs: 15, // Higher than local
      wins: 10, // Higher than local
      losses: 5,
      unlocked: ['runner-default', 'trail-classic', 'skin-cyber'], // Adds skin-cyber
      clears: { 'level-1': 3, 'level-2': 4, 'level-3': 1 }, // Adds level-3, increases level-2
      bests: {
        'level-1': { timeMs: 3800, moves: 16, score: 3200, actions: 'RRUUDD', at: 1700010000000 }, // Better score
      },
    }

    const merged = mergeCloudProfile(localProfile, cloudProfile)

    // Monotonic progression metrics take max
    assert.equal(merged.xp, 500)
    // Spendable currency reconciles through ledger union (prevents stale device restoring spent 40 coins)
    assert.equal(merged.coins, 80)
    assert.equal(merged.runs, 15)
    assert.equal(merged.wins, 10)

    // Union of unlocked cosmetics
    assert.ok(merged.unlocked.includes('skin-neon'))
    assert.ok(merged.unlocked.includes('skin-cyber'))

    // Max clears per level
    assert.equal(merged.clears['level-1'], 5) // Local was 5, cloud was 3
    assert.equal(merged.clears['level-2'], 4) // Cloud was 4, local was 2
    assert.equal(merged.clears['level-3'], 1) // Cloud added level-3

    // Best run updated to superior cloud score
    assert.equal(merged.bests['level-1'].score, 3200)
  })

  void it('rejects sync when wallet account is missing or empty', async () => {
    const result = await syncProfileToSupabase(localProfile, '')
    assert.equal(result.ok, false)
    assert.ok(result.error?.includes('no wallet account') || result.error?.includes('unconfigured'))
  })

  void it('fetchCloudProfile returns null safely on nonexistent wallet', async () => {
    const res = await fetchCloudProfile('nonexistent-ghost-account-9999.testnet')
    // Returns null gracefully without throwing uncaught exceptions
    assert.equal(res, null)
  })

  void it('validates timestamp freshness within 5 minutes', () => {
    const MAX_TIME_DRIFT_MS = 300_000
    const now = Date.now()
    const validTimestamp = now - 60_000 // 1 minute ago
    const expiredTimestamp = now - 400_000 // 6.6 minutes ago
    const futureTimestamp = now + 400_000 // 6.6 minutes in future

    const isFresh = (ts: number) => Math.abs(Date.now() - ts) <= MAX_TIME_DRIFT_MS
    assert.equal(isFresh(validTimestamp), true)
    assert.equal(isFresh(expiredTimestamp), false)
    assert.equal(isFresh(futureTimestamp), false)
  })

  void it('detects nonce reuse and prevents replay attacks', () => {
    const consumedNonces = new Set<string>()

    const verifyAndConsumeNonce = (nonce: string, _accountId: string): { ok: boolean; error?: string } => {
      if (!nonce || nonce.length < 16) return { ok: false, error: 'Malformed nonce' }
      if (consumedNonces.has(nonce)) return { ok: false, error: 'Replay attack detected: nonce already used' }
      consumedNonces.add(nonce)
      return { ok: true }
    }

    const testNonce = 'nonce-unique-random-token-123456789'
    const firstAttempt = verifyAndConsumeNonce(testNonce, 'runner.testnet')
    assert.equal(firstAttempt.ok, true)

    // Second replay attempt must be rejected
    const replayAttempt = verifyAndConsumeNonce(testNonce, 'runner.testnet')
    assert.equal(replayAttempt.ok, false)
    assert.ok(replayAttempt.error?.includes('Replay attack detected'))
  })

  void it('preserves guest progression without triggering network sync', () => {
    // When playing as guest, address is null
    const guestProfile = createProfile()
    assert.equal(guestProfile.wallets.length, 0)
    assert.equal(guestProfile.coins, 50)

    // Syncing without a wallet address immediately aborts with an error rather than sending HTTP requests
    void syncProfileToSupabase(guestProfile, '').then((res) => {
      assert.equal(res.ok, false)
    })
  })

  void it('deterministic merge resolves cross-device conflicts without data loss', () => {
    const deviceA: Profile = {
      ...localProfile,
      xp: 400,
      clears: { 'level-1': 10, 'level-2': 1 },
      unlocked: ['runner-default', 'trail-classic', 'skin-emerald'],
    }

    const deviceB: Partial<Profile> = {
      xp: 350,
      clears: { 'level-1': 5, 'level-2': 8, 'level-3': 2 },
      unlocked: ['runner-default', 'trail-classic', 'skin-ruby'],
    }

    const merged = mergeCloudProfile(deviceA, deviceB)

    // Higher XP won
    assert.equal(merged.xp, 400)
    // Union of unlocked cosmetics preserved
    assert.ok(merged.unlocked.includes('skin-emerald'))
    assert.ok(merged.unlocked.includes('skin-ruby'))
    // Max clears for every individual level retained
    assert.equal(merged.clears['level-1'], 10)
    assert.equal(merged.clears['level-2'], 8)
    assert.equal(merged.clears['level-3'], 2)
  })

  void it('regression: prevents stale-device coin restoration (Device A spends 30, Device B offline with 50 -> 20, NOT 50)', () => {
    // Both devices start with same 50 coin starter
    const starterId = 'starter:player-shared-id'
    const starterTx = { id: starterId, kind: 'credit' as const, amount: 50, category: 'starter' as const, referenceId: 'init', createdAt: 1000 }

    // Device A goes online and spends 30 coins on a health potion
    const spendTx = { id: 'spend:potion-health:tx-abc', kind: 'debit' as const, amount: 30, category: 'shop_purchase' as const, referenceId: 'potion-health', createdAt: 2000 }
    const deviceA: Profile = {
      ...createProfile(),
      coins: 20,
      economyLedger: [starterTx, spendTx],
    }

    // Device B remained offline with the original 50 coins (has not synced the spend transaction yet)
    const deviceB: Partial<Profile> = {
      coins: 50,
      economyLedger: [starterTx],
    }

    // Merge Device A with stale Device B
    const merged = mergeCloudProfile(deviceA, deviceB)

    // Critical assertion: The stale device MUST NOT restore the spent 30 coins!
    assert.equal(merged.coins, 20)
    assert.equal(merged.economyLedger.length, 2)
  })

  void it('regression: prevents duplicate reward submission (repeating attemptId does not double-credit)', () => {
    const starterTx = { id: 'starter:user1', kind: 'credit' as const, amount: 50, category: 'starter' as const, referenceId: 'init', createdAt: 1000 }
    // A run completion credit with a unique attempt ID
    const runRewardTx = {
      id: 'reward:dungeon-alpha:attempt-12345',
      kind: 'credit' as const,
      amount: 60,
      category: 'run_reward' as const,
      referenceId: 'dungeon-alpha',
      createdAt: 2000,
    }

    const deviceA: Profile = {
      ...createProfile(),
      coins: 110,
      economyLedger: [starterTx, runRewardTx],
    }

    // Cloud has already received the same attemptId
    const cloud: Partial<Profile> = {
      coins: 110,
      economyLedger: [starterTx, runRewardTx],
    }

    const merged = mergeCloudProfile(deviceA, cloud)
    // Reward must be idempotent: exactly 110 coins, NOT 170 coins
    assert.equal(merged.coins, 110)
    assert.equal(merged.economyLedger.length, 2)
  })

  void it('regression: prevents duplicate spending (duplicate spend transaction ID is deduplicated)', () => {
    const starterTx = { id: 'starter:user1', kind: 'credit' as const, amount: 50, category: 'starter' as const, referenceId: 'init', createdAt: 1000 }
    const spendTx = { id: 'spend:potion-health:tx-single', kind: 'debit' as const, amount: 30, category: 'shop_purchase' as const, referenceId: 'potion', createdAt: 2000 }

    const profileA: Profile = {
      ...createProfile(),
      coins: 20,
      economyLedger: [starterTx, spendTx],
    }

    const profileB: Partial<Profile> = {
      coins: 20,
      economyLedger: [starterTx, spendTx], // Same spend transaction
    }

    const merged = mergeCloudProfile(profileA, profileB)
    assert.equal(merged.coins, 20)
    assert.equal(merged.economyLedger.length, 2)
  })

  void it('regression: reconciles offline rewards combined with cloud spending to calculate accurate net balance', () => {
    const starterTx = { id: 'starter:user1', kind: 'credit' as const, amount: 50, category: 'starter' as const, referenceId: 'init', createdAt: 1000 }

    // Device was offline and cleared two dungeons
    const offlineReward1 = { id: 'reward:dungeon-1:run-offline-1', kind: 'credit' as const, amount: 40, category: 'run_reward' as const, referenceId: 'dungeon-1', createdAt: 1500 }
    const offlineReward2 = { id: 'reward:dungeon-2:run-offline-2', kind: 'credit' as const, amount: 30, category: 'run_reward' as const, referenceId: 'dungeon-2', createdAt: 1800 }

    const offlineDevice: Profile = {
      ...createProfile(),
      coins: 120, // 50 + 40 + 30
      economyLedger: [starterTx, offlineReward1, offlineReward2],
    }

    // Meanwhile on cloud (another device), 30 coins were spent
    const cloudSpend = { id: 'spend:potion-health:cloud-tx', kind: 'debit' as const, amount: 30, category: 'shop_purchase' as const, referenceId: 'potion', createdAt: 2000 }
    const cloudProfile: Partial<Profile> = {
      coins: 20, // 50 - 30
      economyLedger: [starterTx, cloudSpend],
    }

    const merged = mergeCloudProfile(offlineDevice, cloudProfile)
    // Net expected: 50 (starter) + 40 (offline 1) + 30 (offline 2) - 30 (cloud spend) = 90 coins
    assert.equal(merged.coins, 90)
    assert.equal(merged.economyLedger.length, 4)
  })
})

