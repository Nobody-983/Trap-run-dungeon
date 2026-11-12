import { canonicalDungeonHashBase64, canonicalDungeonHashHex } from '@/game/canonicalIdentity'
import { encodeDungeon } from '@/game/codec'
import type { Dungeon } from '@/game/types'
import { NEAR_CONFIG } from './nearConfig'
import { getSupabaseClient, isSupabaseConfigured } from '@/services/supabase/client'
import type { DungeonRecord } from '@/services/supabase/types'

interface NearRpcAction {
  FunctionCall?: {
    method_name: string
    args: string
    deposit: string
    gas: number
  }
}

interface NearRpcReceiptOutcome {
  outcome?: {
    logs?: string[]
  }
}

interface NearRpcTxResult {
  transaction?: {
    signer_id?: string
    receiver_id?: string
    actions?: NearRpcAction[]
  }
  status?: {
    Failure?: unknown
    SuccessValue?: string
  }
  receipts_outcome?: NearRpcReceiptOutcome[]
}

interface NearRpcResponse {
  error?: unknown
  result?: NearRpcTxResult
}

export interface VerificationResult {
  verified: boolean
  challengeId?: string
  txHash: string
  signerId?: string
  contractId?: string
  depositYocto?: bigint
  error?: string
}

export interface PendingPublishSync {
  txHash: string
  creatorAccountId: string
  challengeId: string
  dungeon: Dungeon
  shareCode: string
  registeredAt: number
}

const PENDING_SYNC_KEY = 'trap-run:pending-publishing-sync:v1'
const MIN_PUBLISHING_DEPOSIT_YOCTO = 50_000_000_000_000_000_000_000n // 0.05 NEAR

/**
 * Independently queries the NEAR JSON-RPC provider to authoritatively verify
 * that a dungeon publishing transaction succeeded on-chain with the required deposit,
 * correct recipient contract, matching layout hash, and emitted event.
 */
export async function verifyNearPublishingTransaction(params: {
  txHash: string
  creatorAccountId: string
  expectedChallengeId: string
  dungeon: Dungeon
  rpcUrl?: string
  registryContractId?: string
}): Promise<VerificationResult> {
  const {
    txHash,
    creatorAccountId,
    expectedChallengeId,
    dungeon,
    rpcUrl = NEAR_CONFIG.rpcUrl,
    registryContractId = NEAR_CONFIG.registryAccountId,
  } = params

  try {
    const expectedHashBase64 = await canonicalDungeonHashBase64(dungeon)

    // Query NEAR JSON-RPC for full transaction outcome
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'verify-tx',
        method: 'tx',
        params: [txHash, creatorAccountId],
      }),
    })

    if (!res.ok) {
      return {
        verified: false,
        txHash,
        error: `NEAR RPC query returned HTTP status ${res.status}`,
      }
    }

    const data = (await res.json()) as NearRpcResponse
    if (data.error) {
      return {
        verified: false,
        txHash,
        error: `NEAR RPC error: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}`,
      }
    }

    const result = data.result
    if (!result) {
      return {
        verified: false,
        txHash,
        error: 'NEAR RPC returned empty transaction result',
      }
    }

    // 1. Verify Signer Account
    const signerId = result.transaction?.signer_id
    if (signerId !== creatorAccountId) {
      return {
        verified: false,
        txHash,
        signerId,
        error: `Transaction signer mismatch: expected "${creatorAccountId}", got "${signerId}"`,
      }
    }

    // 2. Verify Contract Recipient
    const receiverId = result.transaction?.receiver_id
    if (receiverId !== registryContractId) {
      return {
        verified: false,
        txHash,
        contractId: receiverId,
        error: `Transaction receiver mismatch: expected registry "${registryContractId}", got "${receiverId}"`,
      }
    }

    // 3. Verify Function Call Action & Attached Deposit
    const actions = result.transaction?.actions || []
    const funcCall = actions.find(
      (a: NearRpcAction) =>
        Boolean(a.FunctionCall) &&
        ['register_challenge', 'register_challenge_with_metadata', 'publish_dungeon'].includes(a.FunctionCall?.method_name ?? ''),
    )

    if (!funcCall?.FunctionCall) {
      return {
        verified: false,
        txHash,
        error: 'Transaction actions do not include a publish_dungeon or register_challenge method call',
      }
    }

    const attachedDeposit = BigInt(funcCall.FunctionCall.deposit || '0')
    if (attachedDeposit < MIN_PUBLISHING_DEPOSIT_YOCTO) {
      return {
        verified: false,
        txHash,
        depositYocto: attachedDeposit,
        error: `Attached deposit ${attachedDeposit} yoctoNEAR is below required 0.05 NEAR`,
      }
    }

    // 4. Verify Layout Hash passed in arguments
    const argsBase64 = funcCall.FunctionCall.args
    if (argsBase64) {
      try {
        const decodedArgs = JSON.parse(atob(argsBase64)) as { dungeon_hash?: string }
        if (decodedArgs.dungeon_hash && decodedArgs.dungeon_hash !== expectedHashBase64) {
          return {
            verified: false,
            txHash,
            error: `Dungeon layout hash mismatch: call passed "${decodedArgs.dungeon_hash}", expected "${expectedHashBase64}"`,
          }
        }
      } catch {
        /* ignore argument decode failure if binary args */
      }
    }

    // 5. Verify Successful Execution Status
    const status = result.status
    if (status?.Failure) {
      return {
        verified: false,
        txHash,
        error: `Transaction execution failed: ${JSON.stringify(status.Failure)}`,
      }
    }

    // 6. Extract and Verify NEP-297 Event Log
    const receiptOutcomes = result.receipts_outcome || []
    let extractedChallengeId: string | null = null

    for (const ro of receiptOutcomes) {
      const logs: string[] = ro.outcome?.logs || []
      for (const log of logs) {
        if (log.startsWith('EVENT_JSON:')) {
          try {
            const parsed = JSON.parse(log.slice(11)) as {
              standard?: string
              event?: string
              data?: Array<{ challenge_id?: string | number }>
            }
            if (
              parsed.standard === 'trap_run_registry' &&
              (parsed.event === 'challenge_registered' || parsed.event === 'dungeon_published')
            ) {
              const eventData = (parsed.data?.[0] as Record<string, unknown> | undefined)
              const id = eventData?.dungeon_id ?? eventData?.challenge_id
              if (typeof id === 'string' || typeof id === 'number') {
                extractedChallengeId = String(id)
              }
            }
          } catch {
            /* ignore parse errors in unformatted log lines */
          }
        }
      }
    }

    if (!extractedChallengeId) {
      // Fallback: check SuccessValue in status
      if (status?.SuccessValue) {
        try {
          const raw = atob(status.SuccessValue)
          const parsed = JSON.parse(raw) as string | number
          extractedChallengeId = String(parsed)
        } catch {
          /* ignore */
        }
      }
    }

    if (!extractedChallengeId || extractedChallengeId !== expectedChallengeId) {
      return {
        verified: false,
        txHash,
        error: `Challenge ID verification failed: expected "${expectedChallengeId}", extracted "${extractedChallengeId}"`,
      }
    }

    return {
      verified: true,
      challengeId: extractedChallengeId,
      txHash,
      signerId,
      contractId: receiverId,
      depositYocto: attachedDeposit,
    }
  } catch (cause) {
    return {
      verified: false,
      txHash,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

/**
 * Reconciles and synchronizes a verified publishing transaction with Supabase backend.
 * If Supabase is unreachable or unconfigured, it safely buffers the sync request
 * so the player never loses publication attribution or has to re-pay.
 */
export async function syncVerifiedPublishingToSupabase(item: PendingPublishSync): Promise<{
  synced: boolean
  record?: DungeonRecord
  error?: string
}> {
  const supabase = getSupabaseClient()
  if (!isSupabaseConfigured || !supabase) {
    savePendingSync(item)
    return { synced: false, error: 'Supabase is not configured; cached locally in pending sync queue' }
  }

  try {
    const hashHex = await canonicalDungeonHashHex(item.dungeon)
    const encoded = encodeDungeon(item.dungeon)
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('dungeons')
      .upsert(
        {
          creator_near_account: item.creatorAccountId,
          title: item.dungeon.name,
          description: item.dungeon.name,
          dungeon_hash: hashHex,
          canonical_format_version: 1,
          serialized_dungeon: encoded,
          grid_data: {
            cells: item.dungeon.cells,
            start: item.dungeon.start,
            exit: item.dungeon.exit,
          },
          par: item.dungeon.par ?? 20,
          difficulty: item.dungeon.difficulty ?? 1,
          status: 'published',
          near_registry_id: parseInt(item.challengeId, 10),
          on_chain_tx_hash: item.txHash,
          contract_account_id: NEAR_CONFIG.registryAccountId,
          on_chain_verified: true,
          on_chain_verified_at: now,
          updated_at: now,
        },
        { onConflict: 'dungeon_hash' },
      )
      .select()
      .single()

    if (error) {
      savePendingSync(item)
      return { synced: false, error: error.message }
    }

    // Success: remove from pending sync
    removePendingSync(item.txHash)
    return { synced: true, record: data as DungeonRecord }
  } catch (err) {
    savePendingSync(item)
    return { synced: false, error: err instanceof Error ? err.message : String(err) }
  }
}

let memoryPendingSyncs: PendingPublishSync[] = []

export function getPendingSyncs(): PendingPublishSync[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(PENDING_SYNC_KEY)
      if (!raw) return []
      return JSON.parse(raw) as PendingPublishSync[]
    }
    return memoryPendingSyncs
  } catch {
    return memoryPendingSyncs
  }
}

export function savePendingSync(item: PendingPublishSync): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const syncs = getPendingSyncs()
      const index = syncs.findIndex((s) => s.txHash === item.txHash)
      if (index >= 0) {
        syncs[index] = item
      } else {
        syncs.push(item)
      }
      localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(syncs))
      return
    }
  } catch {
    /* ignore storage errors */
  }
  const index = memoryPendingSyncs.findIndex((s) => s.txHash === item.txHash)
  if (index >= 0) {
    memoryPendingSyncs[index] = item
  } else {
    memoryPendingSyncs.push(item)
  }
}

export function removePendingSync(txHash: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const syncs = getPendingSyncs().filter((s) => s.txHash !== txHash)
      localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(syncs))
      return
    }
  } catch {
    /* ignore storage errors */
  }
  memoryPendingSyncs = memoryPendingSyncs.filter((s) => s.txHash !== txHash)
}
