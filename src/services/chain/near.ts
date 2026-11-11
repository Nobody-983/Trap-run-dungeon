import { NearRegistryRpcTransport } from './nearTransport'
import { createNearRegistryService, type NearRegistryService } from './nearService'
import { NearWalletProvider } from './nearWallet'

export { NEAR_CONFIG, NEAR_NETWORK_LABEL, nearTxUrl } from './nearConfig'
export { NearRegistryRpcTransport } from './nearTransport'
export { NearWalletProvider } from './nearWallet'
export { createNearRegistryService } from './nearService'
export {
  buildGetChallengeCall,
  buildGetChallengesByCreatorCall,
  buildRegisterChallengeCall,
  decodeNearRegistryChallenge,
  decodeNearRegistryChallengeList,
  verifyNearRegistryChallenge,
} from './nearRegistry'
export type { NearRegistryService, NearRegistration } from './nearService'
export type {
  NearChallengeVerification,
  NearRegistryChallenge,
  NearRegistryChangeCall,
  NearRegistryTransport,
  NearRegistryViewCall,
} from './nearRegistry'
export type { NearSession, NearTransactionPhase } from './nearWallet'

export interface NearServices {
  wallet: NearWalletProvider
  registry: NearRegistryService
}

export function createNearServices(): NearServices {
  const wallet = new NearWalletProvider()
  const registry = createNearRegistryService(wallet, new NearRegistryRpcTransport())
  return { wallet, registry }
}

export const nearServices = createNearServices()
