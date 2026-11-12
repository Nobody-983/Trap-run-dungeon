# TRAP//RUN — Final Security, Smart Contract Deployment & Testnet Readiness Report

**Target Network:** NEAR Protocol (Testnet ONLY)  
**Authorized Target Account:** `dragon983.testnet`  
**Current Account Native Balance:** `44.0 NEAR` (Confirmed live at block #277360359)  
**Target Account Code Status:** `No contract code` (Clean slate, confirmed)  
**Active Signer Public Key on Chain:** `ed25519:2TjerDgFuk7uejJsR9BgBVbi76ME9rV1mj7BuiCXpGSB`  
**WASM Release Artifact:** `near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm`  
**Preserved Artifact Copy:** `near/registry/deployed_artifacts/trap_run_registry_dragon983.wasm`  
**WASM Size:** `207,190 bytes` (~202 KB)  
**WASM SHA-256:** `b992d537ef0a7dd55ed143f5e06654ab405ba06e04aa6cd65199ce916767ff88`  
**Dedicated Supabase Project:** `cjfammcpgqnidbvuggii`  
**Date:** November 12, 2026  

---

## 1. Executive Summary & Audit Verification (Phase 0)

1. **Repository & Working Tree State:**
   - Git working tree preserved. No destructive git resets or file cleans.
   - Preserved all existing frontend components, gameplay logic, game loop solver, and campaign levels.
2. **Target Account On-Chain Inspection:**
   - Account `dragon983.testnet` queried via live RPC:
     - Balance: `44.0 NEAR`
     - Storage used: `182 bytes`
     - Existing contract: `None` ("No contract code")
     - Full Access Keys: `1` (`ed25519:2TjerDgFuk7uejJsR9BgBVbi76ME9rV1mj7BuiCXpGSB`)
   - **Safety Confirmation:** There is no existing contract on `dragon983.testnet`. Deployment will not overwrite any prior contract code.

---

## 2. Complete Security Remediation (Phase 1)

### A. Standard NEP-413 Authentication
- **Edge Function:** `supabase/functions/sync-profile/index.ts`
- **Borsh Serialization:** Byte-for-byte standard NEP-413 layout:
  - `tag: u32 = 2147484061` (`0x8000019d`, little-endian)
  - `message: string` (u32 length prefix + UTF-8 payload)
  - `nonce: [u8; 32]` (strictly enforced 32 raw bytes)
  - `recipient: string` (u32 length prefix + UTF-8 recipient domain)
  - `callbackUrl: Option<string>` (`0x00` for None, `0x01` + length prefix + UTF-8 for Some)
- **Digest & Cryptographic Verification:** Evaluates `SHA-256(borsh_payload)` using `@noble/curves/ed25519` against raw 32-byte public key.
- **On-Chain Access Key Proof:** Live FastNear RPC query (`view_access_key_list`) verifies that the public key is an authorized access key of `nearAccountId`.

### B. Atomic Nonce Consumption
- Eliminated all vulnerable `SELECT ... THEN INSERT` race conditions.
- Uses direct SQL insertion into `auth_nonces` table with primary key uniqueness on `nonce`.
- Duplicate or concurrent reuse attempts trigger PostgreSQL unique constraint violation (`23505`) and are rejected with HTTP 401.

### C. Game Completion & Economy Trust Model
- **Offline Client Freedom:** Gameplay mechanics, moves, and puzzles remain responsive, client-side, and offline-first as designed.
- **Server-Side Sanitization:** Client balances are never treated as authoritative. The `sanitizeAndReconcileLedger` pipeline:
  - Grants at most one starter credit (max 50 coins).
  - Enforces per-run reward ceiling (max 180 coins per clear, requiring idempotent run IDs).
  - Reconciles net spendable currency strictly from immutable ledger history: `reconciled = sum(credits) - sum(debits)`.
  - Stale offline devices cannot restore spent coins.

---

## 3. Smart Contract Verification (Phase 2)

**Source:** `near/registry/src/lib.rs`  
**Test Results:** **21 / 21 Rust Unit Tests Passed** (0 Failures):

| # | Test Scenario | Status |
| :---: | :--- | :---: |
| 1 | Contract one-time initialization & duplicate init panic | PASSED |
| 2 | Creator-owned publishing & timestamp recording | PASSED |
| 3 | Reverse 32-byte hash duplicate protection | PASSED |
| 4 | Creator retrieving own dungeon | PASSED |
| 5 | Public unauthenticated dungeon view lookup | PASSED |
| 6 | Creator metadata update and version increment | PASSED |
| 7 | Unauthorized non-creator update rejection | PASSED |
| 8 | Creator unpublishing lifecycle | PASSED |
| 9 | Unauthorized unpublish rejection | PASSED |
| 10 | Sequential monotonic version incrementing | PASSED |
| 11 | Creator attribution isolation and pagination | PASSED |
| 12 | Pagination bounds clamping (1..50) | PASSED |
| 13 | Non-32-byte content hash rejection | PASSED |
| 14 | Malformed metadata URI scheme rejection | PASSED |
| 15 | Metadata max length (512 bytes) enforcement | PASSED |
| 16 | Underfunded storage deposit rejection (< 0.05 NEAR) | PASSED |
| 17 | Storage accounting and dynamic yoctoNEAR refund | PASSED |
| 18 | Deterministic NEP-297 `EVENT_JSON:` log emission | PASSED |
| 19 | Serde JSON validation of NEP-297 event payload | PASSED |
| 20 | 100% legacy API compatibility (`register_challenge`, etc.) | PASSED |
| 21 | Milestone 1 golden test vector `canonical-dungeon-v1.txt` compatibility | PASSED |

- `cargo fmt --check`: Clean (0 diffs).
- `cargo clippy`: Clean (0 warnings, 0 errors).
- Reproducible WASM Release Build: SHA-256 `b992d537ef0a7dd55ed143f5e06654ab405ba06e04aa6cd65199ce916767ff88`.

---

## 4. Cost, Storage & Gas Expenditure Forecast (Phase 3)

The user funded `dragon983.testnet` with 44 NEAR. Expected breakdown:

1. **Contract WASM Code Staking:**
   - Binary size: `207,190 bytes`
   - Cost per byte: `10^19 yoctoNEAR` (0.00001 NEAR / byte)
   - Code Storage Staking: **~2.072 NEAR**
2. **Contract State Staking (Initial Storage):**
   - LookupMaps and initial state: **~0.010 NEAR**
3. **Transaction Execution Gas:**
   - Deployment transaction gas (~30 TGas): **~0.003 NEAR**
   - Initialization transaction gas (`init` call, ~30 TGas): **~0.003 NEAR**
4. **Lifecycle Testing Budget (12 Lifecycle Txs):**
   - Publishing deposit buffer: 0.05 NEAR (mostly refunded dynamically)
   - Updating & unpublishing gas: ~0.03 NEAR
5. **Total Deployment & Testing Expenditure:** **~2.12 NEAR**
6. **Projected Remaining Account Balance:** **~41.88 NEAR** (Safe and well within budget).

---

## 5. Full-Stack Integration & Client Verification (Phases 4 & 5)

1. **Frontend Configuration (`.env`):**
   ```env
   VITE_NEAR_NETWORK=testnet
   VITE_NEAR_RPC_URL=https://rpc.testnet.fastnear.com
   VITE_NEAR_REGISTRY_ACCOUNT=dragon983.testnet
   VITE_SUPABASE_URL=https://cjfammcpgqnidbvuggii.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sHYtzsQ-2TDpouRm_tdjGA_VJjTMHJP
   ```
2. **TypeScript Integration Tests (`bun test`):**
   **83 / 83 Tests Passed across 13 test files (0 Failures):**
   - `scripts/near-registry-client.test.ts`: 9/9 passed.
   - `scripts/near-publishing.test.ts`: 5/5 passed.
   - `scripts/nep413-auth.test.ts`: 5/5 passed.
   - `scripts/creator.test.ts`: 6/6 passed.
   - `scripts/economy.test.ts`: 10/10 passed.
   - `scripts/run-validator.test.ts`: 9/9 passed.
   - `scripts/supabase-profile-sync.test.ts`: 11/11 passed.
   - `scripts/migrations-validation.test.ts`: 6/6 passed.
   - `scripts/integration-flow.test.ts`: 1/1 passed.
   - `scripts/community.test.ts`: 3/3 passed.
   - `scripts/supabase-connectivity.test.ts`: 2/2 passed.
   - `scripts/canonical-identity.test.ts`: 6/6 passed.
   - `scripts/e2e-publishing-and-security.test.ts`: 10/10 passed.
3. **Build & Solvability:**
   - `bun run typecheck`: Clean (0 errors).
   - `bun run lint`: Clean (0 errors).
   - `bun run verify:levels`: All 12 campaign levels verified solvable.
   - `bun run build`: Production Vite bundle successfully generated in `dist/`.

---

## 6. Real Testnet Deployment & Execution Gate (Phase 6 & 7)

### Deployment Pre-flight Checklist:
- [x] Target account `dragon983.testnet` verified funded with 44 NEAR.
- [x] Target account verified to have no prior contract code.
- [x] Release WASM compiled, verified reproducible, and preserved.
- [x] Frontend and Edge Functions configured for `dragon983.testnet`.
- [x] Multi-account test identities (`roundfrog-dev.testnet`, `safeharbor.testnet`) ready in system keychain.

### Exact Deployment Execution:
To authorize the deployment key to sign for `dragon983.testnet`, choose either **Method A** or **Method B**:

#### Method A: Legacy Key File (Instant CLI deployment)
Save the credentials to `~/.near-credentials/testnet/dragon983.testnet.json`:
```json
{
  "account_id": "dragon983.testnet",
  "public_key": "ed25519:2TjerDgFuk7uejJsR9BgBVbi76ME9rV1mj7BuiCXpGSB",
  "private_key": "ed25519:<SECRET_KEY>"
}
```
Then execute:
```bash
near contract deploy dragon983.testnet use-file near/registry/deployed_artifacts/trap_run_registry_dragon983.wasm with-init-call init '{"owner_id": "dragon983.testnet"}' --deposit 0NEAR network-config testnet sign-with-legacy-keychain send
```

#### Method B: Browser Wallet Connection
Visit the official NEAR CLI web-wallet connection URL in your browser:
```text
https://testnet.mynearwallet.com/login/?title=NEAR+CLI&public_key=ed25519%3AFqcafE7Xksy1KzGAegQMdnTLxgG3BT4DWddhBe59g9Ro
```
Approve the connection for `dragon983.testnet`. The private key is already stored in your system keyring (`near-testnet-dragon983.testnet`). Then execute:
```bash
near contract deploy dragon983.testnet use-file near/registry/deployed_artifacts/trap_run_registry_dragon983.wasm with-init-call init '{"owner_id": "dragon983.testnet"}' --deposit 0NEAR network-config testnet sign-with-keychain send
```

---

## 7. Final Verdict Matrix

| Component | Verdict | Justification |
| :--- | :---: | :--- |
| **Smart Contract Code & Unit Tests** | **VERIFIED** | 21/21 Rust tests pass; clippy and fmt clean; WASM artifact reproducible. |
| **NEP-413 & Atomic Nonce Security** | **VERIFIED** | Standard Borsh layout, FastNear RPC access key validation, unique DB constraint. |
| **Economy Sanitization & Ledger** | **VERIFIED** | Server-side balance recomputation; anti-cheat caps; stale restoration prevented. |
| **Frontend & Client Integration** | **VERIFIED** | 83/83 Bun tests pass; typecheck and lint clean; production Vite build succeeds. |
| **Edge Function Compatibility** | **VERIFIED** | Accepts both canonical `publish_dungeon` and legacy `register_challenge` events. |
| **Live Testnet Deployment Execution** | **IMPLEMENTED AND LOCALLY VERIFIED** (Ready for Broadcast) | All artifacts, configs, and funds (44 NEAR) ready; awaiting wallet signer authorization. |

