import { CELL_COUNT, GRID, idx, type CellType, type Point } from './types.ts'

/** Canonical dungeon identity schema. Changes require a new version, never an in-place edit. */
export const CANONICAL_DUNGEON_VERSION = 1 as const
export const CANONICAL_SHARE_VERSION = 1 as const
export const CANONICAL_SHARE_PREFIX = 'TRI1.'

const DUNGEON_MAGIC = ascii('TRDG')
const SHARE_MAGIC = ascii('TRSC')
const CHALLENGE_MAGIC = ascii('TRCH')
const DUNGEON_DOMAIN = ascii('TRAPRUN:DUNGEON\0')
const CHALLENGE_DOMAIN = ascii('TRAPRUN:CHALLENGE\0')
const MAX_U64 = (1n << 64n) - 1n

/** Stable numeric tile codes. Never reorder or reuse an existing code. */
export const CANONICAL_TILE_CODES: Readonly<Record<CellType, number>> = Object.freeze({
  empty: 0,
  wall: 1,
  spike: 2,
  pulse: 3,
  sentryH: 4,
  sentryV: 5,
  key: 6,
  door: 7,
  switch: 8,
  gate: 9,
})

const TILE_FROM_CODE: ReadonlyArray<CellType | undefined> = Object.freeze(
  Object.entries(CANONICAL_TILE_CODES).reduce<Array<CellType | undefined>>((out, [tile, code]) => {
    out[code] = tile as CellType
    return out
  }, []),
)

export interface CanonicalDungeonInput {
  cells: readonly CellType[]
  start: Point
  exit: Point
}

export interface RegistryContext {
  chain: string
  network: string
  registry: string
}

export interface CanonicalShareInput {
  dungeon: CanonicalDungeonInput
  registry: RegistryContext
  /** Null or omitted means a dungeon registration reference, not a challenge. */
  challengeId?: bigint | null
}

export interface DecodedCanonicalShare {
  version: typeof CANONICAL_SHARE_VERSION
  dungeon: { cells: CellType[]; start: Point; exit: Point }
  registry: RegistryContext
  challengeId: bigint | null
}

export class CanonicalIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalIdentityError'
  }
}

/**
 * Bytes for dungeon schema v1:
 * magic[4], version u8, width u8, height u8, start x/y u8, exit x/y u8,
 * then 81 row-major tile-code bytes.
 */
export function canonicalDungeonBytes(input: CanonicalDungeonInput, version: number = CANONICAL_DUNGEON_VERSION): Uint8Array {
  if (version !== CANONICAL_DUNGEON_VERSION) throw new CanonicalIdentityError(`Unsupported dungeon identity version ${version}`)
  assertDungeon(input)
  const out = new Uint8Array(11 + CELL_COUNT)
  out.set(DUNGEON_MAGIC, 0)
  out[4] = CANONICAL_DUNGEON_VERSION
  out[5] = GRID
  out[6] = GRID
  out[7] = input.start.x
  out[8] = input.start.y
  out[9] = input.exit.x
  out[10] = input.exit.y
  input.cells.forEach((tile, i) => {
    out[11 + i] = CANONICAL_TILE_CODES[tile]
  })
  return out
}

/** SHA-256(domain || canonicalDungeonBytes). */
export async function canonicalDungeonHash(input: CanonicalDungeonInput, version: number = CANONICAL_DUNGEON_VERSION): Promise<Uint8Array> {
  return sha256(concat(DUNGEON_DOMAIN, canonicalDungeonBytes(input, version)))
}

export async function canonicalDungeonHashHex(input: CanonicalDungeonInput, version: number = CANONICAL_DUNGEON_VERSION): Promise<string> {
  return bytesToHex(await canonicalDungeonHash(input, version))
}

/**
 * Bytes that identify one registered challenge independently of the share envelope:
 * magic[4], version u8, length-prefixed registry context, challenge id u64-be,
 * dungeon hash[32].
 */
export function canonicalChallengeBytes(registry: RegistryContext, challengeId: bigint, dungeonHash: Uint8Array): Uint8Array {
  const context = registryBytes(registry)
  assertChallengeId(challengeId)
  if (dungeonHash.length !== 32) throw new CanonicalIdentityError('Dungeon hash must be exactly 32 bytes')
  return concat(CHALLENGE_MAGIC, Uint8Array.of(CANONICAL_SHARE_VERSION), context, u64be(challengeId), dungeonHash)
}

/** SHA-256(domain || canonicalChallengeBytes). */
export async function canonicalChallengeHash(input: CanonicalShareInput): Promise<Uint8Array> {
  if (input.challengeId === null || input.challengeId === undefined) throw new CanonicalIdentityError('Challenge identity requires a challenge id')
  const dungeonHash = await canonicalDungeonHash(input.dungeon)
  return sha256(concat(CHALLENGE_DOMAIN, canonicalChallengeBytes(input.registry, input.challengeId, dungeonHash)))
}

export async function canonicalChallengeHashHex(input: CanonicalShareInput): Promise<string> {
  return bytesToHex(await canonicalChallengeHash(input))
}

/**
 * New identity share code. This does not replace legacy TR1 Arc share codes.
 *
 * Binary envelope order:
 * magic[4], version u8, kind u8 (0 dungeon, 1 challenge), registry context,
 * canonical dungeon bytes[92], and challenge id u64-be only for kind 1.
 */
export function encodeCanonicalShareCode(input: CanonicalShareInput): string {
  const challengeId = input.challengeId ?? null
  if (challengeId !== null) assertChallengeId(challengeId)
  const payload = concat(
    SHARE_MAGIC,
    Uint8Array.of(CANONICAL_SHARE_VERSION, challengeId === null ? 0 : 1),
    registryBytes(input.registry),
    canonicalDungeonBytes(input.dungeon),
    challengeId === null ? new Uint8Array() : u64be(challengeId),
  )
  return `${CANONICAL_SHARE_PREFIX}${base64UrlEncode(payload)}`
}

export function decodeCanonicalShareCode(code: string): DecodedCanonicalShare {
  if (!code.startsWith(CANONICAL_SHARE_PREFIX)) throw new CanonicalIdentityError(`Expected ${CANONICAL_SHARE_PREFIX} share code`)
  const encoded = code.slice(CANONICAL_SHARE_PREFIX.length)
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new CanonicalIdentityError('Share payload is not canonical base64url')
  const bytes = base64UrlDecode(encoded)
  if (base64UrlEncode(bytes) !== encoded) throw new CanonicalIdentityError('Share payload is not canonical base64url')

  const r = new ByteReader(bytes)
  r.expect(SHARE_MAGIC, 'share magic')
  const version = r.u8()
  if (version !== CANONICAL_SHARE_VERSION) throw new CanonicalIdentityError(`Unsupported share version ${version}`)
  const kind = r.u8()
  if (kind !== 0 && kind !== 1) throw new CanonicalIdentityError(`Unknown share kind ${kind}`)
  const registry = readRegistry(r)
  const dungeonBytes = r.take(11 + CELL_COUNT)
  const dungeon = decodeDungeonBytes(dungeonBytes)
  const challengeId = kind === 1 ? r.u64() : null
  if (challengeId !== null) assertChallengeId(challengeId)
  if (!r.done()) throw new CanonicalIdentityError('Share code has trailing bytes')
  return { version: CANONICAL_SHARE_VERSION, dungeon, registry, challengeId }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new CanonicalIdentityError('Hex must be lowercase, non-empty, and byte-aligned')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function decodeDungeonBytes(bytes: Uint8Array): { cells: CellType[]; start: Point; exit: Point } {
  if (bytes.length !== 11 + CELL_COUNT) throw new CanonicalIdentityError('Canonical dungeon byte length is invalid')
  const r = new ByteReader(bytes)
  r.expect(DUNGEON_MAGIC, 'dungeon magic')
  const version = r.u8()
  if (version !== CANONICAL_DUNGEON_VERSION) throw new CanonicalIdentityError(`Unsupported dungeon identity version ${version}`)
  const width = r.u8()
  const height = r.u8()
  if (width !== GRID || height !== GRID) throw new CanonicalIdentityError(`Dungeon dimensions must be ${GRID} by ${GRID}`)
  const start = { x: r.u8(), y: r.u8() }
  const exit = { x: r.u8(), y: r.u8() }
  const cells = Array.from(r.take(CELL_COUNT), (code) => {
    const tile = TILE_FROM_CODE[code]
    if (!tile) throw new CanonicalIdentityError(`Unknown canonical tile code ${code}`)
    return tile
  })
  const dungeon = { cells, start, exit }
  assertDungeon(dungeon)
  return dungeon
}

function assertDungeon(input: CanonicalDungeonInput): void {
  if (input.cells.length !== CELL_COUNT) throw new CanonicalIdentityError(`Dungeon must contain exactly ${CELL_COUNT} row-major cells`)
  assertPoint(input.start, 'Start')
  assertPoint(input.exit, 'Exit')
  if (input.start.x === input.exit.x && input.start.y === input.exit.y) throw new CanonicalIdentityError('Start and exit must be different cells')
  input.cells.forEach((tile, i) => {
    if (!Object.prototype.hasOwnProperty.call(CANONICAL_TILE_CODES, tile)) throw new CanonicalIdentityError(`Unknown tile at cell ${i}`)
  })
  if (input.cells[idx(input.start.x, input.start.y)] !== 'empty') throw new CanonicalIdentityError('Start cell must be empty')
  if (input.cells[idx(input.exit.x, input.exit.y)] !== 'empty') throw new CanonicalIdentityError('Exit cell must be empty')
}

function assertPoint(point: Point, label: string): void {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) throw new CanonicalIdentityError(`${label} coordinates must be integers`)
  if (point.x < 0 || point.y < 0 || point.x >= GRID || point.y >= GRID) throw new CanonicalIdentityError(`${label} coordinates must be between 0 and ${GRID - 1}`)
}

function assertChallengeId(id: bigint): void {
  if (typeof id !== 'bigint' || id <= 0n || id > MAX_U64) throw new CanonicalIdentityError('Challenge id must be an unsigned 64-bit integer greater than zero')
}

function registryBytes(context: RegistryContext): Uint8Array {
  const chain = identifierBytes(context.chain, 'Chain', 32)
  const network = identifierBytes(context.network, 'Network', 32)
  const registry = identifierBytes(context.registry, 'Registry contract', 128)
  return concat(Uint8Array.of(chain.length), chain, Uint8Array.of(network.length), network, u16be(registry.length), registry)
}

function readRegistry(r: ByteReader): RegistryContext {
  const chain = decodeIdentifier(r.take(r.u8()), 'Chain', 32)
  const network = decodeIdentifier(r.take(r.u8()), 'Network', 32)
  const registry = decodeIdentifier(r.take(r.u16()), 'Registry contract', 128)
  return { chain, network, registry }
}

function identifierBytes(value: string, label: string, maxBytes: number): Uint8Array {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]*$/.test(value)) {
    throw new CanonicalIdentityError(`${label} must be lowercase ASCII using a-z, 0-9, dot, underscore, colon, or hyphen`)
  }
  const bytes = ascii(value)
  if (bytes.length > maxBytes) throw new CanonicalIdentityError(`${label} must be at most ${maxBytes} bytes`)
  return bytes
}

function decodeIdentifier(bytes: Uint8Array, label: string, maxBytes: number): string {
  let value = ''
  for (const byte of bytes) {
    if (byte > 0x7f) throw new CanonicalIdentityError(`${label} contains non-ASCII bytes`)
    value += String.fromCharCode(byte)
  }
  identifierBytes(value, label, maxBytes)
  return value
}

function ascii(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code > 0x7f) throw new CanonicalIdentityError('Canonical protocol constants must be ASCII')
    out[i] = code
  }
  return out
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u16be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new CanonicalIdentityError('Value does not fit u16')
  return Uint8Array.of(value >>> 8, value & 0xff)
}

function u64be(value: bigint): Uint8Array {
  const out = new Uint8Array(8)
  let remaining = value
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return out
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer)
  return new Uint8Array(digest)
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function base64UrlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const hasB = i + 1 < bytes.length
    const hasC = i + 2 < bytes.length
    const b = hasB ? bytes[i + 1] : 0
    const c = hasC ? bytes[i + 2] : 0
    out += BASE64URL[a >>> 2]
    out += BASE64URL[((a & 3) << 4) | (b >>> 4)]
    if (hasB) out += BASE64URL[((b & 15) << 2) | (c >>> 6)]
    if (hasC) out += BASE64URL[c & 63]
  }
  return out
}

function base64UrlDecode(value: string): Uint8Array {
  if (value.length % 4 === 1) throw new CanonicalIdentityError('Invalid base64url length')
  const bytes: number[] = []
  for (let i = 0; i < value.length; i += 4) {
    const chars = value.slice(i, i + 4)
    const values = Array.from(chars, (char) => {
      const n = BASE64URL.indexOf(char)
      if (n < 0) throw new CanonicalIdentityError('Invalid base64url character')
      return n
    })
    bytes.push((values[0] << 2) | (values[1] >>> 4))
    if (values.length >= 3) bytes.push(((values[1] & 15) << 4) | (values[2] >>> 2))
    if (values.length === 4) bytes.push(((values[2] & 3) << 6) | values[3])
  }
  return Uint8Array.from(bytes)
}

class ByteReader {
  private offset = 0
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  take(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) throw new CanonicalIdentityError('Share code ended unexpectedly')
    const out = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return out
  }

  u8(): number {
    return this.take(1)[0]
  }

  u16(): number {
    const bytes = this.take(2)
    return (bytes[0] << 8) | bytes[1]
  }

  u64(): bigint {
    let value = 0n
    for (const byte of this.take(8)) value = (value << 8n) | BigInt(byte)
    return value
  }

  expect(expected: Uint8Array, label: string): void {
    const actual = this.take(expected.length)
    if (!actual.every((byte, i) => byte === expected[i])) throw new CanonicalIdentityError(`Invalid ${label}`)
  }

  done(): boolean {
    return this.offset === this.bytes.length
  }
}
