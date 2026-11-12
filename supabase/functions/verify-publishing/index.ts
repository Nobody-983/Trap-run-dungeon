// Supabase Edge Function: verify-publishing
// Independent on-chain verification of NEAR Testnet dungeon publishing transactions

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface VerifyRequest {
  txHash: string
  creatorAccountId: string
  dungeonHashBase64: string
  expectedChallengeId: string
  dungeonRecord: {
    title: string
    description?: string
    difficulty: number
    par: number
    serializedDungeon: string
    gridData: any
    width?: number
    height?: number
  }
}

const REQUIRED_DEPOSIT_YOCTO = 50_000_000_000_000_000_000_000n // 0.05 NEAR
const FASTNEAR_RPC = 'https://rpc.testnet.fastnear.com'
const BASE58_TX_REGEX = /^[1-9A-HJ-NP-Za-km-z]{40,46}$/

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const registryContract =
      Deno.env.get('NEAR_REGISTRY_ACCOUNT') ||
      Deno.env.get('NEAR_REGISTRY_CONTRACT') ||
      'traprun-registry.testnet'

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase server environment is not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const body: VerifyRequest = await req.json()

    const { txHash, creatorAccountId, dungeonHashBase64, expectedChallengeId, dungeonRecord } = body
    if (!txHash || !creatorAccountId || !dungeonHashBase64 || !expectedChallengeId) {
      return new Response(
        JSON.stringify({ error: 'Missing required transaction verification fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Validate base58 tx hash format to reject forged or malformed strings early
    if (!BASE58_TX_REGEX.test(txHash)) {
      return new Response(
        JSON.stringify({ error: `Invalid NEAR transaction hash format: ${txHash}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 1. Check if this txHash has already been processed to prevent replay
    const { data: existingTx } = await supabase
      .from('dungeons')
      .select('id, near_registry_id')
      .eq('on_chain_tx_hash', txHash)
      .maybeSingle()

    if (existingTx) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Transaction already verified and registered',
          dungeonId: existingTx.id,
          challengeId: existingTx.near_registry_id,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 2. Query NEAR JSON-RPC for authoritative transaction status
    const rpcResponse = await fetch(FASTNEAR_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'verify-tx',
        method: 'tx',
        params: [txHash, creatorAccountId],
      }),
    })

    if (!rpcResponse.ok) {
      return new Response(
        JSON.stringify({ error: `NEAR RPC query failed with HTTP ${rpcResponse.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const rpcJson = await rpcResponse.json()
    if (rpcJson.error) {
      return new Response(
        JSON.stringify({ error: `NEAR RPC transaction lookup error: ${JSON.stringify(rpcJson.error)}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const tx = rpcJson.result

    // Verify overall transaction execution status (must NOT be a failure)
    if (tx?.status?.Failure) {
      return new Response(
        JSON.stringify({ error: `Transaction execution failed on-chain: ${JSON.stringify(tx.status.Failure)}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const receiptOutcomes = tx?.receipts_outcome || []
    for (const ro of receiptOutcomes) {
      if (ro?.outcome?.status?.Failure) {
        return new Response(
          JSON.stringify({ error: `Transaction receipt execution failed: ${JSON.stringify(ro.outcome.status.Failure)}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    const signerId = tx?.transaction?.signer_id
    const receiverId = tx?.transaction?.receiver_id

    // Check signer and receiver
    if (signerId !== creatorAccountId) {
      return new Response(
        JSON.stringify({ error: `Signer mismatch: expected ${creatorAccountId}, got ${signerId}` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }

    if (receiverId !== registryContract) {
      return new Response(
        JSON.stringify({ error: `Receiver mismatch: expected ${registryContract}, got ${receiverId}` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Check actions for function call with deposit
    const actions = tx?.transaction?.actions || []
    const funcCall = actions.find((a: any) => a.FunctionCall && ['register_challenge', 'register_challenge_with_metadata', 'publish_dungeon'].includes(a.FunctionCall.method_name))

    if (!funcCall) {
      return new Response(
        JSON.stringify({ error: 'Transaction does not contain a publish_dungeon or register_challenge function call' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Validate function call arguments match the submitted dungeon layout hash
    if (funcCall.FunctionCall.args) {
      try {
        const rawArgs = atob(funcCall.FunctionCall.args)
        const parsedArgs = JSON.parse(rawArgs)
        if (parsedArgs.dungeon_hash && parsedArgs.dungeon_hash !== dungeonHashBase64) {
          return new Response(
            JSON.stringify({
              error: `Layout hash mismatch in transaction arguments: expected ${dungeonHashBase64}, got ${parsedArgs.dungeon_hash}`,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }
      } catch {
        /* ignore decode issues if args are raw bytes */
      }
    }

    const depositYocto = BigInt(funcCall.FunctionCall.deposit || '0')
    if (depositYocto < REQUIRED_DEPOSIT_YOCTO) {
      return new Response(
        JSON.stringify({ error: `Insufficient attached deposit: required 0.05 NEAR, got ${depositYocto}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Verify NEP-297 event log
    let extractedChallengeId: string | null = null

    for (const ro of receiptOutcomes) {
      const logs: string[] = ro.outcome?.logs || []
      for (const log of logs) {
        if (log.startsWith('EVENT_JSON:')) {
          try {
            const parsed = JSON.parse(log.slice(11))
            if (
              parsed.standard === 'trap_run_registry' &&
              (parsed.event === 'challenge_registered' || parsed.event === 'dungeon_published')
            ) {
              const data = parsed.data?.[0]
              const id = data?.dungeon_id ?? data?.challenge_id
              if (id) {
                extractedChallengeId = String(id)
              }
            }
          } catch {
            /* ignore malformed log */
          }
        }
      }
    }

    if (!extractedChallengeId || extractedChallengeId !== expectedChallengeId) {
      return new Response(
        JSON.stringify({
          error: `Event log verification failed: expected challenge ID ${expectedChallengeId}, extracted ${extractedChallengeId}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Double check on-chain contract state via get_challenge view query
    try {
      const viewArgsBase64 = btoa(JSON.stringify({ challenge_id: extractedChallengeId, dungeon_id: extractedChallengeId }))
      const viewRes = await fetch(FASTNEAR_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'verify-view-state',
          method: 'query',
          params: {
            request_type: 'call_function',
            finality: 'final',
            account_id: registryContract,
            method_name: 'get_challenge',
            args_base64: viewArgsBase64,
          },
        }),
      })

      if (viewRes.ok) {
        const viewJson = await viewRes.json()
        if (viewJson.result?.result) {
          const bytes = new Uint8Array(viewJson.result.result)
          const text = new TextDecoder().decode(bytes)
          const challengeRecord = JSON.parse(text)
          if (challengeRecord) {
            if (challengeRecord.creator && challengeRecord.creator !== creatorAccountId) {
              return new Response(
                JSON.stringify({ error: `On-chain challenge creator mismatch: expected ${creatorAccountId}, got ${challengeRecord.creator}` }),
                { status: 403, headers: { 'Content-Type': 'application/json' } },
              )
            }
            if (challengeRecord.dungeon_hash && challengeRecord.dungeon_hash !== dungeonHashBase64) {
              return new Response(
                JSON.stringify({ error: `On-chain challenge hash mismatch: expected ${dungeonHashBase64}, got ${challengeRecord.dungeon_hash}` }),
                { status: 400, headers: { 'Content-Type': 'application/json' } },
              )
            }
          }
        }
      }
    } catch {
      /* contract view check is non-fatal if RPC query endpoint temporarily throttles */
    }

    // 3. Upsert verified record into public.dungeons
    const now = new Date().toISOString()
    const { data: inserted, error: insertError } = await supabase
      .from('dungeons')
      .upsert(
        {
          creator_near_account: creatorAccountId,
          title: dungeonRecord.title,
          description: dungeonRecord.description || null,
          dungeon_hash: dungeonHashBase64,
          canonical_format_version: 1,
          serialized_dungeon: dungeonRecord.serializedDungeon,
          grid_data: dungeonRecord.gridData,
          par: dungeonRecord.par,
          difficulty: dungeonRecord.difficulty,
          status: 'published',
          near_registry_id: parseInt(extractedChallengeId, 10),
          on_chain_tx_hash: txHash,
          contract_account_id: receiverId,
          on_chain_verified: true,
          on_chain_verified_at: now,
          updated_at: now,
        },
        { onConflict: 'dungeon_hash' },
      )
      .select()
      .single()

    if (insertError) {
      return new Response(
        JSON.stringify({ error: `Database insert failed: ${insertError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        dungeon: inserted,
        challengeId: extractedChallengeId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Internal error: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})

