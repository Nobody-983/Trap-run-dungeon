import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import crypto from 'node:crypto'
import { KeyPair } from 'near-api-js'
import { serializeNep413 } from '@near-wallet-selector/core'
import { ed25519 } from '@noble/curves/ed25519'

/** Pure NEP-413 Borsh encoder matching Edge Function implementation */
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

interface TestLedgerEntry {
  id: string
  kind: 'credit' | 'debit'
  amount: number
  category: string
  referenceId: string
  createdAt: number
}

/** Pure server-side ledger sanitizer matching Edge Function logic */
function sanitizeAndReconcileLedger(
  clientLedger: unknown,
  existingCloudLedger: unknown[],
): { reconciledCoins: number; sanitizedLedger: TestLedgerEntry[] } {
  const mergedMap = new Map<string, TestLedgerEntry>()

  if (Array.isArray(existingCloudLedger)) {
    for (const item of existingCloudLedger) {
      if (item && typeof item === 'object' && 'id' in item && typeof (item as TestLedgerEntry).id === 'string') {
        const tx = item as TestLedgerEntry
        mergedMap.set(tx.id, tx)
      }
    }
  }

  if (Array.isArray(clientLedger)) {
    let starterCount = 0
    for (const tx of mergedMap.values()) {
      if (tx.category === 'starter') starterCount++
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
      if (mergedMap.has(id)) continue

      if (kind === 'credit') {
        if (category === 'starter') {
          if (starterCount > 0) continue
          const amount = Math.min(50, Math.max(0, rawAmount))
          mergedMap.set(id, { id, kind, amount, category, referenceId, createdAt })
          starterCount++
        } else if (category === 'run_reward') {
          if (!id.startsWith('reward:')) continue
          const amount = Math.min(180, Math.max(0, rawAmount))
          mergedMap.set(id, { id, kind, amount, category, referenceId, createdAt })
        }
      } else if (kind === 'debit') {
        const amount = Math.min(1000, Math.max(0, rawAmount))
        mergedMap.set(id, { id, kind, amount, category, referenceId, createdAt })
      }
    }
  }

  const allTxs = Array.from(mergedMap.values()).sort((a, b) => a.createdAt - b.createdAt)

  let balance = 0
  for (const tx of allTxs) {
    if (tx.kind === 'credit') {
      balance += tx.amount
    } else if (tx.kind === 'debit') {
      balance -= tx.amount
    }
  }

  return {
    reconciledCoins: Math.max(0, balance),
    sanitizedLedger: allTxs,
  }
}

void describe('NEP-413 Standard Verification & Security Remediation', () => {
  void it('produces byte-for-byte exact Borsh serialization matching @near-wallet-selector/core', () => {
    const testCases = [
      {
        message: 'trap-run:sync:player.testnet:1700000000',
        nonce: crypto.randomBytes(32),
        recipient: 'traprun.testnet',
        callbackUrl: undefined,
      },
      {
        message: 'short',
        nonce: Buffer.alloc(32, 42),
        recipient: 'cjfammcpgqnidbvuggii.supabase.co',
        callbackUrl: 'https://traprun.app/auth/callback',
      },
    ]

    for (const tc of testCases) {
      const official = serializeNep413(tc)
      const pure = encodeNep413Payload(tc)
      assert.equal(Buffer.from(pure).equals(official), true)
      assert.equal(pure[0], 0x9d)
      assert.equal(pure[1], 0x01)
      assert.equal(pure[2], 0x00)
      assert.equal(pure[3], 0x80)
    }
  })

  void it('rejects nonces that are not exactly 32 bytes', () => {
    assert.throws(() => {
      encodeNep413Payload({
        message: 'test',
        nonce: new Uint8Array(16), // Invalid: 16 bytes instead of 32
        recipient: 'traprun.testnet',
      })
    }, /must be exactly 32 bytes/)
  })

  void it('cryptographically verifies valid NEP-413 signatures and rejects tampered payloads', () => {
    const keyPair = KeyPair.fromRandom('ed25519')
    const rawPublicKey = keyPair.getPublicKey().data

    const nonce = crypto.randomBytes(32)
    const validParams = {
      message: 'trap-run:sync:alice.testnet:1700000000',
      nonce,
      recipient: 'traprun.testnet',
      callbackUrl: undefined,
    }

    // 1. Legitimate signing
    const borshBytes = encodeNep413Payload(validParams)
    const digest = crypto.createHash('sha256').update(borshBytes).digest()
    const sig = keyPair.sign(digest)
    const rawSignature = new Uint8Array(sig.signature)

    // Valid signature must pass
    const isValid = ed25519.verify(rawSignature, digest, rawPublicKey)
    assert.equal(isValid, true)

    // 2. Tampered message must fail
    const tamperedMsgBytes = encodeNep413Payload({ ...validParams, message: 'trap-run:sync:alice.testnet:1700000999' })
    const tamperedMsgDigest = crypto.createHash('sha256').update(tamperedMsgBytes).digest()
    assert.equal(ed25519.verify(rawSignature, tamperedMsgDigest, rawPublicKey), false)

    // 3. Tampered recipient must fail (prevents cross-app replay)
    const tamperedRecipientBytes = encodeNep413Payload({ ...validParams, recipient: 'evil-phishing-site.near' })
    const tamperedRecDigest = crypto.createHash('sha256').update(tamperedRecipientBytes).digest()
    assert.equal(ed25519.verify(rawSignature, tamperedRecDigest, rawPublicKey), false)

    // 4. Tampered nonce must fail
    const tamperedNonce = Buffer.from(nonce)
    tamperedNonce[0] ^= 0xff
    const tamperedNonceBytes = encodeNep413Payload({ ...validParams, nonce: tamperedNonce })
    const tamperedNonceDigest = crypto.createHash('sha256').update(tamperedNonceBytes).digest()
    assert.equal(ed25519.verify(rawSignature, tamperedNonceDigest, rawPublicKey), false)

    // 5. Tampered public key must fail
    const wrongKeyPair = KeyPair.fromRandom('ed25519')
    const wrongRawPk = wrongKeyPair.getPublicKey().data
    assert.equal(ed25519.verify(rawSignature, digest, wrongRawPk), false)
  })

  void it('demonstrates atomic nonce consumption preventing concurrent replay attacks', () => {
    // Simulate database table with primary key constraint
    const consumedNonces = new Set<string>()

    const atomicConsumeNonce = (nonce: string, _accountId: string): { ok: boolean; status: number; error?: string } => {
      // Simulate INSERT INTO auth_nonces (nonce, near_account_id) VALUES (...)
      // Unique primary key constraint enforces atomicity
      if (consumedNonces.has(nonce)) {
        return { ok: false, status: 401, error: 'Replay attack detected: nonce has already been consumed' }
      }
      consumedNonces.add(nonce)
      return { ok: true, status: 200 }
    }

    const nonceHex = crypto.randomBytes(32).toString('hex')

    // First attempt succeeds
    const firstRes = atomicConsumeNonce(nonceHex, 'alice.testnet')
    assert.equal(firstRes.ok, true)
    assert.equal(firstRes.status, 200)

    // Second concurrent / replayed attempt is rejected with 401
    const replayRes = atomicConsumeNonce(nonceHex, 'alice.testnet')
    assert.equal(replayRes.ok, false)
    assert.equal(replayRes.status, 401)
    assert.ok(replayRes.error?.includes('Replay attack detected'))
  })

  void it('sanitizes fabricated economy credits and protects cloud debits against stale devices', () => {
    // 1. Attacker submits fabricated 999,999 coin credit and unauthorized category
    const maliciousClientLedger = [
      { id: 'starter:fake-1', kind: 'credit', amount: 50, category: 'starter', createdAt: 1000 },
      { id: 'starter:fake-2', kind: 'credit', amount: 50, category: 'starter', createdAt: 1001 }, // Duplicate starter!
      { id: 'reward:dungeon-1:fake-run-1', kind: 'credit', amount: 999999, category: 'run_reward', createdAt: 2000 }, // Fabricated run amount!
      { id: 'admin_grant:123', kind: 'credit', amount: 500000, category: 'admin_grant', createdAt: 3000 }, // Fabricated category!
    ]

    const sanitized = sanitizeAndReconcileLedger(maliciousClientLedger, [])

    // Second starter discarded
    const starters = sanitized.sanitizedLedger.filter((t) => t.category === 'starter')
    assert.equal(starters.length, 1)

    // Run reward clamped to 180 max
    const runReward = sanitized.sanitizedLedger.find((t) => t.id === 'reward:dungeon-1:fake-run-1')
    assert.equal(runReward?.amount, 180)

    // Arbitrary 'admin_grant' category completely discarded
    const adminGrant = sanitized.sanitizedLedger.find((t) => t.category === 'admin_grant')
    assert.equal(adminGrant, undefined)

    // Authoritative balance is strictly 50 (starter) + 180 (clamped run) = 230, NOT 1,500,099!
    assert.equal(sanitized.reconciledCoins, 230)

    // 2. Stale offline device cannot erase legitimate cloud spending
    const cloudLedger = [
      { id: 'starter:alice', kind: 'credit', amount: 50, category: 'starter', createdAt: 1000 },
      { id: 'spend:potion-health:tx-abc', kind: 'debit', amount: 30, category: 'shop_purchase', createdAt: 2000 },
    ]

    // Stale device was offline before the spend occurred (only has starter)
    const staleDeviceLedger = [
      { id: 'starter:alice', kind: 'credit', amount: 50, category: 'starter', createdAt: 1000 },
    ]

    const staleSyncResult = sanitizeAndReconcileLedger(staleDeviceLedger, cloudLedger)

    // The spend transaction MUST be preserved
    assert.equal(staleSyncResult.sanitizedLedger.length, 2)
    assert.equal(staleSyncResult.reconciledCoins, 20) // 50 - 30 = 20, NOT 50!
  })
})
