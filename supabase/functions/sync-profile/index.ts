// Supabase Edge Function: sync-profile
// Cryptographically authenticates NEAR wallet signatures via standard NEP-413
// Enforces atomic nonce consumption, FastNear RPC key verification, and server-side economy authorization

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ed25519 } from 'https://esm.sh/@noble/curves@1.4.0/ed25519'

interface SyncProfileRequest {
  nearAccountId: string
  publicKey: string
  signature: string
  nonce: string
  message: string
  recipient: string
  callbackUrl?: string
  timestamp?: number
  profile: {
    displayName?: string
    xp?: number
    coins?: number
    economyLedger?: Array<Record<string, unknown>>
    inventory?: Record<string, unknown>
    equipped?: Record<string, unknown>
    unlocked?: string[]
    stats?: Record<string, unknown>
    streak?: Record<string, unknown>
    bests?: Record<string, unknown>
    clears?: Record<string, number>
  }
}

const FASTNEAR_RPC = 'https://rpc.testnet.fastnear.com'
const MAX_TIME_DRIFT_MS = 300_000 // 5 minutes

function base58Decode(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const ALPHABET_MAP = new Map<string, number>()
  for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP.set(ALPHABET[i], i)

  let num = 0n
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const val = ALPHABET_MAP.get(char)
    if (val === undefined) throw new Error(`Invalid Base58 character: ${char}`)
    num = num * 58n + BigInt(val)
  }

  const bytes: number[] = []
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn))
    num >>= 8n
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.unshift(0)
  }
  return new Uint8Array(bytes)
}

function hexOrBase64ToBytes(str: string): Uint8Array {
  const clean = str.trim()
  if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) {
    const bytes = new Uint8Array(clean.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }
  // Try Base64
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Encodes payload into standard NEP-413 Borsh byte layout:
 * - tag: u32 = 2147484061 (little-endian)
 * - message: string (u32 length prefix + UTF-8 bytes)
 * - nonce: [u8; 32] (raw 32 bytes)
 * - recipient: string (u32 length prefix + UTF-8 bytes)
 * - callbackUrl: Option<string> (0x00 for None, 0x01 + u32 length prefix + UTF-8 bytes for Some)
 */
function encodeNep413Payload(params: {
  message: string
  nonce: Uint8Array
  recipient: string
  callbackUrl?: string
}): Uint8Array {
  const utf8 = new TextEncoder()
  const msgBytes = utf8.encode(params.message)
  const recBytes = utf8.encode(params.recipient)
  const cbBytes = params.callbackUrl ? utf8.encode(params.callbackUrl) : null

  if (params.nonce.length !== 32) {
    throw new Error(`NEP-413 nonce must be exactly 32 bytes, got ${params.nonce.length}`)
  }

  const totalLen =
    4 + // tag (u32)
    4 + msgBytes.length + // message (string)
    32 + // nonce ([u8; 32])
    4 + recBytes.length + // recipient (string)
    (cbBytes ? 1 + 4 + cbBytes.length : 1) // callbackUrl (Option<string>)

  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)

  let offset = 0
  // tag: u32 = 2147484061 (0x8000019d)
  view.setUint32(offset, 2147484061, true)
  offset += 4

  // message: string
  view.setUint32(offset, msgBytes.length, true)
  offset += 4
  buf.set(msgBytes, offset)
  offset += msgBytes.length

  // nonce: [u8; 32]
  buf.set(params.nonce, offset)
  offset += 32

  // recipient: string
  view.setUint32(offset, recBytes.length, true)
  offset += 4
  buf.set(recBytes, offset)
  offset += recBytes.length

  // callbackUrl: Option<string>
  if (cbBytes) {
    buf[offset] = 1
    offset += 1
    view.setUint32(offset, cbBytes.length, true)
    offset += 4
    buf.set(cbBytes, offset)
    offset += cbBytes.length
  } else {
    buf[offset] = 0
    offset += 1
  }

  return buf
}

/**
 * Server-side economy reconciliation & sanitization:
 * - Never trusts client-supplied balance.
 * - Enforces single starter credit (max 50 coins).
 * - Enforces per-run reward ceiling (max 180 coins per clear).
 * - Deduplicates transactions by idempotent ID.
 * - Protects cloud debit transactions from being deleted by stale devices.
 */
function sanitizeAndReconcileLedger(
  clientLedger: unknown,
  existingCloudLedger: unknown[],
): { reconciledCoins: number; sanitizedLedger: Array<Record<string, unknown>> } {
  const mergedMap = new Map<string, Record<string, unknown>>()

  // 1. Retain existing authoritative cloud transactions
  if (Array.isArray(existingCloudLedger)) {
    for (const tx of existingCloudLedger) {
      if (tx && typeof tx === 'object' && typeof (tx as any).id === 'string') {
        mergedMap.set((tx as any).id, tx as Record<string, unknown>)
      }
    }
  }

  // 2. Validate client-submitted transactions
  if (Array.isArray(clientLedger)) {
    let starterCount = 0
    for (const tx of mergedMap.values()) {
      if ((tx as any).category === 'starter') starterCount++
    }

    for (const rawTx of clientLedger) {
      if (!rawTx || typeof rawTx !== 'object') continue
      const tx = rawTx as Record<string, unknown>
      const id = typeof tx.id === 'string' ? tx.id : null
      const kind = tx.kind === 'credit' || tx.kind === 'debit' ? tx.kind : null
      const rawAmount = typeof tx.amount === 'number' && Number.isFinite(tx.amount) ? Math.floor(tx.amount) : 0
      const category = typeof tx.category === 'string' ? tx.category : 'other'
      const referenceId = typeof tx.referenceId === 'string' ? tx.referenceId : ''
      const createdAt = typeof tx.createdAt === 'number' ? tx.createdAt : Date.now()

      if (!id || !kind || rawAmount <= 0) continue

      // Deduplicate if already present
      if (mergedMap.has(id)) continue

      if (kind === 'credit') {
        if (category === 'starter') {
          // Exactly one starter grant of max 50 coins allowed
          if (starterCount > 0) continue
          const amount = Math.min(50, Math.max(0, rawAmount))
          mergedMap.set(id, { id, kind, amount, category, referenceId, createdAt })
          starterCount++
        } else if (category === 'run_reward') {
          // Run rewards cannot exceed max possible dungeon reward (180 coins)
          if (!id.startsWith('reward:')) continue
          const amount = Math.min(180, Math.max(0, rawAmount))
          mergedMap.set(id, { id, kind, amount, category, referenceId, createdAt })
        }
        // Unknown or arbitrary client credit categories are discarded
      } else if (kind === 'debit') {
        // Debits (spending): accept verified debits
        const amount = Math.min(1000, Math.max(0, rawAmount))
        mergedMap.set(id, { id, kind, amount, category, referenceId, createdAt })
      }
    }
  }

  // 3. Strictly calculate authoritative balance from ledger entries
  const allTxs = Array.from(mergedMap.values()).sort(
    (a, b) => Number((a as any).createdAt || 0) - Number((b as any).createdAt || 0),
  )

  let balance = 0
  for (const tx of allTxs) {
    const amt = Number((tx as any).amount) || 0
    if ((tx as any).kind === 'credit') {
      balance += amt
    } else if ((tx as any).kind === 'debit') {
      balance -= amt
    }
  }

  return {
    reconciledCoins: Math.max(0, balance),
    sanitizedLedger: allTxs,
  }
}

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
    const expectedRecipient =
      Deno.env.get('SYNC_RECIPIENT') ||
      Deno.env.get('NEAR_REGISTRY_CONTRACT') ||
      'traprun.testnet'

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase server environment is not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const body: SyncProfileRequest = await req.json()
    const {
      nearAccountId,
      publicKey,
      signature,
      nonce,
      message,
      recipient,
      callbackUrl,
      timestamp,
      profile,
    } = body

    if (
      !nearAccountId ||
      !publicKey ||
      !signature ||
      !nonce ||
      !message ||
      !recipient ||
      !profile
    ) {
      return new Response(
        JSON.stringify({ error: 'Missing required NEP-413 authentication or profile fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 1. Recipient Validation: prevent cross-app signature reuse
    const validRecipients = new Set([
      expectedRecipient,
      'traprun.testnet',
      'cjfammcpgqnidbvuggii.supabase.co',
      new URL(supabaseUrl).host,
    ])
    if (!validRecipients.has(recipient)) {
      return new Response(
        JSON.stringify({
          error: `Invalid signature recipient: expected one of [${Array.from(validRecipients).join(', ')}], got ${recipient}`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 2. Freshness Check: reject expired or future-dated timestamps
    const now = Date.now()
    let parsedTimestamp = typeof timestamp === 'number' ? timestamp : null
    if (!parsedTimestamp) {
      // Try to extract timestamp from message format (e.g. trap-run:sync:<account>:<timestamp>)
      const match = message.match(/:(\d{10,13})$/)
      if (match) parsedTimestamp = parseInt(match[1], 10)
    }

    if (parsedTimestamp && Math.abs(now - parsedTimestamp) > MAX_TIME_DRIFT_MS) {
      return new Response(
        JSON.stringify({ error: 'Authentication payload has expired (timestamp exceeds 5m tolerance)' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 3. Decode & validate cryptographic artifacts
    let rawNonce: Uint8Array
    try {
      rawNonce = hexOrBase64ToBytes(nonce)
      if (rawNonce.length !== 32) throw new Error('Nonce must be 32 bytes')
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Invalid NEP-413 nonce: ${err instanceof Error ? err.message : String(err)}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    let rawPublicKey: Uint8Array
    try {
      const cleanPk = publicKey.startsWith('ed25519:') ? publicKey.slice(8) : publicKey
      rawPublicKey = base58Decode(cleanPk)
      if (rawPublicKey.length !== 32) throw new Error('Public key must be 32 bytes')
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Invalid public key: ${err instanceof Error ? err.message : String(err)}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    let rawSignature: Uint8Array
    try {
      rawSignature = hexOrBase64ToBytes(signature)
      if (rawSignature.length !== 64) throw new Error('Ed25519 signature must be 64 bytes')
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Invalid signature: ${err instanceof Error ? err.message : String(err)}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 4. Verify Account Public Key via NEAR RPC
    const rpcRes = await fetch(FASTNEAR_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'view-access-keys',
        method: 'query',
        params: {
          request_type: 'view_access_key_list',
          finality: 'final',
          account_id: nearAccountId,
        },
      }),
    })

    if (!rpcRes.ok) {
      return new Response(
        JSON.stringify({ error: `NEAR RPC query failed with HTTP ${rpcRes.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const rpcJson = await rpcRes.json()
    if (rpcJson.error) {
      return new Response(
        JSON.stringify({ error: `Account public key verification failed: ${JSON.stringify(rpcJson.error)}` }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const accountKeys: string[] = (rpcJson.result?.keys || []).map((k: any) => k.public_key)
    if (!accountKeys.includes(publicKey)) {
      return new Response(
        JSON.stringify({ error: `Public key ${publicKey} is not an authorized key for account ${nearAccountId}` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 5. Verify Cryptographic NEP-413 Signature
    const borshPayload = encodeNep413Payload({
      message,
      nonce: rawNonce,
      recipient,
      callbackUrl,
    })
    const sha256Digest = new Uint8Array(await crypto.subtle.digest('SHA-256', borshPayload))
    const isValidSig = ed25519.verify(rawSignature, sha256Digest, rawPublicKey)

    if (!isValidSig) {
      return new Response(
        JSON.stringify({ error: 'Cryptographic NEP-413 signature verification failed' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 6. Atomic Nonce Consumption (Anti-Replay Protection)
    // Nonce insertion is attempted directly. Database primary key prevents reuse under concurrency.
    const cleanNonceStr = nonce.trim()
    const { error: nonceInsertError } = await supabase
      .from('auth_nonces')
      .insert({
        nonce: cleanNonceStr,
        near_account_id: nearAccountId.toLowerCase(),
        created_at: new Date().toISOString(),
      })

    if (nonceInsertError) {
      const isDuplicate =
        nonceInsertError.code === '23505' ||
        nonceInsertError.message?.toLowerCase().includes('duplicate') ||
        nonceInsertError.message?.toLowerCase().includes('unique') ||
        nonceInsertError.message?.toLowerCase().includes('auth_nonces_pkey')

      if (isDuplicate) {
        return new Response(
          JSON.stringify({ error: 'Replay attack detected: nonce has already been consumed' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ error: `Database error during nonce registration: ${nonceInsertError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Periodic nonce cleanup (non-fatal)
    try {
      await supabase.rpc('prune_expired_nonces')
    } catch {
      /* ignore cleanup error */
    }

    // 7. Cloud Economy Authorization & Anti-Cheat Sanitization
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('economy_ledger, xp, coins, bests, clears')
      .eq('near_account_id', nearAccountId.toLowerCase())
      .maybeSingle()

    const existingCloudLedger = Array.isArray(existingProfile?.economy_ledger)
      ? (existingProfile.economy_ledger as unknown[])
      : []

    const { reconciledCoins, sanitizedLedger } = sanitizeAndReconcileLedger(
      profile.economyLedger,
      existingCloudLedger,
    )

    const sanitizedXp = Math.max(
      Number(existingProfile?.xp || 0),
      Math.max(0, Math.min(10_000_000, Number(profile.xp || 0))),
    )

    // 8. Authoritative Upsert into public.profiles using service_role
    const updatedAt = new Date().toISOString()
    const { data: updatedProfile, error: upsertError } = await supabase
      .from('profiles')
      .upsert(
        {
          near_account_id: nearAccountId.toLowerCase(),
          display_name: profile.displayName || nearAccountId,
          xp: sanitizedXp,
          coins: reconciledCoins,
          economy_ledger: sanitizedLedger,
          inventory: profile.inventory || {},
          equipped: profile.equipped || {},
          unlocked: profile.unlocked || ['runner-default', 'trail-classic'],
          stats: profile.stats || {},
          streak: profile.streak || { current: 0, best: 0, last: null },
          bests: profile.bests || {},
          clears: profile.clears || {},
          updated_at: updatedAt,
        },
        { onConflict: 'near_account_id' },
      )
      .select()
      .single()

    if (upsertError) {
      return new Response(
        JSON.stringify({ error: `Database upsert failed: ${upsertError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Profile progression securely synchronized',
        profile: updatedProfile,
        authoritativeCoins: reconciledCoins,
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


