import { JsonRpcProvider } from '@near-js/providers'
import { NEAR_CONFIG, formatNearError } from './nearConfig'
import type { NearRegistryTransport, NearRegistryViewCall } from './nearRegistry'

/** Finality-safe, read-only registry transport. Transactions always go through the wallet. */
export class NearRegistryRpcTransport implements NearRegistryTransport {
  private readonly provider: JsonRpcProvider
  private verifiedNetwork = false

  constructor(provider?: JsonRpcProvider) {
    this.provider = provider ?? new JsonRpcProvider({ url: NEAR_CONFIG.rpcUrl })
  }

  async viewFunction<T>(request: NearRegistryViewCall): Promise<T> {
    try {
      if (request.contractId !== NEAR_CONFIG.registryAccountId) throw new Error('Registry account does not match the testnet configuration')
      await this.assertTestnet()
      const result = await this.provider.callFunction(
        request.contractId,
        request.methodName,
        request.args,
        { finality: 'final' },
      )
      return (result ?? null) as T
    } catch (error) {
      throw new Error(formatNearError(error))
    }
  }

  private async assertTestnet(): Promise<void> {
    if (this.verifiedNetwork) return
    const networkId = await this.provider.getNetworkId()
    if (networkId !== 'testnet') throw new Error(`Configured NEAR RPC is ${networkId}, expected testnet`)
    this.verifiedNetwork = true
  }
}
