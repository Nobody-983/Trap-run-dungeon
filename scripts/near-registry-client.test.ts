import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canonicalDungeonHash, hexToBytes, type CanonicalDungeonInput } from '../src/game/canonicalIdentity.ts'
import {
  buildGetChallengeCall,
  buildGetDungeonCall,
  buildGetChallengeByHashCall,
  buildIsDungeonRegisteredCall,
  buildVerifyCreatorCall,
  buildGetChallengeCountCall,
  buildGetDungeonCountCall,
  buildUpdateMetadataCall,
  buildUpdateDungeonCall,
  buildUnpublishDungeonCall,
  buildGetChallengesByCreatorCall,
  buildGetCreatorDungeonsCall,
  buildRegisterChallengeCall,
  buildPublishDungeonCall,
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

void test('new contract call builders support hash lookup, creator verification, count, and metadata updates', async () => {
  const hash = await canonicalDungeonHash(dungeon)
  const byHash = buildGetChallengeByHashCall(fixture.registry, hash)
  assert.equal(byHash.methodName, 'get_challenge_by_hash')
  assert.equal(byHash.contractId, fixture.registry)

  const isRegistered = buildIsDungeonRegisteredCall(fixture.registry, hash)
  assert.equal(isRegistered.methodName, 'is_dungeon_registered')

  const verifyCreator = buildVerifyCreatorCall(fixture.registry, 1n, 'runner.testnet')
  assert.equal(verifyCreator.methodName, 'verify_creator')
  assert.deepEqual(verifyCreator.args, { challenge_id: '1', account_id: 'runner.testnet' })

  const countCall = buildGetChallengeCountCall(fixture.registry)
  assert.equal(countCall.methodName, 'get_challenge_count')

  const metadataCall = buildUpdateMetadataCall(fixture.registry, 1n, 'New Title')
  assert.equal(metadataCall.methodName, 'update_metadata')
  assert.deepEqual(metadataCall.args, { challenge_id: '1', metadata: 'New Title' })

  const registerWithMeta = buildRegisterChallengeCall(fixture.registry, hash, 1000n, 'My Dungeon')
  assert.equal(registerWithMeta.methodName, 'register_challenge_with_metadata')
  if (registerWithMeta.methodName === 'register_challenge_with_metadata') {
    assert.equal(registerWithMeta.args.metadata, 'My Dungeon')
  }
})

void test('canonical publishing call builders and response decoder support the enhanced contract API', async () => {
  const hash = await canonicalDungeonHash(dungeon)

  // publish_dungeon
  const pubCall = buildPublishDungeonCall(fixture.registry, hash, 50_000_000_000_000_000_000_000n, 'ipfs://bafy.../metadata.json')
  assert.equal(pubCall.methodName, 'publish_dungeon')
  assert.equal(pubCall.contractId, fixture.registry)
  assert.equal(pubCall.deposit, '50000000000000000000000')
  if (pubCall.methodName === 'publish_dungeon') {
    assert.equal(pubCall.args.metadata_uri, 'ipfs://bafy.../metadata.json')
  }

  // update_dungeon
  const updateCall = buildUpdateDungeonCall(fixture.registry, 7n, 'ipfs://new_meta')
  assert.equal(updateCall.methodName, 'update_dungeon')
  if (updateCall.methodName === 'update_dungeon') {
    assert.equal(updateCall.args.dungeon_id, '7')
    assert.equal(updateCall.args.metadata_uri, 'ipfs://new_meta')
  }

  // unpublish_dungeon
  const unpubCall = buildUnpublishDungeonCall(fixture.registry, 7n)
  assert.equal(unpubCall.methodName, 'unpublish_dungeon')
  assert.equal(unpubCall.deposit, '1')
  if (unpubCall.methodName === 'unpublish_dungeon') {
    assert.equal(unpubCall.args.dungeon_id, '7')
  }

  // view builders
  const getDungeonCall = buildGetDungeonCall(fixture.registry, 7n)
  assert.equal(getDungeonCall.methodName, 'get_dungeon')
  assert.deepEqual(getDungeonCall.args, { dungeon_id: '7' })

  const getDungeonCountCall = buildGetDungeonCountCall(fixture.registry)
  assert.equal(getDungeonCountCall.methodName, 'get_dungeon_count')

  const getCreatorDungeonsCall = buildGetCreatorDungeonsCall(fixture.registry, 'creator.testnet', 10n, 25)
  assert.equal(getCreatorDungeonsCall.methodName, 'get_creator_dungeons')
  assert.deepEqual(getCreatorDungeonsCall.args, { creator: 'creator.testnet', from_index: '10', limit: 25 })

  // Full response decode
  const fullResponse = {
    dungeon_id: '7',
    challenge_id: '7',
    dungeon_hash: Buffer.from(hexToBytes(fixture.dungeon_hash_hex)).toString('base64'),
    creator: 'runner.testnet',
    schema_version: 1,
    registered_at_nanoseconds: '123000',
    registered_at_block_height: '45600',
    updated_at_nanoseconds: '124000',
    updated_at_block_height: '45700',
    version: 2,
    is_published: true,
    metadata_uri: 'ipfs://uri',
    metadata: 'ipfs://uri',
  }
  const decoded = decodeNearRegistryChallenge(fullResponse)
  assert.equal(decoded.dungeon_id, '7')
  assert.equal(decoded.challenge_id, '7')
  assert.equal(decoded.version, 2)
  assert.equal(decoded.is_published, true)
  assert.equal(decoded.metadata_uri, 'ipfs://uri')
  assert.equal(decoded.updated_at_block_height, '45700')
})

