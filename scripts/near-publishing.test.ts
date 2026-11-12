import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildRegisterChallengeCall,
  extractChallengeIdFromOutcome,
  NEAR_PUBLISHING_FEE_YOCTO,
  NEAR_REGISTER_CHALLENGE_GAS,
} from '../src/services/chain/nearRegistry.ts'
import { canonicalDungeonHash, encodeCanonicalShareCode } from '../src/game/canonicalIdentity.ts'
import { emptyCells, CREATOR_START, CREATOR_EXIT, type Dungeon } from '../src/game/types.ts'

void describe('Native NEAR Paid Publishing & Outcome Verification', () => {
  const sampleDungeon: Dungeon = {
    id: 'test-near-publish',
    name: 'Vault of Trials',
    cells: emptyCells(),
    start: CREATOR_START,
    exit: CREATOR_EXIT,
    creator: { profileId: 'runner.testnet', displayName: 'runner.testnet' },
    source: 'creator',
    difficulty: 2,
    par: 16,
    createdAt: 1000,
  }

  void it('constructs register challenge call with 0.05 NEAR attached publishing deposit', async () => {
    const dungeonHash = await canonicalDungeonHash(sampleDungeon)
    assert.equal(dungeonHash.length, 32)

    const call = buildRegisterChallengeCall(
      'trap_run_registry.testnet',
      dungeonHash,
      NEAR_PUBLISHING_FEE_YOCTO,
      'Vault of Trials',
    )

    assert.equal(call.contractId, 'trap_run_registry.testnet')
    assert.equal(call.methodName, 'register_challenge_with_metadata')
    assert.equal(call.deposit, '50000000000000000000000') // 0.05 NEAR in yocto
    assert.equal(call.gas, NEAR_REGISTER_CHALLENGE_GAS.toString())
    if ('metadata' in call.args) {
      assert.equal(call.args.metadata, 'Vault of Trials')
    }
    if ('dungeon_hash' in call.args) {
      assert.equal(typeof call.args.dungeon_hash, 'string')
    }
  })

  void it('extracts challenge ID from NEP-297 event logs in transaction outcome', () => {
    const mockOutcome = {
      status: { SuccessValue: '' },
      transaction_outcome: { id: 'tx-12345' },
      receipts_outcome: [
        {
          outcome: {
            logs: [
              'EVENT_JSON:{"standard":"trap_run_registry","version":"1.0.0","event":"challenge_registered","data":[{"challenge_id":"42","creator":"runner.testnet"}]}',
            ],
          },
        },
      ],
    }

    const challengeId = extractChallengeIdFromOutcome(mockOutcome)
    assert.equal(challengeId, '42')
  })

  void it('extracts challenge ID from status.SuccessValue fallback', () => {
    const mockOutcome = {
      status: { SuccessValue: btoa('"77"') },
      transaction_outcome: { id: 'tx-67890' },
      receipts_outcome: [],
    }

    const challengeId = extractChallengeIdFromOutcome(mockOutcome)
    assert.equal(challengeId, '77')
  })

  void it('generates canonical share code for registered challenge', () => {
    const shareCode = encodeCanonicalShareCode({
      dungeon: sampleDungeon,
      registry: { chain: 'near', network: 'testnet', registry: 'trap_run_registry.testnet' },
      challengeId: 42n,
    })

    assert.equal(shareCode.startsWith('TRI1.'), true)
  })

  void it('throws error when challenge ID cannot be extracted from outcome', () => {
    const emptyOutcome = {
      status: {},
      transaction_outcome: { id: 'tx-fail' },
      receipts_outcome: [],
    }

    assert.throws(() => extractChallengeIdFromOutcome(emptyOutcome), /Could not extract challenge ID/)
  })
})
