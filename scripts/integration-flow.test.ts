import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createProfile } from '../src/progress/profile.ts'
import { applyRun } from '../src/progress/progression.ts'
import { applyPurchase } from '../src/economy/catalog.ts'
import { RunController } from '../src/game/run.ts'
import { place } from '../src/editor/tools.ts'
import { emptyCells, idx, CREATOR_START, CREATOR_EXIT, type CellType, type Dungeon } from '../src/game/types.ts'
import { solveDungeon } from '../src/game/solver.ts'
import { validateDungeon } from '../src/game/validate.ts'
import { buildRegisterChallengeCall, extractChallengeIdFromOutcome, NEAR_PUBLISHING_FEE_YOCTO } from '../src/services/chain/nearRegistry.ts'
import { canonicalDungeonHash, encodeCanonicalShareCode } from '../src/game/canonicalIdentity.ts'
import {
  getCommunityCatalog,
  addOrUpdateCommunityDungeon,
  recordCommunityDungeonRun,
  searchAndFilterCommunityDungeons,
} from '../src/services/community/catalog.ts'
import type { RunResult } from '../src/game/result.ts'

void describe('End-to-End System Integration Flow', () => {
  void it('full economy, creator, near publishing, and community cycle', async () => {
    // 1. Initial runner profile
    let profile = createProfile()
    assert.equal(profile.coins, 50)
    assert.equal(profile.inventory.healthPotions, 1)
    assert.equal(profile.inventory.fullElixirs, 0)
    assert.equal(profile.inventory.energyCells, 0)

    // 2. Play and clear a dungeon to earn coins
    const runWin: RunResult = {
      dungeonId: 'practice-level-1',
      dungeonName: 'Level 1',
      mode: 'practice',
      outcome: 'win',
      timeMs: 14000,
      moves: 20,
      livesLost: 0,
      livesLeft: 3,
      score: 1600,
      progress: 1.0,
      difficulty: 2,
      par: 20,
      actions: 'RRRUUU',
      nearMisses: 1,
      bestCombo: 2,
      comboBonus: 50,
      keysCollected: 0,
      killedBy: { spike: 0, pulse: 0, sentry: 0 },
    }

    const { profile: pAfterWin, report: r1 } = applyRun(profile, runWin)
    profile = pAfterWin
    assert.equal(r1.coinsGained, 110)
    assert.equal(profile.coins, 50 + 110) // 160 coins

    // 3. Repeat run tests anti-farming diminishing returns
    const { profile: pAfterRepeat, report: r2 } = applyRun(profile, { ...runWin, moves: 22, livesLost: 1, livesLeft: 2 })
    profile = pAfterRepeat
    assert.equal(r2.coinsGained, 5) // Diminishing practice stipend
    assert.equal(profile.coins, 165)

    // 4. Shop Purchases: Buy Health Potion (30 coins) and Energy Cell (50 coins)
    const resPotion = applyPurchase(profile, 'potion-health')
    profile = resPotion.profile
    assert.equal(profile.coins, 135)
    assert.equal(profile.inventory.healthPotions, 2)

    const resEnergy = applyPurchase(profile, 'energy-cell')
    profile = resEnergy.profile
    assert.equal(profile.coins, 85)
    assert.equal(profile.inventory.energyCells, 1)
    assert.equal(profile.health.bonus, 3)

    // 5. In-Dungeon Health Restoration & Max Health Cap
    const testDungeon: Dungeon = {
      id: 'dungeon-active',
      name: 'Active Trial',
      cells: emptyCells(),
      start: CREATOR_START,
      exit: CREATOR_EXIT,
      creator: { profileId: 'p1', displayName: 'Creator' },
      source: 'creator',
      difficulty: 1,
      createdAt: 1000,
    }
    const ctrl = new RunController(testDungeon, { countdownStepMs: 0 })
    ctrl.start()

    assert.equal(ctrl.heal(1), false)
    assert.equal(ctrl.getSnapshot().lives, 3)

    // 6. Creator: Edit grid, undo, redo, named draft
    let cells = emptyCells()
    const history: CellType[][] = []
    const future: CellType[][] = []

    history.push(cells.slice())
    const p1 = place(cells, idx(4, 4), 'wall')
    if (p1.ok) cells = p1.cells
    history.push(cells.slice())
    const p2 = place(cells, idx(5, 5), 'pulse')
    if (p2.ok) cells = p2.cells

    assert.equal(cells[idx(4, 4)], 'wall')
    assert.equal(cells[idx(5, 5)], 'pulse')

    // Undo pulse
    future.unshift(cells.slice())
    cells = history.pop()!
    assert.equal(cells[idx(5, 5)], 'empty')
    assert.equal(cells[idx(4, 4)], 'wall')

    // Redo pulse
    history.push(cells.slice())
    cells = future.shift()!
    assert.equal(cells[idx(5, 5)], 'pulse')

    // Save Named Draft slot
    profile.drafts['Secret Maze'] = {
      cells: cells.slice(),
      order: [idx(4, 4), idx(5, 5)],
      remainingMs: 28000,
      started: true,
      locked: false,
    }
    assert.ok(profile.drafts['Secret Maze'])

    // 7. Solver & Fairness Verification
    const myDungeon: Dungeon = {
      id: 'my-custom-dungeon',
      name: 'Secret Maze',
      cells,
      start: CREATOR_START,
      exit: CREATOR_EXIT,
      creator: { profileId: 'me.testnet', displayName: 'me.testnet' },
      source: 'creator',
      difficulty: 2,
      createdAt: Date.now(),
    }
    const sol = solveDungeon(myDungeon)
    assert.equal(sol.solvable, true)
    const val = validateDungeon(myDungeon, { enforceBudget: true })
    assert.equal(val.ok, true)

    // 8. Native NEAR Paid Publishing
    const dungeonHash = await canonicalDungeonHash(myDungeon)
    const call = buildRegisterChallengeCall(
      'trap_run_registry.testnet',
      dungeonHash,
      NEAR_PUBLISHING_FEE_YOCTO,
      myDungeon.name,
    )
    assert.equal(call.deposit, '50000000000000000000000') // 0.05 NEAR
    assert.equal(call.methodName, 'register_challenge_with_metadata')

    // Simulate successful transaction receipt outcome
    const mockOutcome = {
      status: { SuccessValue: '' },
      transaction_outcome: { id: 'tx-pub-99' },
      receipts_outcome: [
        {
          outcome: {
            logs: [
              'EVENT_JSON:{"standard":"trap_run_registry","version":"1.0.0","event":"challenge_registered","data":[{"challenge_id":"88","creator":"me.testnet"}]}',
            ],
          },
        },
      ],
    }
    const challengeId = extractChallengeIdFromOutcome(mockOutcome)
    assert.equal(challengeId, '88')

    const shareCode = encodeCanonicalShareCode({
      dungeon: myDungeon,
      registry: { chain: 'near', network: 'testnet', registry: 'trap_run_registry.testnet' },
      challengeId: BigInt(challengeId),
    })
    assert.equal(shareCode.startsWith('TRI1.'), true)

    // 9. Add to Community Catalog and verify discovery
    addOrUpdateCommunityDungeon({
      id: myDungeon.id,
      title: myDungeon.name,
      creator: 'me.testnet',
      creatorType: 'near',
      difficulty: 2,
      par: val.par ?? 16,
      plays: 0,
      clears: 0,
      shareCode,
      createdAt: myDungeon.createdAt,
      dungeon: myDungeon,
      verifiedOnChain: true,
      nearChallengeId: challengeId,
    })

    const found = searchAndFilterCommunityDungeons(getCommunityCatalog(), 'Secret', 'all')
    assert.equal(found.length, 1)
    assert.equal(found[0].title, 'Secret Maze')
    assert.equal(found[0].verifiedOnChain, true)

    // Record runs on community level
    recordCommunityDungeonRun(myDungeon.id, true)
    const updated = searchAndFilterCommunityDungeons(getCommunityCatalog(), 'Secret', 'all')[0]
    assert.equal(updated.plays, 1)
    assert.equal(updated.clears, 1)
  })
})
