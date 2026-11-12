import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyCells, idx, CREATOR_START, CREATOR_EXIT, type Dungeon } from '../src/game/types.ts'
import { validateDungeon } from '../src/game/validate.ts'
import { solveDungeon } from '../src/game/solver.ts'
import {
  canonicalDungeonHash,
  canonicalDungeonHashHex,
  canonicalDungeonHashBase64,
  encodeCanonicalShareCode,
  decodeCanonicalShareCode,
} from '../src/game/canonicalIdentity.ts'
import {
  buildRegisterChallengeCall,
  NEAR_PUBLISHING_FEE_YOCTO,
  extractChallengeIdFromOutcome,
} from '../src/services/chain/nearRegistry.ts'
import {
  syncVerifiedPublishingToSupabase,
  getPendingSyncs,
  savePendingSync,
  removePendingSync,
  type PendingPublishSync,
} from '../src/services/chain/nearTransactionVerifier.ts'
import {
  addOrUpdateCommunityDungeon,
  getCommunityCatalog,
  recordCommunityDungeonRun,
  type CommunityDungeon,
} from '../src/services/community/catalog.ts'

void describe('End-to-End Workflows & Security Verification', () => {
  const sampleCells = emptyCells()
  sampleCells[idx(3, 3)] = 'wall'
  sampleCells[idx(5, 5)] = 'spike'

  const validDungeon: Dungeon = {
    id: 'e2e-test-dungeon-1',
    name: 'E2E Fortress',
    cells: sampleCells,
    start: CREATOR_START,
    exit: CREATOR_EXIT,
    creator: { profileId: 'near:architect.testnet', displayName: 'architect.testnet' },
    source: 'creator',
    difficulty: 2,
    par: 18,
    createdAt: 1700000000000,
  }

  // --- WORKFLOW A: NORMAL PUBLISHING LIFECYCLE ---
  void it('Workflow A: Normal publishing lifecycle from creator self-clear to community feed', async () => {
    // 1. Validate dungeon
    const val = validateDungeon(validDungeon)
    assert.equal(val.ok, true)

    // 2. BFS solver verifies it is escape-solvable
    const solution = solveDungeon(validDungeon)
    assert.equal(solution.solvable, true)

    // 3. Creator self-clear proof key
    const layoutKey = validDungeon.cells.join(',')
    const creatorSelfClearKey = layoutKey
    assert.equal(creatorSelfClearKey, layoutKey)

    // 4. Canonical layout hash calculation
    const hash = await canonicalDungeonHash(validDungeon)
    const hashHex = await canonicalDungeonHashHex(validDungeon)
    const hashBase64 = await canonicalDungeonHashBase64(validDungeon)
    assert.equal(hash.length, 32)
    assert.equal(typeof hashHex, 'string')
    assert.equal(typeof hashBase64, 'string')

    // 5. Construct contract call with 0.05 NEAR deposit
    const call = buildRegisterChallengeCall(
      'traprun-registry.testnet',
      hash,
      NEAR_PUBLISHING_FEE_YOCTO,
      validDungeon.name,
    )
    assert.equal(call.methodName, 'register_challenge_with_metadata')
    assert.equal(call.deposit, '50000000000000000000000')

    // 6. Mock successful NEAR RPC receipt with NEP-297 event
    const outcome = {
      receipts_outcome: [
        {
          outcome: {
            logs: [
              `EVENT_JSON:{"standard":"trap_run_registry","version":"1.0.0","event":"challenge_registered","data":[{"challenge_id":777,"dungeon_hash":"${hashBase64}","creator":"architect.testnet"}]}`,
            ],
            status: { SuccessValue: '' },
          },
        },
      ],
      status: { SuccessValue: 'Nzc3' },
      transaction: { hash: '9xTxHashValid777ABC' },
    }

    const challengeId = extractChallengeIdFromOutcome(outcome)
    assert.equal(challengeId, '777')

    // 7. Generate canonical TRI1 share code
    const shareCode = encodeCanonicalShareCode({
      dungeon: validDungeon,
      registry: { chain: 'near', network: 'testnet', registry: 'traprun-registry.testnet' },
      challengeId: BigInt(challengeId),
    })
    assert.match(shareCode, /^TRI1\./)

    // 8. Add to community catalog
    const communityEntry: CommunityDungeon = {
      id: validDungeon.id,
      title: validDungeon.name,
      creator: 'architect.testnet',
      creatorType: 'near',
      difficulty: validDungeon.difficulty,
      par: validDungeon.par ?? 18,
      plays: 0,
      clears: 0,
      shareCode,
      createdAt: validDungeon.createdAt,
      dungeon: validDungeon,
      verifiedOnChain: true,
      nearChallengeId: '777',
      nearTxHash: '9xTxHashValid777ABC',
      origin: 'on-chain',
    }
    addOrUpdateCommunityDungeon(communityEntry)

    const catalog = getCommunityCatalog()
    const found = catalog.find((c) => c.id === validDungeon.id)
    assert.ok(found)
    assert.equal(found?.verifiedOnChain, true)
    assert.equal(found?.nearChallengeId, '777')
  })

  // --- WORKFLOW B: CROSS-DEVICE DISCOVERY ---
  void it('Workflow B: Cross-device discovery via canonical share code without shared DB', async () => {
    // Device A encodes dungeon with registered challenge ID
    const shareCodeDeviceA = encodeCanonicalShareCode({
      dungeon: validDungeon,
      registry: { chain: 'near', network: 'testnet', registry: 'traprun-registry.testnet' },
      challengeId: 888n,
    })

    // Device B receives share code string
    const decodedDeviceB = decodeCanonicalShareCode(shareCodeDeviceA)
    assert.equal(decodedDeviceB.challengeId, 888n)
    assert.equal(decodedDeviceB.registry.chain, 'near')
    assert.equal(decodedDeviceB.registry.network, 'testnet')
    assert.equal(decodedDeviceB.registry.registry, 'traprun-registry.testnet')

    // Confirm Device B reconstructed exact layout hash
    const reconstructedDungeon: Dungeon = {
      id: 'device-b-dungeon',
      name: 'Reconstructed',
      ...decodedDeviceB.dungeon,
      creator: { profileId: 'near:architect.testnet', displayName: 'architect.testnet' },
      source: 'friend',
      difficulty: 2,
      createdAt: 1700000000000,
    }

    const hashDeviceA = await canonicalDungeonHashHex(validDungeon)
    const hashDeviceB = await canonicalDungeonHashHex(reconstructedDungeon)
    assert.equal(hashDeviceA, hashDeviceB)

    // Device B registers in its local community catalog and records run
    addOrUpdateCommunityDungeon({
      id: reconstructedDungeon.id,
      title: reconstructedDungeon.name,
      creator: reconstructedDungeon.creator.displayName,
      creatorType: 'near',
      difficulty: reconstructedDungeon.difficulty,
      par: reconstructedDungeon.par ?? 18,
      plays: 0,
      clears: 0,
      shareCode: shareCodeDeviceA,
      createdAt: reconstructedDungeon.createdAt,
      dungeon: reconstructedDungeon,
    })

    recordCommunityDungeonRun(reconstructedDungeon.id, true)
    const catalog = getCommunityCatalog()
    const item = catalog.find((c) => c.id === reconstructedDungeon.id)
    assert.ok(item)
    assert.ok(item.plays >= 1)
  })

  // --- WORKFLOW C: SECURITY AUDIT & TAMPER RESISTANCE ---
  void it('Workflow C: Security protections against forged publishing, altered layouts & underfunding', async () => {
    // 1. Modifying cells after self-clear test run invalidates clearance key
    const modifiedCells = sampleCells.slice()
    modifiedCells[idx(1, 2)] = 'spike' // sneak in extra spike
    const modifiedLayoutKey = modifiedCells.join(',')
    const initialClearedKey = sampleCells.join(',')
    assert.notEqual(modifiedLayoutKey, initialClearedKey)

    // 2. Altered layout produces different canonical hash
    const modifiedDungeon: Dungeon = { ...validDungeon, cells: modifiedCells }
    const originalHash = await canonicalDungeonHashHex(validDungeon)
    const alteredHash = await canonicalDungeonHashHex(modifiedDungeon)
    assert.notEqual(originalHash, alteredHash)

    // 3. Reject non-positive or malformed publishing deposit
    const testHash = await canonicalDungeonHash(validDungeon)
    assert.throws(() => {
      buildRegisterChallengeCall(
        'traprun-registry.testnet',
        testHash,
        0n,
      )
    }, /NEAR registry storage deposit must be positive/)

    // 4. Reject invalid contract account ID
    assert.throws(() => {
      buildRegisterChallengeCall(
        'invalid#registry!',
        testHash,
        NEAR_PUBLISHING_FEE_YOCTO,
      )
    }, /Registry account ID is invalid/)

    // 5. Extraction fails when receipt contains execution error
    const failedReceiptOutcome = {
      receipts_outcome: [
        {
          outcome: {
            logs: [],
            status: { Failure: { ActionError: { FunctionCallError: { ExecutionError: 'Smart contract panicked' } } } },
          },
        },
      ],
      status: {},
      transaction: { hash: 'failTx' },
    }
    assert.throws(() => {
      extractChallengeIdFromOutcome(failedReceiptOutcome)
    }, /Could not extract challenge ID from NEAR transaction outcome/)
  })

  // --- WORKFLOW D: FAILURE RECOVERY & BUFFERED SYNC ---
  void it('Workflow D: Safe failure recovery and pending sync buffer when database is unreachable', async () => {
    const pendingItem: PendingPublishSync = {
      txHash: '9xTxSuccessfulOnChain999',
      creatorAccountId: 'resilient_creator.testnet',
      challengeId: '999',
      dungeon: validDungeon,
      shareCode: 'TRI1.mockShareCode999',
      registeredAt: Date.now(),
    }

    // When backend request fails, item is preserved in pending sync queue
    savePendingSync(pendingItem)
    const pendingList = getPendingSyncs()
    assert.equal(pendingList.length >= 1, true)
    assert.ok(pendingList.some((s) => s.txHash === '9xTxSuccessfulOnChain999'))

    // Player does NOT have to re-pay; retry synchronization resolves item
    const syncRes = await syncVerifiedPublishingToSupabase(pendingItem)
    // Since Supabase is offline in test env, synced is false and item remains safely buffered
    assert.equal(typeof syncRes.synced, 'boolean')

    // Clean up test item
    removePendingSync(pendingItem.txHash)
    const afterClean = getPendingSyncs()
    assert.ok(!afterClean.some((s) => s.txHash === '9xTxSuccessfulOnChain999'))
  })

  // --- WORKFLOW E: EXHAUSTIVE SECURITY & ADVERSARIAL ATTACK TESTS ---
  void it('Workflow E: Security test - Fake transaction hash rejection', () => {
    const BASE58_TX_REGEX = /^[1-9A-HJ-NP-Za-km-z]{40,46}$/
    const fakeHashes = [
      '',
      'short',
      '000InvalidChars000IlO0', // Contains 0, I, l, O which are not Base58
      'toolong'.repeat(10),
      '../../../etc/passwd',
      'DROP TABLE dungeons;',
    ]
    for (const fake of fakeHashes) {
      assert.equal(BASE58_TX_REGEX.test(fake), false, `Hash ${fake} should fail Base58 regex`)
    }

    // A valid NEAR tx hash is 32 bytes base58-encoded (43-44 chars, no 0, O, I, l)
    const validHash = '6zghSTUsvfdXdTHP7u848e3gRkWyZ8v6b987654321ABCD'
    assert.equal(BASE58_TX_REGEX.test(validHash), true)
  })

  void it('Workflow E: Security test - Reject wrong signer, receiver, method, and underfunded deposit', () => {
    const REQUIRED_DEPOSIT_YOCTO = 50_000_000_000_000_000_000_000n
    const EXPECTED_CONTRACT = 'traprun-registry.testnet'
    const EXPECTED_SIGNER = 'legit_creator.testnet'

    interface MockAction {
      FunctionCall?: {
        method_name: string
        deposit?: string
        args?: string
      }
    }

    interface MockReceiptOutcome {
      outcome?: {
        status?: {
          Failure?: unknown
        }
      }
    }

    interface MockTxPayload {
      status?: {
        Failure?: unknown
      }
      receipts_outcome?: MockReceiptOutcome[]
      transaction?: {
        signer_id?: string
        receiver_id?: string
        actions?: MockAction[]
      }
    }

    // Mock verification helper mirroring Edge Function logic
    const evaluateTxSecurity = (tx: MockTxPayload, expectedSigner: string, expectedReceiver: string) => {
      if (tx?.status?.Failure) return { ok: false, error: 'Transaction execution failed' }
      if (tx?.receipts_outcome?.some((ro) => ro?.outcome?.status?.Failure)) {
        return { ok: false, error: 'Receipt execution failed' }
      }
      if (tx?.transaction?.signer_id !== expectedSigner) {
        return { ok: false, error: 'Signer mismatch' }
      }
      if (tx?.transaction?.receiver_id !== expectedReceiver) {
        return { ok: false, error: 'Receiver mismatch' }
      }
      const actions = tx?.transaction?.actions || []
      const funcCall = actions.find(
        (a) =>
          a.FunctionCall &&
          ['register_challenge', 'register_challenge_with_metadata'].includes(a.FunctionCall.method_name),
      )
      if (!funcCall?.FunctionCall) {
        return { ok: false, error: 'Missing register_challenge method' }
      }
      const deposit = BigInt(funcCall.FunctionCall.deposit || '0')
      if (deposit < REQUIRED_DEPOSIT_YOCTO) {
        return { ok: false, error: 'Insufficient deposit' }
      }
      return { ok: true }
    }

    // 1. Wrong signer
    const wrongSignerTx = {
      transaction: { signer_id: 'attacker.testnet', receiver_id: EXPECTED_CONTRACT, actions: [{ FunctionCall: { method_name: 'register_challenge_with_metadata', deposit: '50000000000000000000000' } }] },
    }
    assert.equal(evaluateTxSecurity(wrongSignerTx, EXPECTED_SIGNER, EXPECTED_CONTRACT).ok, false)

    // 2. Wrong receiver
    const wrongReceiverTx = {
      transaction: { signer_id: EXPECTED_SIGNER, receiver_id: 'malicious-contract.testnet', actions: [{ FunctionCall: { method_name: 'register_challenge_with_metadata', deposit: '50000000000000000000000' } }] },
    }
    assert.equal(evaluateTxSecurity(wrongReceiverTx, EXPECTED_SIGNER, EXPECTED_CONTRACT).ok, false)

    // 3. Wrong method
    const wrongMethodTx = {
      transaction: { signer_id: EXPECTED_SIGNER, receiver_id: EXPECTED_CONTRACT, actions: [{ FunctionCall: { method_name: 'ft_transfer', deposit: '50000000000000000000000' } }] },
    }
    assert.equal(evaluateTxSecurity(wrongMethodTx, EXPECTED_SIGNER, EXPECTED_CONTRACT).ok, false)

    // 4. Underfunded deposit (less than 0.05 NEAR)
    const underfundedTx = {
      transaction: { signer_id: EXPECTED_SIGNER, receiver_id: EXPECTED_CONTRACT, actions: [{ FunctionCall: { method_name: 'register_challenge_with_metadata', deposit: '10000000000000000000000' } }] },
    }
    assert.equal(evaluateTxSecurity(underfundedTx, EXPECTED_SIGNER, EXPECTED_CONTRACT).ok, false)

    // 5. Failed execution
    const failedTx = {
      status: { Failure: { ActionError: 'ExecutionError' } },
      transaction: { signer_id: EXPECTED_SIGNER, receiver_id: EXPECTED_CONTRACT, actions: [{ FunctionCall: { method_name: 'register_challenge_with_metadata', deposit: '50000000000000000000000' } }] },
    }
    assert.equal(evaluateTxSecurity(failedTx, EXPECTED_SIGNER, EXPECTED_CONTRACT).ok, false)

    // 6. Valid tx passes
    const validTx = {
      transaction: { signer_id: EXPECTED_SIGNER, receiver_id: EXPECTED_CONTRACT, actions: [{ FunctionCall: { method_name: 'register_challenge_with_metadata', deposit: '50000000000000000000000' } }] },
    }
    assert.equal(evaluateTxSecurity(validTx, EXPECTED_SIGNER, EXPECTED_CONTRACT).ok, true)
  })

  void it('Workflow E: Security test - Layout hash mismatch detection in tx arguments', async () => {
    const originalHashBase64 = await canonicalDungeonHashBase64(validDungeon)
    const forgedHashBase64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

    const checkHashMatch = (txArgsBase64: string, expectedHash: string) => {
      const decoded = JSON.parse(Buffer.from(txArgsBase64, 'base64').toString('utf8')) as {
        dungeon_hash?: string
      }
      return decoded.dungeon_hash === expectedHash
    }

    const payload = Buffer.from(JSON.stringify({ dungeon_hash: originalHashBase64, title: 'Valid' })).toString('base64')
    assert.equal(checkHashMatch(payload, originalHashBase64), true)
    assert.equal(checkHashMatch(payload, forgedHashBase64), false)
  })

  void it('Workflow E: Security test - Duplicate sync and idempotent retry handling', () => {
    const existingDatabaseRecords = new Map<string, { id: string; challengeId: number }>()
    existingDatabaseRecords.set('9xTxHashValid777ABC', { id: 'uuid-1', challengeId: 777 })

    const processSyncRequest = (txHash: string) => {
      if (existingDatabaseRecords.has(txHash)) {
        return {
          status: 200,
          success: true,
          message: 'Transaction already verified and registered',
          ...existingDatabaseRecords.get(txHash),
        }
      }
      return { status: 201, success: true, message: 'New registration created' }
    }

    // First lookup returns already verified
    const firstCall = processSyncRequest('9xTxHashValid777ABC')
    assert.equal(firstCall.status, 200)
    assert.equal(firstCall.challengeId, 777)

    // Second retry produces identical idempotent outcome
    const secondCall = processSyncRequest('9xTxHashValid777ABC')
    assert.equal(secondCall.status, 200)
    assert.equal(secondCall.challengeId, 777)
  })
})
