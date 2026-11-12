import {
  actionCreators,
  setupWalletSelector,
  type BrowserWallet,
  type FinalExecutionOutcome,
  type ModuleState,
  type WalletModuleFactory,
  type WalletSelector,
} from '@near-wallet-selector/core'
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet'
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet'
import { setupHereWallet } from '@near-wallet-selector/here-wallet'
import { setupHotWallet } from '@near-wallet-selector/hot-wallet'
import { setupNightly } from '@near-wallet-selector/nightly'
import { setupSender } from '@near-wallet-selector/sender'
import { setupModal, type WalletSelectorModal } from '@near-wallet-selector/modal-ui'
import '@near-wallet-selector/modal-ui/styles.css'
import { Buffer } from 'buffer'
import { JsonRpcProvider } from '@near-js/providers'
import { NEAR_CONFIG, assertNearConfigured, formatNearError } from './nearConfig'
import type { NearRegistryChangeCall } from './nearRegistry'
import type { ChainId, NetworkKind, SignedMessage, WalletProvider, WalletSession, WalletStatus } from './types'

export type NearTransactionPhase = 'wallet-approval' | 'pending-finality'

export interface NearSession {
  accountId: string
  publicKey?: string
  walletId?: string
}

let selectorPromise: Promise<WalletSelector> | null = null

function createSelector(): Promise<WalletSelector> {
  const isBrowser = typeof window !== 'undefined'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modules: Array<WalletModuleFactory<any>> = [
    setupMeteorWallet(),
    setupMyNearWallet({ walletUrl: NEAR_CONFIG.walletUrl }),
    setupHereWallet(),
    setupHotWallet(),
    setupNightly(),
  ]
  if (isBrowser) {
    modules.push(setupSender())
  }

  selectorPromise ??= setupWalletSelector({
    network: {
      networkId: 'testnet',
      nodeUrl: NEAR_CONFIG.rpcUrl,
      helperUrl: 'https://helper.testnet.near.org',
      explorerUrl: NEAR_CONFIG.explorerUrl,
      indexerUrl: 'https://api.kitwallet.app',
    },
    modules,
    ...(NEAR_CONFIG.configured
      ? { createAccessKeyFor: { contractId: NEAR_CONFIG.registryAccountId, methodNames: ['register_challenge'] } }
      : {}),
  })
  return selectorPromise
}

export class NearWalletProvider implements WalletProvider {
  readonly chain: ChainId = 'near'
  readonly network: NetworkKind = 'testnet'
  private current: WalletStatus = 'disconnected'
  private session: NearSession | null = null
  private wallet: BrowserWallet | null = null
  private modal: WalletSelectorModal | null = null
  private readonly provider = new JsonRpcProvider({ url: NEAR_CONFIG.rpcUrl })

  get status(): WalletStatus {
    return this.current
  }

  get accountId(): string | null {
    return this.session?.accountId ?? null
  }

  get walletId(): string | null {
    return this.session?.walletId ?? null
  }

  get displayName(): string {
    const id = this.session?.walletId
    if (id === 'meteor-wallet') return 'Meteor Wallet · Testnet'
    if (id === 'my-near-wallet') return 'MyNearWallet · Testnet'
    if (id === 'here-wallet') return 'HERE Wallet · Testnet'
    if (id === 'sender') return 'Sender · Testnet'
    if (id === 'nightly') return 'Nightly · Testnet'
    if (id === 'hot-wallet') return 'HOT Wallet · Testnet'
    return 'NEAR Testnet Wallet'
  }

  isAvailable(): boolean {
    return typeof window !== 'undefined'
  }

  async getAvailableWallets(): Promise<ModuleState[]> {
    const selector = await createSelector()
    return selector.store.getState().modules
  }

  private getModal(selector: WalletSelector): WalletSelectorModal {
    if (this.modal) return this.modal
    this.modal = setupModal(selector, {
      contractId: NEAR_CONFIG.configured ? NEAR_CONFIG.registryAccountId : undefined,
      methodNames: NEAR_CONFIG.configured ? ['register_challenge'] : undefined,
      theme: 'dark',
      description: 'Connect your NEAR wallet to explore and register dungeon challenges.',
    })
    return this.modal
  }

  /** Restore an existing selector session without opening a wallet window. */
  async restore(): Promise<WalletSession | null> {
    try {
      await this.assertTestnetRpc()
      const selector = await createSelector()
      const state = selector.store.getState()
      let account = state.accounts.find((entry) => entry.active) ?? state.accounts[0]
      const selectedWalletId = state.selectedWalletId

      if (!account && selectedWalletId) {
        try {
          const wallet = (await selector.wallet(selectedWalletId)) as BrowserWallet
          const accounts = await wallet.getAccounts()
          if (accounts.length > 0 && accounts[0]) {
            account = { accountId: accounts[0].accountId, publicKey: accounts[0].publicKey, active: true }
            selector.setActiveAccount(account.accountId)
          }
        } catch {
          // wallet accounts could not be read
        }
      }

      if (!selectedWalletId || !account) return null
      this.wallet = (await selector.wallet(selectedWalletId)) as BrowserWallet
      this.session = { accountId: account.accountId, publicKey: account.publicKey, walletId: selectedWalletId }
      this.current = 'connected'
      return this.getSession()
    } catch {
      this.current = 'disconnected'
      return null
    }
  }

  /** Connect to a specific wallet by ID or open the official wallet selector modal. */
  async connect(walletId?: string): Promise<WalletSession> {
    this.current = 'connecting'
    try {
      await this.assertTestnetRpc()
      const selector = await createSelector()

      // Programmatic direct connection if walletId specified
      if (walletId) {
        this.wallet = (await selector.wallet(walletId)) as BrowserWallet
        const accounts = await this.wallet.signIn({
          contractId: NEAR_CONFIG.configured ? NEAR_CONFIG.registryAccountId : undefined,
          methodNames: NEAR_CONFIG.configured ? ['register_challenge'] : undefined,
          successUrl: window.location.href,
          failureUrl: window.location.href,
        })
        const account = accounts[0]
        if (!account) throw new Error(`${walletId} did not return an account`)
        selector.setActiveAccount(account.accountId)
        this.session = { accountId: account.accountId, publicKey: account.publicKey, walletId }
        this.current = 'connected'
        return this.getSession() as WalletSession
      }

      // Default: open the official NEAR Wallet Selector Modal
      const modal = this.getModal(selector)
      return await new Promise<WalletSession>((resolve, reject) => {
        let completed = false

        const subscription = selector.store.observable.subscribe((state) => {
          const account = state.accounts.find((entry) => entry.active) ?? state.accounts[0]
          if (account && state.selectedWalletId && !completed) {
            completed = true
            subscription.unsubscribe()
            modal.hide()
            void (async () => {
              try {
                const walletId = state.selectedWalletId
                if (!walletId) throw new Error('No wallet ID returned from selector')
                this.wallet = (await selector.wallet(walletId)) as BrowserWallet
                this.session = { accountId: account.accountId, publicKey: account.publicKey, walletId }
                this.current = 'connected'
                resolve(this.getSession() as WalletSession)
              } catch (err) {
                this.current = 'disconnected'
                reject(err instanceof Error ? err : new Error(String(err)))
              }
            })()
          }
        })

        const hideHandler = modal.on('onHide', () => {
          hideHandler.remove()
          if (!completed) {
            subscription.unsubscribe()
            this.current = 'disconnected'
            reject(new Error('Wallet connection cancelled'))
          }
        })

        modal.show()
      })
    } catch (error) {
      this.current = 'disconnected'
      throw new Error(formatNearError(error, 'Could not connect NEAR wallet'))
    }
  }

  async disconnect(): Promise<void> {
    try {
      const selector = await createSelector()
      const wallet = this.wallet ?? (await selector.wallet().catch(() => null))
      await wallet?.signOut().catch(() => {})
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
    const rawNonce = crypto.getRandomValues(new Uint8Array(32))
    const nonce = Buffer.from(rawNonce)
    const recipient = NEAR_CONFIG.registryAccountId || 'traprun.testnet'
    const signed = await wallet.signMessage({ message, recipient, nonce })
    if (!signed) throw new Error('Message signing was cancelled')
    return {
      chain: 'near',
      accountId: signed.accountId,
      publicKey: signed.publicKey ?? this.session.publicKey,
      message,
      signature: signed.signature,
      nonce: nonce.toString('base64'),
      recipient,
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
    if (!accountId) throw new Error('Connect a NEAR wallet first')
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
    return await this.provider.viewTransactionStatus(hash, accountId, 'FINAL')
  }

  async assertTestnetRpc(): Promise<void> {
    try {
      const networkId = await this.provider.getNetworkId()
      if (networkId !== 'testnet') throw new Error(`Configured NEAR RPC is ${networkId}, expected testnet`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('expected testnet')) throw err
      throw new Error(`Unable to reach NEAR testnet RPC at ${NEAR_CONFIG.rpcUrl}. Check your internet connection or RPC endpoint.`)
    }
  }

  private async requireWallet(): Promise<BrowserWallet> {
    if (this.wallet && this.session) return this.wallet
    const restored = await this.restore()
    if (!restored || !this.wallet) throw new Error('Connect a NEAR wallet first')
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
