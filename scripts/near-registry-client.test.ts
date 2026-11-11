import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canonicalDungeonHash, hexToBytes, type CanonicalDungeonInput } from '../src/game/canonicalIdentity.ts'
import {
  buildGetChallengeCall,
  buildGetChallengesByCreatorCall,
  buildRegisterChallengeCall,
  decodeNearRegistryChallenge,
  decodeNearRegistryChallengeList,
  verifyNearRegistryChallenge,
} from '../src/services/chain/nearRegistry.ts'
import type { CellType } from '../src/game/types.ts'

const TILE_FROM_DIGIT: CellType[] = ['empty', 'wall', 'spike', 'pulse', 'sentryH', 'sentryV', 'key', 'door', 'switch', 'gate']
const fixture: Record<string, string> = {}
for (const line of readFileSync(new URL('../test-vectors/canonical-dungeon-v1.txt', import.meta.url), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const separator = line.indexOf('=')
  assert.notEqual(separator, -1, `Malformed fixture line: ${line}`)
  fixture[line.slice(0, separator)] = line.slice(separator + 1)
}
const dungeon: CanonicalDungeonInput = {
  cells: Array.from(fixture.tile_codes, (digit) => TILE_FROM_DIGIT[Number(digit)]),
  start: { x: Number(fixture.start_x), y: Number(fixture.start_y) },
  exit: { x: Number(fixture.exit_x), y: Number(fixture.exit_y) },
}

void test('future wallet call sends the raw canonical hash as Base64VecU8 with a storage deposit', async () => {
  const hash = await canonicalDungeonHash(dungeon)
  const request = buildRegisterChallengeCall(fixture.registry, hash, 10_000_000_000_000_000_000_000n)
  assert.deepEqual(request, {
    contractId: fixture.registry,
    methodName: 'register_challenge',
    args: { dungeon_hash: Buffer.from(hexToBytes(fixture.dungeon_hash_hex)).toString('base64') },
    gas: '30000000000000',
    deposit: '10000000000000000000000',
  })
  assert.deepEqual(buildGetChallengeCall(fixture.registry, 42n).args, { challenge_id: '42' })
})

void test('registry response verifies and reuses the Milestone 1 challenge identity rules', async () => {
  const result = await verifyNearRegistryChallenge({
    dungeon,
    network: fixture.network,
    registryAccountId: fixture.registry,
    expectedCreator: 'runner.testnet',
    challenge: {
      challenge_id: fixture.challenge_id,
      dungeon_hash: Buffer.from(hexToBytes(fixture.dungeon_hash_hex)).toString('base64'),
      creator: 'runner.testnet',
      schema_version: 1,
      registered_at_nanoseconds: '1',
      registered_at_block_height: '1',
    },
  })
  assert.deepEqual(result, { valid: true, challengeIdentityHex: fixture.challenge_hash_hex })
})

void test('creator pagination is encoded as decimal u64 and strictly bounded', () => {
  assert.deepEqual(buildGetChallengesByCreatorCall(fixture.registry, 'runner.testnet', 5n, 10), {
    contractId: fixture.registry,
    methodName: 'get_challenges_by_creator',
    args: { creator: 'runner.testnet', from_index: '5', limit: 10 },
  })
  assert.throws(() => buildGetChallengesByCreatorCall(fixture.registry, 'runner.testnet', 0n, 0), /between 1 and 50/)
  assert.throws(() => buildGetChallengesByCreatorCall(fixture.registry, 'runner.testnet', 0n, 51), /between 1 and 50/)
})

void test('registry response decoder accepts the exact contract JSON shape', () => {
  const response = {
    challenge_id: '42',
    dungeon_hash: Buffer.from(hexToBytes(fixture.dungeon_hash_hex)).toString('base64'),
    creator: 'runner.testnet',
    schema_version: 1,
    registered_at_nanoseconds: '123',
    registered_at_block_height: '456',
  }
  assert.deepEqual(decodeNearRegistryChallenge(response), response)
  assert.deepEqual(decodeNearRegistryChallengeList([response]), [response])
})

void test('registry response decoder rejects malformed ids, hashes, creators, versions, and oversized pages', () => {
  const valid = {
    challenge_id: '42',
    dungeon_hash: Buffer.from(hexToBytes(fixture.dungeon_hash_hex)).toString('base64'),
    creator: 'runner.testnet',
    schema_version: 1,
    registered_at_nanoseconds: '123',
    registered_at_block_height: '456',
  }
  assert.throws(() => decodeNearRegistryChallenge({ ...valid, challenge_id: '042' }))
  assert.throws(() => decodeNearRegistryChallenge({ ...valid, dungeon_hash: Buffer.alloc(31).toString('base64') }))
  assert.throws(() => decodeNearRegistryChallenge({ ...valid, creator: 'Runner.testnet' }))
  assert.throws(() => decodeNearRegistryChallenge({ ...valid, schema_version: 2 }))
  assert.throws(() => decodeNearRegistryChallengeList(Array.from({ length: 51 }, () => valid)))
})

void test('verification rejects creator, hash, schema, and network mismatches', async () => {
  const challenge = {
    challenge_id: fixture.challenge_id,
    dungeon_hash: Buffer.from(hexToBytes(fixture.dungeon_hash_hex)).toString('base64'),
    creator: 'runner.testnet',
    schema_version: 1,
    registered_at_nanoseconds: '1',
    registered_at_block_height: '1',
  }
  assert.equal((await verifyNearRegistryChallenge({ dungeon, challenge, network: 'testnet', registryAccountId: fixture.registry, expectedCreator: 'other.testnet' })).valid, false)
  assert.equal((await verifyNearRegistryChallenge({ dungeon, challenge: { ...challenge, dungeon_hash: Buffer.alloc(32, 7).toString('base64') }, network: 'testnet', registryAccountId: fixture.registry })).valid, false)
  assert.equal((await verifyNearRegistryChallenge({ dungeon, challenge: { ...challenge, schema_version: 2 }, network: 'testnet', registryAccountId: fixture.registry })).valid, false)
  assert.equal((await verifyNearRegistryChallenge({ dungeon, challenge, network: 'mainnet', registryAccountId: fixture.registry })).valid, false)
})

void test('challenge lookup rejects zero and u64 overflow', () => {
  assert.throws(() => buildGetChallengeCall(fixture.registry, 0n), /greater than zero/)
  assert.throws(() => buildGetChallengeCall(fixture.registry, 1n << 64n), /unsigned 64-bit/)
})

