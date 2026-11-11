import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CANONICAL_DUNGEON_VERSION,
  CanonicalIdentityError,
  bytesToHex,
  canonicalChallengeHashHex,
  canonicalDungeonBytes,
  canonicalDungeonHashHex,
  decodeCanonicalShareCode,
  encodeCanonicalShareCode,
  type CanonicalDungeonInput,
  type RegistryContext,
} from '../src/game/canonicalIdentity.ts'
import type { CellType } from '../src/game/types.ts'

const TILE_FROM_DIGIT: CellType[] = ['empty', 'wall', 'spike', 'pulse', 'sentryH', 'sentryV', 'key', 'door', 'switch', 'gate']

function fixture(): Record<string, string> {
  const text = readFileSync(new URL('../test-vectors/canonical-dungeon-v1.txt', import.meta.url), 'utf8')
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const split = line.indexOf('=')
        assert.notEqual(split, -1, `Malformed fixture line: ${line}`)
        return [line.slice(0, split), line.slice(split + 1)]
      }),
  )
}

const vector = fixture()
const dungeon: CanonicalDungeonInput = {
  cells: Array.from(vector.tile_codes, (digit) => {
    const tile = TILE_FROM_DIGIT[Number(digit)]
    assert.ok(tile, `Unknown fixture tile digit ${digit}`)
    return tile
  }),
  start: { x: Number(vector.start_x), y: Number(vector.start_y) },
  exit: { x: Number(vector.exit_x), y: Number(vector.exit_y) },
}
const registry: RegistryContext = { chain: vector.chain, network: vector.network, registry: vector.registry }
const challengeId = BigInt(vector.challenge_id)

void test('shared v1 fixture matches exact canonical bytes, hashes, and codes', async () => {
  assert.equal(bytesToHex(canonicalDungeonBytes(dungeon)), vector.canonical_dungeon_hex)
  assert.equal(await canonicalDungeonHashHex(dungeon), vector.dungeon_hash_hex)
  assert.equal(encodeCanonicalShareCode({ dungeon, registry }), vector.share_dungeon)
  assert.equal(encodeCanonicalShareCode({ dungeon, registry, challengeId }), vector.share_challenge)
  assert.equal(await canonicalChallengeHashHex({ dungeon, registry, challengeId }), vector.challenge_hash_hex)
})

void test('same dungeon is stable across runs and object field insertion order', async () => {
  const reordered = {
    exit: { y: dungeon.exit.y, x: dungeon.exit.x },
    start: { y: dungeon.start.y, x: dungeon.start.x },
    cells: [...dungeon.cells],
  } as CanonicalDungeonInput
  assert.equal(await canonicalDungeonHashHex(dungeon), await canonicalDungeonHashHex(dungeon))
  assert.equal(bytesToHex(canonicalDungeonBytes(dungeon)), bytesToHex(canonicalDungeonBytes(reordered)))
})

void test('gameplay changes produce different dungeon hashes', async () => {
  const cells = [...dungeon.cells]
  cells[40] = 'spike'
  assert.notEqual(await canonicalDungeonHashHex(dungeon), await canonicalDungeonHashHex({ ...dungeon, cells }))
  assert.notEqual(await canonicalDungeonHashHex(dungeon), await canonicalDungeonHashHex({ ...dungeon, start: { x: 1, y: 8 } }))
})

void test('invalid coordinates and layouts are rejected', () => {
  assert.throws(() => canonicalDungeonBytes({ ...dungeon, start: { x: -1, y: 0 } }), CanonicalIdentityError)
  assert.throws(() => canonicalDungeonBytes({ ...dungeon, exit: { x: 9, y: 0 } }), CanonicalIdentityError)
  assert.throws(() => canonicalDungeonBytes({ ...dungeon, start: { x: 0.5, y: 0 } }), CanonicalIdentityError)
  assert.throws(() => canonicalDungeonBytes({ ...dungeon, exit: dungeon.start }), CanonicalIdentityError)
  assert.throws(() => canonicalDungeonBytes({ ...dungeon, cells: dungeon.cells.slice(0, 80) }), CanonicalIdentityError)
  assert.throws(() => canonicalDungeonBytes({ ...dungeon, cells: [...dungeon.cells.slice(0, 20), 'lava' as CellType, ...dungeon.cells.slice(21)] }), CanonicalIdentityError)
  const blockedStart = [...dungeon.cells]
  blockedStart[dungeon.start.y * 9 + dungeon.start.x] = 'wall'
  assert.throws(() => canonicalDungeonBytes({ ...dungeon, cells: blockedStart }), CanonicalIdentityError)
})

void test('optional challenge id is deterministic and round trips as null or u64', () => {
  const omitted = encodeCanonicalShareCode({ dungeon, registry })
  const explicitNull = encodeCanonicalShareCode({ dungeon, registry, challengeId: null })
  assert.equal(omitted, explicitNull)
  assert.equal(decodeCanonicalShareCode(omitted).challengeId, null)
  assert.equal(decodeCanonicalShareCode(vector.share_challenge).challengeId, challengeId)
  assert.throws(() => encodeCanonicalShareCode({ dungeon, registry, challengeId: 0n }), CanonicalIdentityError)
  assert.throws(() => encodeCanonicalShareCode({ dungeon, registry, challengeId: 1n << 64n }), CanonicalIdentityError)
})

void test('unsupported versions are rejected explicitly', () => {
  assert.equal(CANONICAL_DUNGEON_VERSION, 1)
  assert.throws(() => canonicalDungeonBytes(dungeon, 2), /Unsupported dungeon identity version 2/)
  const decoded = decodeCanonicalShareCode(vector.share_dungeon)
  assert.equal(decoded.version, 1)
  const payload = Buffer.from(vector.share_dungeon.slice('TRI1.'.length), 'base64url')
  payload[4] = 2
  assert.throws(() => decodeCanonicalShareCode(`TRI1.${payload.toString('base64url')}`), /Unsupported share version 2/)
})

void test('chain, network, and registry contract domain-separate challenge identity', async () => {
  const base = await canonicalChallengeHashHex({ dungeon, registry, challengeId })
  assert.notEqual(base, await canonicalChallengeHashHex({ dungeon, registry: { ...registry, chain: 'other' }, challengeId }))
  assert.notEqual(base, await canonicalChallengeHashHex({ dungeon, registry: { ...registry, network: 'mainnet' }, challengeId }))
  assert.notEqual(base, await canonicalChallengeHashHex({ dungeon, registry: { ...registry, registry: 'other-registry.testnet' }, challengeId }))
  assert.notEqual(base, await canonicalChallengeHashHex({ dungeon, registry, challengeId: challengeId + 1n }))
})

void test('share-code encode/decode is lossless and canonical', () => {
  for (const code of [vector.share_dungeon, vector.share_challenge]) {
    const decoded = decodeCanonicalShareCode(code)
    assert.deepEqual(decoded.dungeon, { cells: [...dungeon.cells], start: dungeon.start, exit: dungeon.exit })
    assert.deepEqual(decoded.registry, registry)
    assert.equal(encodeCanonicalShareCode(decoded), code)
  }
  assert.throws(() => decodeCanonicalShareCode(vector.share_dungeon + '='), CanonicalIdentityError)
  assert.throws(() => encodeCanonicalShareCode({ dungeon, registry: { ...registry, chain: 'NEAR' } }), CanonicalIdentityError)
  assert.throws(() => encodeCanonicalShareCode({ dungeon, registry: { ...registry, registry: 'régistry.testnet' } }), CanonicalIdentityError)
})
