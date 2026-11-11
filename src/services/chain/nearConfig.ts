/** NEAR pilot configuration. Mainnet is intentionally unsupported. */

export type NearNetwork = 'testnet'

export interface NearConfig {
  network: NearNetwork
  rpcUrl: string
  walletUrl: string
  explorerUrl: string
  registryAccountId: string
  configured: boolean
  /** Conservative storage deposit; the registry refunds the measured excess. */
  storageDepositYocto: bigint
  gas: bigint
}

const RAW_NETWORK = String(import.meta.env.VITE_NEAR_NETWORK ?? 'testnet').trim().toLowerCase()
const RAW_RPC = String(import.meta.env.VITE_NEAR_RPC_URL ?? '').trim()
const RAW_REGISTRY = String(import.meta.env.VITE_NEAR_REGISTRY_ACCOUNT ?? '').trim()
const RAW_DEPOSIT = String(import.meta.env.VITE_NEAR_STORAGE_DEPOSIT_YOCTO ?? '').trim()

function assertTestnet(value: string): NearNetwork {
  if (value !== 'testnet') throw new Error('The NEAR pilot is testnet-only. VITE_NEAR_NETWORK must be "testnet".')
  return value
}

export function assertNearAccountId(value: string, label = 'NEAR account ID'): string {
  if (value.length < 2 || value.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)) {
    throw new Error(`${label} is invalid: "${value}"`)
  }
  return value
}

function storageDeposit(value: string): bigint {
  if (!value) return 10_000_000_000_000_000_000_000n // 0.01 NEAR
  if (!/^[1-9]\d*$/.test(value)) throw new Error('VITE_NEAR_STORAGE_DEPOSIT_YOCTO must be a positive yoctoNEAR integer')
  return BigInt(value)
}

export const NEAR_CONFIG: NearConfig = (() => {
  const registryAccountId = RAW_REGISTRY ? assertNearAccountId(RAW_REGISTRY, 'VITE_NEAR_REGISTRY_ACCOUNT') : ''
  return Object.freeze({
    network: assertTestnet(RAW_NETWORK || 'testnet'),
    rpcUrl: RAW_RPC || 'https://rpc.testnet.near.org',
    walletUrl: 'https://testnet.mynearwallet.com',
    explorerUrl: 'https://testnet.nearblocks.io',
    registryAccountId,
    configured: registryAccountId.length > 0,
    storageDepositYocto: storageDeposit(RAW_DEPOSIT),
    gas: 30_000_000_000_000n,
  })
})()

export function assertNearConfigured(): void {
  if (!NEAR_CONFIG.configured) throw new Error('NEAR registry is not configured. Set VITE_NEAR_REGISTRY_ACCOUNT for testnet.')
}

export const NEAR_NETWORK = NEAR_CONFIG.network
export const NEAR_NETWORK_LABEL = 'NEAR Testnet'
export const NEAR_IS_MAINNET = false

export function nearTxUrl(hash: string): string {
  return `${NEAR_CONFIG.explorerUrl}/txns/${encodeURIComponent(hash)}`
}

/** Convert SDK/RPC failures into concise user-facing messages without exposing raw payloads. */
export function formatNearError(error: unknown, fallback = 'NEAR request failed'): string {
  if (!(error instanceof Error)) return fallback
  const message = error.message
  const normalized = message.toLowerCase()
  if (normalized.includes('reject') || normalized.includes('denied') || normalized.includes('closed') || normalized.includes('cancel')) {
    return 'Wallet approval was cancelled. No challenge was registered.'
  }
  if (normalized.includes('insufficient') || normalized.includes('not enough balance') || normalized.includes('lackbalance')) {
    return 'Insufficient testnet NEAR for the storage deposit and gas.'
  }
  if (normalized.includes('storage deposit') || normalized.includes('attached')) {
    return 'The attached storage deposit was too small. Increase VITE_NEAR_STORAGE_DEPOSIT_YOCTO and retry.'
  }
  if (normalized.includes('does not exist') || normalized.includes('unknown account') || normalized.includes('contract code')) {
    return 'The configured registry contract was not found on NEAR testnet.'
  }
  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('timeout') || normalized.includes('connection')) {
    return 'Could not reach NEAR testnet. Check the RPC configuration and connection.'
  }
  return message || fallback
}
