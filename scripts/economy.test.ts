import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoinReward, canPurchase, applyPurchase } from '../src/economy/catalog.ts'
import { RunController, START_LIVES } from '../src/game/run.ts'
import type { Dungeon } from '../src/game/types.ts'
import type { RunResult } from '../src/game/result.ts'
import { createProfile } from '../src/progress/profile.ts'
import { applyRun } from '../src/progress/progression.ts'
import { CREATOR_START, CREATOR_EXIT, emptyCells } from '../src/game/types.ts'

const TEST_DUNGEON: Dungeon = {
  id: 'test-dungeon-1',
  name: 'Test Chamber',
  cells: emptyCells(),
  start: CREATOR_START,
  exit: CREATOR_EXIT,
  creator: { profileId: 'p1', displayName: 'Creator' },
  source: 'creator',
  difficulty: 2,
  createdAt: 1000,
  par: 20,
}

void describe('In-Game Economy: Coin Rewards & Anti-Farming', () => {
  void it('awards first clear bonus, difficulty bonus, and flawless bonus', () => {
    const winResult: RunResult = {
      dungeonId: 'test-dungeon-1',
      dungeonName: 'Test Chamber',
      mode: 'practice',
      outcome: 'win',
      timeMs: 12000,
      moves: 18,
      livesLost: 0,
      livesLeft: 3,
      score: 1500,
      progress: 1.0,
      difficulty: 3,
      par: 20,
      actions: 'RRRU',
      nearMisses: 1,
      bestCombo: 2,
      comboBonus: 50,
      keysCollected: 0,
      killedBy: { spike: 0, pulse: 0, sentry: 0 },
    }

    const { coins, breakdown } = calculateCoinReward(winResult, 0, 0)
    assert.equal(coins, 120)
    assert.equal(breakdown.some((b) => b.label === 'First Escape'), true)
    assert.equal(breakdown.some((b) => b.label === 'Flawless Escape'), true)
    assert.equal(breakdown.some((b) => b.label === 'Under Par Time'), true)
  })

  void it('enforces anti-farming diminishing returns for repeat clears', () => {
    const repeatWin: RunResult = {
      dungeonId: 'test-dungeon-1',
      dungeonName: 'Test Chamber',
      mode: 'practice',
      outcome: 'win',
      timeMs: 11000,
      moves: 18,
      livesLost: 1,
      livesLeft: 2,
      score: 1200,
      progress: 1.0,
      difficulty: 3,
      par: 20,
      actions: 'RRRU',
      nearMisses: 0,
      bestCombo: 1,
      comboBonus: 0,
      keysCollected: 0,
      killedBy: { spike: 1, pulse: 0, sentry: 0 },
    }

    const { coins, breakdown } = calculateCoinReward(repeatWin, 5, 0)
    assert.equal(coins, 5)
    assert.equal(breakdown[0].label, 'Practice Run Stipend')
  })

  void it('awards streak bonuses on daily challenges', () => {
    const dailyWin: RunResult = {
      dungeonId: 'daily-2026-11-12',
      dungeonName: 'Daily Trial',
      mode: 'daily',
      outcome: 'win',
      timeMs: 15000,
      moves: 25,
      livesLost: 0,
      livesLeft: 3,
      score: 1800,
      progress: 1.0,
      difficulty: 2,
      par: 25,
      actions: 'RRR',
      nearMisses: 0,
      bestCombo: 1,
      comboBonus: 0,
      keysCollected: 0,
      killedBy: { spike: 0, pulse: 0, sentry: 0 },
    }

    const { coins, breakdown } = calculateCoinReward(dailyWin, 0, 4)
    assert.equal(coins, 165)
    assert.equal(breakdown.some((b) => b.label.includes('Streak')), true)
  })

  void it('awards consolation coins for failed attempts with 50%+ progress', () => {
    const lossResult: RunResult = {
      dungeonId: 'test-dungeon-1',
      dungeonName: 'Test Chamber',
      mode: 'practice',
      outcome: 'loss',
      timeMs: 8000,
      moves: 12,
      livesLost: 3,
      livesLeft: 0,
      score: 200,
      progress: 0.65,
      difficulty: 2,
      par: 20,
      actions: 'RRR',
      nearMisses: 0,
      bestCombo: 1,
      comboBonus: 0,
      keysCollected: 0,
      killedBy: { spike: 3, pulse: 0, sentry: 0 },
    }

    const { coins } = calculateCoinReward(lossResult, 0, 0)
    assert.equal(coins, 2)
  })

  void it('awards zero coins in test mode', () => {
    const testResult: RunResult = {
      dungeonId: 'draft-1',
      dungeonName: 'Draft Test',
      mode: 'test',
      outcome: 'win',
      timeMs: 5000,
      moves: 10,
      livesLost: 0,
      livesLeft: 3,
      score: 1000,
      progress: 1.0,
      difficulty: 1,
      par: 10,
      actions: 'RRR',
      nearMisses: 0,
      bestCombo: 1,
      comboBonus: 0,
      keysCollected: 0,
      killedBy: { spike: 0, pulse: 0, sentry: 0 },
    }

    const { coins } = calculateCoinReward(testResult, 0, 0)
    assert.equal(coins, 0)
  })

  void it('updates profile coins via applyRun', () => {
    const profile = createProfile()
    profile.coins = 50

    const winResult: RunResult = {
      dungeonId: 'test-dungeon-1',
      dungeonName: 'Test Chamber',
      mode: 'practice',
      outcome: 'win',
      timeMs: 12000,
      moves: 18,
      livesLost: 0,
      livesLeft: 3,
      score: 1500,
      progress: 1.0,
      difficulty: 1,
      par: 20,
      actions: 'RRRU',
      nearMisses: 0,
      bestCombo: 1,
      comboBonus: 0,
      keysCollected: 0,
      killedBy: { spike: 0, pulse: 0, sentry: 0 },
    }

    const { profile: nextProfile, report } = applyRun(profile, winResult)
    assert.ok(report.coinsGained > 0)
    assert.equal(nextProfile.coins, 50 + report.coinsGained)
  })
})

void describe('Shop & Inventory Operations', () => {
  void it('rejects purchase if coins are insufficient', () => {
    const profile = createProfile()
    profile.coins = 10

    const check = canPurchase(profile, 'potion-health')
    assert.equal(check.ok, false)
    assert.ok(check.reason?.includes('Insufficient coins'))
    assert.throws(() => applyPurchase(profile, 'potion-health'))
  })

  void it('successfully purchases consumable potions and increments inventory', () => {
    const profile = createProfile()
    profile.coins = 100
    profile.inventory = { healthPotions: 1, fullElixirs: 0, energyCells: 0 }

    const { profile: pAfter1 } = applyPurchase(profile, 'potion-health')
    assert.equal(pAfter1.coins, 70)
    assert.equal(pAfter1.inventory.healthPotions, 2)
    assert.equal(pAfter1.purchases.length, 1)

    const { profile: pAfter2 } = applyPurchase(pAfter1, 'potion-health')
    assert.equal(pAfter2.coins, 40)
    assert.equal(pAfter2.inventory.healthPotions, 3)
  })

  void it('purchases and unlocks cosmetic skins and rejects duplicates', () => {
    const profile = createProfile()
    profile.coins = 300

    const { profile: pAfterSkin } = applyPurchase(profile, 'skin-prism')
    assert.equal(pAfterSkin.coins, 150)
    assert.ok(pAfterSkin.unlocked.includes('skin-prism'))

    const checkDuplicate = canPurchase(pAfterSkin, 'skin-prism')
    assert.equal(checkDuplicate.ok, false)
    assert.ok(checkDuplicate.reason?.includes('already own'))
  })

  void it('in-dungeon health restoration respects maximum of 3 lives', () => {
    const ctrl = new RunController(TEST_DUNGEON, { countdownStepMs: 0 })
    ctrl.start()

    assert.equal(ctrl.heal(1), false)
    assert.equal(ctrl.getSnapshot().lives, START_LIVES)
  })
})
