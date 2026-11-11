import type { FinalExecutionOutcome } from '@near-wallet-selector/core'
import { canonicalDungeonHash, type CanonicalDungeonInput } from '../../game/canonicalIdentity'
import { NEAR_CONFIG, assertNearConfigured, formatNearError } from './nearConfig'
import {
  buildGetChallengeCall,
  buildGetChallengeByHashCall,
  buildIsDungeonRegisteredCall,
  buildVerifyCreatorCall,
  buildGetChallengeCountCall,
  buildGetChallengesByCreatorCall,
  buildRegisterChallengeCall,
  buildUpdateMetadataCall,
  decodeNearRegistryChallenge,
  decodeNearRegistryChallengeList,
  verifyNearRegistryChallenge,
  type NearChallengeVerification,
  type NearRegistryChallenge,
  type NearRegistryTransport,
} from './nearRegistry'
import { NearRegistryRpcTransport } from './nearTransport'
import { NearWalletProvider, transactionHash, type NearTransactionPhase } from './nearWallet'

export interface NearRegistration {
  challenge: NearRegistryChallenge
  challengeId: bigint
  creator: string
  txHash: string
  gasBurnt: string
}

export interface NearRegistryService {
  readonly wallet: NearWalletProvider
  isConfigured(): Promise<boolean>
  registerChallenge(
    dungeon: CanonicalDungeonInput,
    options?: { depositYocto?: bigint; metadata?: string | null; onPhase?: (phase: NearTransactionPhase) => void },
  ): Promise<NearRegistration>
  updateMetadata(
    challengeId: bigint,
    metadata: string | null,
    options?: { depositYocto?: bigint; onPhase?: (phase: NearTransactionPhase) => void },
  ): Promise<{ txHash: string }>
  getChallenge(challengeId: bigint): Promise<NearRegistryChallenge | null>
  getChallengeByHash(dungeonHash: Uint8Array): Promise<NearRegistryChallenge | null>
  isDungeonRegistered(dungeonHash: Uint8Array): Promise<boolean>
  verifyCreator(challengeId: bigint, accountId: string): Promise<boolean>
  getChallengeCount(): Promise<bigint>
  getChallengesByCreator(creator: string, fromIndex?: bigint, limit?: number): Promise<NearRegistryChallenge[]>
  verifyChallenge(input: {
    dungeon: CanonicalDungeonInput
    challenge: NearRegistryChallenge
    expectedCreator?: string
  }): Promise<NearChallengeVerification>
}

export function createNearRegistryService(
  wallet: NearWalletProvider,
  transport: NearRegistryTransport = new NearRegistryRpcTransport(),
): NearRegistryService {
  return {
    wallet,
    async isConfigured() {
      if (!NEAR_CONFIG.configured) return false
      try {
        await transport.viewFunction({ contractId: NEAR_CONFIG.registryAccountId, methodName: 'get_next_challenge_id', args: {} })
        return true
      } catch {
        return false
      }
    },
    registerChallenge: (dungeon, options) => registerChallenge(wallet, transport, dungeon, options),
    updateMetadata: (challengeId, metadata, options) => updateMetadata(wallet, challengeId, metadata, options),
    getChallenge: (challengeId) => getChallenge(transport, challengeId),
    getChallengeByHash: (dungeonHash) => getChallengeByHash(transport, dungeonHash),
    isDungeonRegistered: (dungeonHash) => isDungeonRegistered(transport, dungeonHash),
    verifyCreator: (challengeId, accountId) => verifyCreator(transport, challengeId, accountId),
    getChallengeCount: () => getChallengeCount(transport),
    getChallengesByCreator: (creator, fromIndex, limit) => getChallengesByCreator(transport, creator, fromIndex, limit),
    verifyChallenge: ({ dungeon, challenge, expectedCreator }) =>
      verifyNearRegistryChallenge({
        dungeon,
        challenge,
        expectedCreator,
        network: 'testnet',
        registryAccountId: NEAR_CONFIG.registryAccountId,
      }),
  }
}

async function registerChallenge(
  wallet: NearWalletProvider,
  transport: NearRegistryTransport,
  dungeon: CanonicalDungeonInput,
  options?: { depositYocto?: bigint; metadata?: string | null; onPhase?: (phase: NearTransactionPhase) => void },
): Promise<NearRegistration> {
  assertNearConfigured()
  const creator = wallet.accountId
  if (!creator) throw new Error('Connect MyNearWallet first')
  try {
    const dungeonHash = await canonicalDungeonHash(dungeon)
    const request = buildRegisterChallengeCall(
      NEAR_CONFIG.registryAccountId,
      dungeonHash,
      options?.depositYocto ?? NEAR_CONFIG.storageDepositYocto,
      options?.metadata,
    )
    const outcome = await wallet.signAndSendRegistryCall(request, options?.onPhase)
    assertTransactionSuccess(outcome)
    const challengeId = decodeChallengeId(outcome)
    const challenge = await getChallenge(transport, challengeId)
    if (!challenge) throw new Error(`Challenge #${challengeId} was not found after the transaction finalized`)
    const verification = await verifyNearRegistryChallenge({
      dungeon,
      challenge,
      expectedCreator: creator,
      network: 'testnet',
      registryAccountId: NEAR_CONFIG.registryAccountId,
    })
    if (!verification.valid) throw new Error(verification.reason ?? 'The finalized registration could not be verified')
    return {
      challenge,
      challengeId,
      creator,
      txHash: transactionHash(outcome),
      gasBurnt: outcome.transaction_outcome.outcome.gas_burnt.toString(),
    }
  } catch (error) {
    throw new Error(formatNearError(error, 'Challenge registration failed'))
  }
}

async function updateMetadata(
  wallet: NearWalletProvider,
  challengeId: bigint,
  metadata: string | null,
  options?: { depositYocto?: bigint; onPhase?: (phase: NearTransactionPhase) => void },
): Promise<{ txHash: string }> {
  assertNearConfigured()
  const creator = wallet.accountId
  if (!creator) throw new Error('Connect MyNearWallet first')
  try {
    const request = buildUpdateMetadataCall(
      NEAR_CONFIG.registryAccountId,
      challengeId,
      metadata,
      options?.depositYocto,
    )
    const outcome = await wallet.signAndSendRegistryCall(request, options?.onPhase)
    assertTransactionSuccess(outcome)
    return { txHash: transactionHash(outcome) }
  } catch (error) {
    throw new Error(formatNearError(error, 'Metadata update failed'))
  }
}

async function getChallenge(transport: NearRegistryTransport, challengeId: bigint): Promise<NearRegistryChallenge | null> {
  assertNearConfigured()
  try {
    const response = await transport.viewFunction<unknown>(buildGetChallengeCall(NEAR_CONFIG.registryAccountId, challengeId))
    return response ? decodeNearRegistryChallenge(response) : null
  } catch (error) {
    throw new Error(formatNearError(error, `Could not retrieve challenge #${challengeId}`))
  }
}

async function getChallengeByHash(transport: NearRegistryTransport, dungeonHash: Uint8Array): Promise<NearRegistryChallenge | null> {
  assertNearConfigured()
  try {
    const response = await transport.viewFunction<unknown>(buildGetChallengeByHashCall(NEAR_CONFIG.registryAccountId, dungeonHash))
    return response ? decodeNearRegistryChallenge(response) : null
  } catch (error) {
    throw new Error(formatNearError(error, 'Could not retrieve challenge by dungeon hash'))
  }
}

async function isDungeonRegistered(transport: NearRegistryTransport, dungeonHash: Uint8Array): Promise<boolean> {
  assertNearConfigured()
  try {
    return await transport.viewFunction<boolean>(buildIsDungeonRegisteredCall(NEAR_CONFIG.registryAccountId, dungeonHash))
  } catch (error) {
    throw new Error(formatNearError(error, 'Could not check dungeon registration status'))
  }
}

async function verifyCreator(transport: NearRegistryTransport, challengeId: bigint, accountId: string): Promise<boolean> {
  assertNearConfigured()
  try {
    return await transport.viewFunction<boolean>(buildVerifyCreatorCall(NEAR_CONFIG.registryAccountId, challengeId, accountId))
  } catch (error) {
    throw new Error(formatNearError(error, 'Could not verify challenge creator'))
  }
}

async function getChallengeCount(transport: NearRegistryTransport): Promise<bigint> {
  assertNearConfigured()
  try {
    const response = await transport.viewFunction<string>(buildGetChallengeCountCall(NEAR_CONFIG.registryAccountId))
    return BigInt(response)
  } catch (error) {
    throw new Error(formatNearError(error, 'Could not retrieve challenge count'))
  }
}

async function getChallengesByCreator(
  transport: NearRegistryTransport,
  creator: string,
  fromIndex: bigint = 0n,
  limit = 20,
): Promise<NearRegistryChallenge[]> {
  assertNearConfigured()
  try {
    const response = await transport.viewFunction<unknown>(
      buildGetChallengesByCreatorCall(NEAR_CONFIG.registryAccountId, creator, fromIndex, limit),
    )
    return decodeNearRegistryChallengeList(response)
  } catch (error) {
    throw new Error(formatNearError(error, `Could not retrieve challenges for ${creator}`))
  }
}

function decodeChallengeId(outcome: FinalExecutionOutcome): bigint {
  const success = (outcome.status as { SuccessValue?: string }).SuccessValue
  if (!success) throw new Error('Transaction succeeded without returning a challenge ID')
  const raw: unknown = JSON.parse(Buffer.from(success, 'base64').toString('utf8'))
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw new Error('Malformed challenge ID in transaction receipt')
  return BigInt(raw)
}

function assertTransactionSuccess(outcome: FinalExecutionOutcome): void {
  const status = outcome.status
  if (typeof status === 'object' && 'Failure' in status) {
    throw new Error('Transaction execution failed on NEAR testnet')
  }
}
