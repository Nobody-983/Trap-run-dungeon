# TRAP//RUN — Application & Blockchain Security Report

**Audit Standards:** NEP-413 (Wallet Signatures), NEP-297 (Events), PostgreSQL Row Level Security (RLS), Borsh Binary Encoding  
**Security Scope:** Wallet Authentication, Nonce Lifecycle, Economy Ledger, Run Validation, Row-Level Database Security  
**Auditor Status:** Senior Application Security Engineer & NEAR Protocol Specialist  

---

## 1. NEP-413 Standard Wallet Authentication

### 1.1 Specification Conformance
The authentication system implemented in `supabase/functions/sync-profile/index.ts` strictly conforms to the official NEP-413 specification:
```text
tag: u32 = 2147484061 (0x8000019d, Little-Endian)
message: string (u32 length prefix + UTF-8 payload)
nonce: [u8; 32] (raw 32-byte sequence)
recipient: string (u32 length prefix + UTF-8 recipient domain)
callbackUrl: Option<string> (0x00 for None, 0x01 + u32 len + bytes for Some)
```

### 1.2 Cryptographic Verification Pipeline
1. **Payload Construction:** Borsh-serialized into a deterministic byte array.
2. **Digest Computation:** Evaluates `SHA-256(borsh_payload)`.
3. **Signature Verification:** Uses `@noble/curves/ed25519` to verify the 64-byte Ed25519 signature against the raw 32-byte public key.
4. **On-Chain Access Key Proof:** Live JSON-RPC call (`view_access_key_list`) to the NEAR network verifies that the public key is an authorized full-access or function-call key registered to `nearAccountId`.
5. **Domain Binding:** Validates that `recipient` matches the expected service domain (preventing cross-app replay).
6. **Freshness Window:** Rejects signatures whose embedded timestamp drifts by more than 5 minutes (`MAX_TIME_DRIFT_MS = 300,000`).

---

## 2. Anti-Replay Protection: Atomic Nonce Consumption

### 2.1 Threat Model
In high-concurrency environments, a naive `SELECT nonce WHERE nonce = ?` followed by `INSERT INTO auth_nonces` creates a race condition where two concurrent HTTP requests with the identical signed nonce can both succeed before either insert commits.

### 2.2 Mitigation Implementation
- The database table `auth_nonces` enforces a primary key constraint on `nonce`:
  ```sql
  CREATE TABLE IF NOT EXISTS auth_nonces (
      nonce TEXT PRIMARY KEY,
      near_account_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
  );
  ```
- In `sync-profile`, nonces are inserted directly in a single atomic transaction without prior read checks:
  ```typescript
  const { error: nonceInsertError } = await supabase
    .from('auth_nonces')
    .insert({ nonce: cleanNonceStr, near_account_id: nearAccountId.toLowerCase() });
  ```
- Any concurrent or subsequent request attempting to reuse the same nonce fails immediately with PostgreSQL unique violation error code `23505` and returns HTTP 401 Unauthorized.
- Automated tests in `scripts/nep413-auth.test.ts` prove concurrent duplicate requests are blocked with exactly 1 success and 1 rejection.

---

## 3. Server-Side Progression & Economy Trust Model

### 3.1 Trust Boundaries
- **Client Sandbox:** The browser game engine executes moves offline, runs collision checks, and tracks local health and inventory.
- **Server Authority:** The cloud database and Edge Functions **never** accept client-submitted coin balances or unverifiable score claims.

### 3.2 Ledger Sanitization (`sanitizeAndReconcileLedger`)
- **Monotonic Identity:** Every economy event carries a unique, idempotent ID (e.g., `reward:dungeon-123:attempt-456`).
- **Starter Grant Ceiling:** At most one starter credit of max 50 coins is permitted per account.
- **Run Reward Ceiling:** Dungeon clear rewards are capped at the maximum theoretical level reward (180 coins) and require a valid `reward:` prefix.
- **Authoritative Balance Calculation:** Spendable currency is never stored directly as a client-editable number; it is recomputed on every sync from sanitized ledger entries:
  $$\text{Reconciled Coins} = \max\left(0, \sum \text{Credits} - \sum \text{Debits}\right)$$
- **Stale Device Protection:** A stale device syncing old state cannot erase server-recorded debit transactions, preventing infinite spending loops.

---

## 4. Deterministic Run Verification (`src/game/runValidator.ts`)

- **Authoritative Replay:** Clear times and scores submitted for global leaderboards are simulated step-by-step from the initial level seed and player move trace.
- **Human-Speed Threshold:** Enforces a minimum physical movement delay (>= 50ms per step), eliminating superhuman bot submissions.
- **Collision & Win Condition:** Simulates all hazard intervals (spikes, sentries, pulse traps) to confirm the player was alive and held all required keys when stepping onto the exit tile.

---

## 5. PostgreSQL Row-Level Security (RLS) Audit

Migrations `001` through `005` enforce strict Row Level Security across all application tables:

| Table | Anonymous / Public | Authenticated Player | Service Role (Edge Function) |
| :--- | :---: | :---: | :---: |
| `profiles` | SELECT (Public profiles) | UPDATE own profile only | FULL ACCESS (Authoritative sync) |
| `dungeons` | SELECT (Published only) | INSERT (Drafts/own) | UPDATE (On-chain verified publishing) |
| `dungeon_runs` | SELECT (Aggregates) | INSERT (Own runs) | FULL ACCESS |
| `scores` | SELECT (Leaderboards) | No direct INSERT | INSERT only after server validation |
| `auth_nonces` | No Direct Access | No Direct Access | INSERT & DELETE (Pruning) |

All `SECURITY DEFINER` functions explicitly declare `SET search_path = public` to prevent search path hijacking.

