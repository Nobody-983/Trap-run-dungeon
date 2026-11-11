import {
  CANONICAL_DUNGEON_VERSION,
  canonicalChallengeHashHex,
  canonicalDungeonHash,
  type CanonicalDungeonInput,
} from '../../game/canonicalIdentity.ts'

export const NEAR_REGISTER_CHALLENGE_GAS = 30_000_000_000_000n
export const NEAR_MAX_PAGE_LIMIT = 50
const MAX_U64 = (1n << 64n) - 1n

/** JSON shape returned by the registry. Rust U64 fields are decimal strings. */
export interface NearRegistryChallenge {
  challenge_id: string
  dungeon_hash: string
  creator: string
  schema_version: number
  registered_at_nanoseconds: string
  registered_at_block_height: string
  metadata?: string | null
}

export type NearRegistryChangeCall =
  | {
      contractId: string
      methodName: 'register_challenge'
      args: { dungeon_hash: string }
      gas: string
      deposit: string
    }
  | {
      contractId: string
      methodName: 'register_challenge_with_metadata'
      args: { dungeon_hash: string; metadata: string | null }
      gas: string
      deposit: string
    }
  | {
      contractId: string
      methodName: 'update_metadata'
      args: { challenge_id: string; metadata: string | null }
      gas: string
      deposit: string
    }

export type NearRegistryViewCall =
  | { contractId: string; methodName: 'get_challenge'; args: { challenge_id: string } }
  | { contractId: string; methodName: 'get_challenge_by_hash'; args: { dungeon_hash: string } }
  | { contractId: string; methodName: 'is_dungeon_registered'; args: { dungeon_hash: string } }
  | { contractId: string; methodName: 'verify_creator'; args: { challenge_id: string; account_id: string } }
  | { contractId: string; methodName: 'get_creator_challenge_count'; args: { creator: string } }
  | { contractId: string; methodName: 'get_challenge_count'; args: Record<string, never> }
  | {
      contractId: string
      methodName: 'get_challenges_by_creator'
      args: { creator: string; from_index: string; limit: number }
    }
  | { contractId: string; methodName: 'get_next_challenge_id'; args: Record<string, never> }

export interface NearRegistryTransport {
  viewFunction<T>(request: NearRegistryViewCall): Promise<T>
}

export interface NearChallengeVerification {
  valid: boolean
  reason?: string
  challengeIdentityHex?: string
}

export function buildRegisterChallengeCall(
  registryAccountId: string,
  dungeonHash: Uint8Array,
  storageDepositYocto: bigint,
  metadata?: string | null,
): NearRegistryChangeCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  if (dungeonHash.length !== 32) throw new Error('NEAR registry dungeon hash must be exactly 32 bytes')
  if (storageDepositYocto <= 0n) throw new Error('NEAR registry storage deposit must be positive')
  if (metadata !== undefined && metadata !== null) {
    if (metadata.length > 512) throw new Error('Metadata exceeds maximum length of 512 characters')
    return {
      contractId: registryAccountId,
      methodName: 'register_challenge_with_metadata',
      args: { dungeon_hash: bytesToBase64(dungeonHash), metadata },
      gas: NEAR_REGISTER_CHALLENGE_GAS.toString(),
      deposit: storageDepositYocto.toString(),
    }
  }
  return {
    contractId: registryAccountId,
    methodName: 'register_challenge',
    args: { dungeon_hash: bytesToBase64(dungeonHash) },
    gas: NEAR_REGISTER_CHALLENGE_GAS.toString(),
    deposit: storageDepositYocto.toString(),
  }
}

export function buildUpdateMetadataCall(
  registryAccountId: string,
  challengeId: bigint,
  metadata: string | null,
  depositYocto: bigint = 10_000_000_000_000_000_000_000n, // 0.01 NEAR buffer
): NearRegistryChangeCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  assertPositiveU64(challengeId, 'Challenge ID')
  if (metadata && metadata.length > 512) throw new Error('Metadata exceeds maximum length of 512 characters')
  return {
    contractId: registryAccountId,
    methodName: 'update_metadata',
    args: { challenge_id: challengeId.toString(), metadata },
    gas: NEAR_REGISTER_CHALLENGE_GAS.toString(),
    deposit: depositYocto.toString(),
  }
}

export function buildGetChallengeCall(registryAccountId: string, challengeId: bigint): NearRegistryViewCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  assertPositiveU64(challengeId, 'Challenge ID')
  return { contractId: registryAccountId, methodName: 'get_challenge', args: { challenge_id: challengeId.toString() } }
}

export function buildGetChallengeByHashCall(registryAccountId: string, dungeonHash: Uint8Array): NearRegistryViewCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  if (dungeonHash.length !== 32) throw new Error('NEAR registry dungeon hash must be exactly 32 bytes')
  return {
    contractId: registryAccountId,
    methodName: 'get_challenge_by_hash',
    args: { dungeon_hash: bytesToBase64(dungeonHash) },
  }
}

export function buildIsDungeonRegisteredCall(registryAccountId: string, dungeonHash: Uint8Array): NearRegistryViewCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  if (dungeonHash.length !== 32) throw new Error('NEAR registry dungeon hash must be exactly 32 bytes')
  return {
    contractId: registryAccountId,
    methodName: 'is_dungeon_registered',
    args: { dungeon_hash: bytesToBase64(dungeonHash) },
  }
}

export function buildVerifyCreatorCall(registryAccountId: string, challengeId: bigint, accountId: string): NearRegistryViewCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  assertPositiveU64(challengeId, 'Challenge ID')
  assertNearAccountId(accountId, 'Account ID')
  return {
    contractId: registryAccountId,
    methodName: 'verify_creator',
    args: { challenge_id: challengeId.toString(), account_id: accountId },
  }
}

export function buildGetChallengeCountCall(registryAccountId: string): NearRegistryViewCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  return { contractId: registryAccountId, methodName: 'get_challenge_count', args: {} }
}

export function buildGetChallengesByCreatorCall(
  registryAccountId: string,
  creator: string,
  fromIndex: bigint = 0n,
  limit = 20,
): NearRegistryViewCall {
  assertNearAccountId(registryAccountId, 'Registry account ID')
  assertNearAccountId(creator, 'Creator account ID')
  assertU64(fromIndex, 'Pagination index')
  if (!Number.isInteger(limit) || limit < 1 || limit > NEAR_MAX_PAGE_LIMIT) {
    throw new Error(`Pagination limit must be between 1 and ${NEAR_MAX_PAGE_LIMIT}`)
  }
  return {
    contractId: registryAccountId,
    methodName: 'get_challenges_by_creator',
    args: { creator, from_index: fromIndex.toString(), limit },
  }
}

export function decodeNearRegistryChallenge(value: unknown): NearRegistryChallenge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed registry challenge')
  const candidate = value as Record<string, unknown>
  const challengeId = decimalU64(candidate.challenge_id, 'challenge_id', true)
  const registeredAtNanoseconds = decimalU64(candidate.registered_at_nanoseconds, 'registered_at_nanoseconds')
  const registeredAtBlockHeight = decimalU64(candidate.registered_at_block_height, 'registered_at_block_height')
  if (candidate.schema_version !== CANONICAL_DUNGEON_VERSION) throw new Error('Unsupported dungeon schema version')
  if (typeof candidate.creator !== 'string') throw new Error('Malformed registry creator')
  assertNearAccountId(candidate.creator, 'Registry creator')
  if (typeof candidate.dungeon_hash !== 'string') throw new Error('Malformed registry dungeon hash')
  const hash = base64ToBytes(candidate.dungeon_hash)
  if (hash.length !== 32 || bytesToBase64(hash) !== candidate.dungeon_hash) throw new Error('Malformed registry dungeon hash')
  return {
    challenge_id: challengeId,
    dungeon_hash: candidate.dungeon_hash,
    creator: candidate.creator,
    schema_version: CANONICAL_DUNGEON_VERSION,
    registered_at_nanoseconds: registeredAtNanoseconds,
    registered_at_block_height: registeredAtBlockHeight,
    ...(typeof candidate.metadata === 'string' || candidate.metadata === null ? { metadata: candidate.metadata } : {}),
  }
}

export function decodeNearRegistryChallengeList(value: unknown): NearRegistryChallenge[] {
  if (!Array.isArray(value) || value.length > NEAR_MAX_PAGE_LIMIT) throw new Error('Malformed registry challenge page')
  return value.map(decodeNearRegistryChallenge)
}

/** Verify registry data against the actual decoded gameplay dungeon. */
export async function verifyNearRegistryChallenge(input: {
  dungeon: CanonicalDungeonInput
  challenge: NearRegistryChallenge
  network: string
  registryAccountId: string
  expectedCreator?: string
}): Promise<NearChallengeVerification> {
  const { dungeon, network, registryAccountId, expectedCreator } = input
  if (network !== 'testnet') return { valid: false, reason: 'Only NEAR testnet registrations are supported' }

  let challenge: NearRegistryChallenge
  try {
    challenge = decodeNearRegistryChallenge(input.challenge)
    assertNearAccountId(registryAccountId, 'Registry account ID')
  } catch {
    return { valid: false, reason: 'Malformed registry response' }
  }
  if (expectedCreator !== undefined && challenge.creator !== expectedCreator) {
    return { valid: false, reason: 'Creator account does not match' }
  }

  const storedHash = base64ToBytes(challenge.dungeon_hash)
  let localHash: Uint8Array
  try {
    localHash = await canonicalDungeonHash(dungeon)
  } catch {
    return { valid: false, reason: 'The shared dungeon is malformed' }
  }
  if (!equalBytes(localHash, storedHash)) {
    return { valid: false, reason: 'Registered dungeon hash does not match the shared dungeon' }
  }

  try {
    const challengeIdentityHex = await canonicalChallengeHashHex({
      dungeon,
      challengeId: BigInt(challenge.challenge_id),
      registry: { chain: 'near', network: 'testnet', registry: registryAccountId },
    })
    return { valid: true, challengeIdentityHex }
  } catch {
    return { valid: false, reason: 'Invalid NEAR registry context' }
  }
}

function decimalU64(value: unknown, label: string, positive = false): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Malformed ${label}`)
  const parsed = BigInt(value)
  if (parsed > MAX_U64 || (positive && parsed === 0n)) throw new Error(`Malformed ${label}`)
  return value
}

function assertPositiveU64(value: bigint, label: string): void {
  assertU64(value, label)
  if (value === 0n) throw new Error(`${label} must be greater than zero`)
}

function assertU64(value: bigint, label: string): void {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_U64) throw new Error(`${label} must fit an unsigned 64-bit integer`)
}

function assertNearAccountId(value: string, label: string): void {
  if (value.length < 2 || value.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Malformed base64')
  }
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}
