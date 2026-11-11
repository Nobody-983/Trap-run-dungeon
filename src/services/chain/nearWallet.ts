import {
  actionCreators,
  setupWalletSelector,
  type BrowserWallet,
  type FinalExecutionOutcome,
  type WalletSelector,
} from '@near-wallet-selector/core'
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet'
import { Buffer } from 'buffer'
import { JsonRpcProvider } from 'near-api-js'
import { NEAR_CONFIG, assertNearConfigured, formatNearError } from './nearConfig'
import type { NearRegistryChangeCall } from './nearRegistry'
import type { ChainId, NetworkKind, SignedMessage, WalletProvider, WalletSession, WalletStatus } from './types'

export type NearTransactionPhase = 'wallet-approval' | 'pending-finality'

export interface NearSession {
  accountId: string
  publicKey?: string
}

let selectorPromise: Promise<WalletSelector> | null = null

function createSelector(): Promise<WalletSelector> {
  selectorPromise ??= setupWalletSelector({
    network: {
      networkId: 'testnet',
      nodeUrl: NEAR_CONFIG.rpcUrl,
      helperUrl: 'https://helper.testnet.near.org',
      explorerUrl: NEAR_CONFIG.explorerUrl,
      indexerUrl: 'https://api.kitwallet.app',
    },
    modules: [setupMyNearWallet({ walletUrl: NEAR_CONFIG.walletUrl })],
    ...(NEAR_CONFIG.configured
      ? { createAccessKeyFor: { contractId: NEAR_CONFIG.registryAccountId, methodNames: ['register_challenge'] } }
      : {}),
  })
  return selectorPromise
}

export class NearWalletProvider implements WalletProvider {
  readonly chain: ChainId = 'near'
  readonly displayName = 'MyNearWallet · Testnet'
  readonly network: NetworkKind = 'testnet'
  private current: WalletStatus = 'disconnected'
  private session: NearSession | null = null
  private wallet: BrowserWallet | null = null
  private readonly provider = new JsonRpcProvider({ url: NEAR_CONFIG.rpcUrl })

  get status(): WalletStatus {
    return this.current
  }

  get accountId(): string | null {
    return this.session?.accountId ?? null
  }

  isAvailable(): boolean {
    return typeof window !== 'undefined'
  }

  /** Restore an existing selector session without opening a wallet window. */
  async restore(): Promise<WalletSession | null> {
    if (!NEAR_CONFIG.configured) return null
    try {
      await this.assertTestnetRpc()
      const selector = await createSelector()
      const state = selector.store.getState()
      const account = state.accounts.find((entry) => entry.active) ?? state.accounts[0]
      if (!state.selectedWalletId || !account) return null
      this.wallet = (await selector.wallet(state.selectedWalletId)) as BrowserWallet
      this.session = { accountId: account.accountId, publicKey: account.publicKey }
      this.current = 'connected'
      return this.getSession()
    } catch {
      this.current = 'disconnected'
      return null
    }
  }

  async connect(): Promise<WalletSession> {
    this.current = 'connecting'
    try {
      assertNearConfigured()
      await this.assertTestnetRpc()
      const selector = await createSelector()
      this.wallet = (await selector.wallet('my-near-wallet')) as BrowserWallet
      const accounts = await this.wallet.signIn({
        contractId: NEAR_CONFIG.registryAccountId,
        methodNames: ['register_challenge'],
        successUrl: window.location.href,
        failureUrl: window.location.href,
      })
      const account = accounts[0]
      if (!account) throw new Error('MyNearWallet did not return an account')
      selector.setActiveAccount(account.accountId)
      this.session = { accountId: account.accountId, publicKey: account.publicKey }
      this.current = 'connected'
      return this.getSession() as WalletSession
    } catch (error) {
      this.current = 'disconnected'
      throw new Error(formatNearError(error, 'Could not connect MyNearWallet'))
    }
  }

  async disconnect(): Promise<void> {
    try {
      const selector = await createSelector()
      const wallet = this.wallet ?? (await selector.wallet())
      await wallet.signOut()
    } finally {
      this.wallet = null
      this.session = null
      this.current = 'disconnected'
    }
  }

  getSession(): WalletSession | null {
    if (!this.session) return null
    return {
      mock: false,
      identity: {
        chain: 'near',
        network: 'testnet',
        accountId: this.session.accountId,
        verified: true,
        linkedAt: Date.now(),
      },
    }
  }

  async signMessage(message: string): Promise<SignedMessage> {
    assertNearConfigured()
    const wallet = await this.requireWallet()
    if (!wallet.signMessage || !this.session) throw new Error('This wallet cannot sign messages')
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
    const signed = await wallet.signMessage({ message, recipient: NEAR_CONFIG.registryAccountId, nonce })
    if (!signed) throw new Error('Message signing was cancelled')
    return {
      chain: 'near',
      accountId: signed.accountId,
      message,
      signature: signed.signature,
    }
  }

  async signAndSendRegistryCall(
    request: NearRegistryChangeCall,
    onPhase?: (phase: NearTransactionPhase) => void,
  ): Promise<FinalExecutionOutcome> {
    assertNearConfigured()
    if (request.contractId !== NEAR_CONFIG.registryAccountId) throw new Error('Registry account does not match the testnet configuration')
    const wallet = await this.requireWallet()
    const accountId = this.accountId
    if (!accountId) throw new Error('Connect MyNearWallet first')
    await this.assertTestnetRpc()
    onPhase?.('wallet-approval')
    const initial = await wallet.signAndSendTransaction({
      signerId: accountId,
      receiverId: request.contractId,
      actions: [actionCreators.functionCall(request.methodName, request.args, BigInt(request.gas), BigInt(request.deposit))],
      callbackUrl: window.location.href,
    })
    if (!initial) throw new Error('The wallet did not return a transaction')
    const hash = transactionHash(initial)
    onPhase?.('pending-finality')
    return (await this.provider.viewTransactionStatus({ txHash: hash, accountId, waitUntil: 'FINAL' })) as unknown as FinalExecutionOutcome
  }

  async assertTestnetRpc(): Promise<void> {
    const networkId = await this.provider.getNetworkId()
    if (networkId !== 'testnet') throw new Error(`Configured NEAR RPC is ${networkId}, expected testnet`)
  }

  private async requireWallet(): Promise<BrowserWallet> {
    if (this.wallet && this.session) return this.wallet
    const restored = await this.restore()
    if (!restored || !this.wallet) throw new Error('Connect MyNearWallet first')
    return this.wallet
  }
}

export function transactionHash(outcome: FinalExecutionOutcome): string {
  const transaction = outcome.transaction as { hash?: unknown } | undefined
  if (typeof transaction?.hash === 'string' && transaction.hash) return transaction.hash
  if (typeof outcome.transaction_outcome?.id === 'string' && outcome.transaction_outcome.id) return outcome.transaction_outcome.id
  throw new Error('Wallet response did not contain a transaction hash')
}

export function nearError(error: unknown, fallback?: string): string {
  return formatNearError(error, fallback)
}

export { NEAR_CONFIG }
