import { NearWalletProvider, type NearSession } from '../nearWallet'

export { NearWalletProvider, type NearSession }

/** Factory used by the service registry. The adapter is lazy: it only builds the RPC
 * connection when first needed, so an app without a NEAR wallet installed still boots. */
export function createNearWallet() {
  return new NearWalletProvider()
}
