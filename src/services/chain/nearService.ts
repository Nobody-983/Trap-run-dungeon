import type { FinalExecutionOutcome } from '@near-wallet-selector/core'
import { canonicalDungeonHash, type CanonicalDungeonInput } from '../../game/canonicalIdentity'
import { NEAR_CONFIG, assertNearConfigured, formatNearError } from './nearConfig'
import {
  buildGetChallengeCall,
  buildGetChallengesByCreatorCall,
  buildRegisterChallengeCall,
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
    options?: { depositYocto?: bigint; onPhase?: (phase: NearTransactionPhase) => void },
  ): Promise<NearRegistration>
  getChallenge(challengeId: bigint): Promise<NearRegistryChallenge | null>
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
    getChallenge: (challengeId) => getChallenge(transport, challengeId),
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
  options?: { depositYocto?: bigint; onPhase?: (phase: NearTransactionPhase) => void },
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
      gasBurnt: totalGasBurnt(outcome).toString(),
    }
  } catch (error) {
    throw new Error(formatNearError(error, 'Challenge registration failed'))
  }
}

async function getChallenge(transport: NearRegistryTransport, challengeId: bigint): Promise<NearRegistryChallenge | null> {
  assertNearConfigured()
  const value = await transport.viewFunction<unknown>(buildGetChallengeCall(NEAR_CONFIG.registryAccountId, challengeId))
  return value === null ? null : decodeNearRegistryChallenge(value)
}

async function getChallengesByCreator(
  transport: NearRegistryTransport,
  creator: string,
  fromIndex = 0n,
  limit = 20,
): Promise<NearRegistryChallenge[]> {
  assertNearConfigured()
  const value = await transport.viewFunction<unknown>(
    buildGetChallengesByCreatorCall(NEAR_CONFIG.registryAccountId, creator, fromIndex, limit),
  )
  return decodeNearRegistryChallengeList(value)
}

function assertTransactionSuccess(outcome: FinalExecutionOutcome): void {
  const status = outcome.status
  if (typeof status === 'object' && status && 'SuccessValue' in status) return
  if (typeof status === 'object' && status && 'Failure' in status) {
    const failure = status.Failure as { error_message?: string }
    throw new Error(failure.error_message || 'NEAR transaction failed')
  }
  throw new Error(`NEAR transaction did not finalize successfully (${typeof status === 'string' ? status : 'unknown status'})`)
}

function decodeChallengeId(outcome: FinalExecutionOutcome): bigint {
  const status = outcome.status
  if (typeof status !== 'object' || !status || !('SuccessValue' in status) || typeof status.SuccessValue !== 'string') {
    throw new Error('Registry transaction did not return a challenge ID')
  }
  const decoded = new TextDecoder().decode(base64Bytes(status.SuccessValue))
  let value: unknown
  try {
    value = JSON.parse(decoded)
  } catch {
    value = decoded
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error('Registry returned a malformed challenge ID')
  const id = BigInt(value)
  if (id > (1n << 64n) - 1n) throw new Error('Registry returned a challenge ID outside u64')
  return id
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function totalGasBurnt(outcome: FinalExecutionOutcome): bigint {
  return [outcome.transaction_outcome, ...outcome.receipts_outcome].reduce(
    (sum, item) => sum + BigInt(item.outcome.gas_burnt),
    0n,
  )
}

export { NearRegistryRpcTransport, NearWalletProvider }
