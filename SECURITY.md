# TRAP//RUN Security & Fair-Play Architecture

TRAP//RUN operates under an adversarial security model designed around competitive integrity, wallet identity, and immutable on-chain proof of ownership. This document details the system threat model, validation guarantees, cryptographic verification, and database security policies.

---

## 1. Threat Model & Trust Boundaries

```
[ Unstrusted Client / Browser ]
          │
          │ 1. Submits { dungeon, actions, clientTimeMs, attemptId }
          ▼
[ Authoritative Validation Pipeline ] ── (runValidator.ts)
   ├── A. Authenticates Player Identity (valid NEAR account ID)
   ├── B. Deterministic SHA-256 Content Hash Verification
   ├── C. Idempotency Check (attempt_id uniqueness)
   ├── D. Plausible Speed Check (>= 50ms per move)
   ├── E. Step-by-Step Simulation (stepGame re-simulation)
   └── F. Authoritative Scoring & Win Condition Validation
          │
          ├── Success: Verified Score Record (status: 'verified')
          │            │
          │            ▼
          │   [ Supabase PostgreSQL ] (Protected by RLS)
          │
          └── Failure: Rejection with Error Reason (status: 'rejected')
```

### Trust Assumptions:
1. **The browser / client is untrusted:** Any score, timer, or completion flag reported by the frontend can be fabricated.
2. **The smart contract on NEAR Protocol is immutable:** Once challenge hashes and creators are recorded, they cannot be modified by third parties.
3. **The validation pipeline is authoritative:** Scores are accepted only if a re-simulation of the action trace produces a winning game state matching the claimed dungeon.

---

## 2. Server-Side Deterministic Replay Validation

Located at `src/services/validation/runValidator.ts`.

### Anti-Cheat Pipeline:
1. **Format Validation:**
   - Actions string is limited to `MAX_ACTIONS_LENGTH` (1,500 moves).
   - Only valid movement and interaction characters are permitted: `'U'`, `'D'`, `'L'`, `'R'`, `'W'`.
2. **Idempotency Protection:**
   - Every run attempt submits a unique `attempt_id` (UUIDv4).
   - Re-submitting an already processed `attempt_id` is immediately rejected to prevent replay flooding.
3. **Plausibility & Human-Speed Gate:**
   - Total elapsed time must be positive.
   - Moves cannot be faster than `MIN_MS_PER_MOVE` (50ms per move). Any submission violating this physical limit is flagged and rejected.
4. **Authoritative Engine Simulation:**
   - The engine initializes from `initialState(dungeon)`.
   - Each action in the submitted trace is executed sequentially through `stepGame`.
   - Collisions with walls, closed doors, out-of-bounds coordinates, or invalid actions trigger immediate disqualification.
   - Trap interactions (spikes, pulse beams, sentries, arrows) are evaluated deterministically at each step.
   - If player health reaches 0, the attempt fails with status `dead`.
5. **Win Condition & Authoritative Scoring:**
   - The run must terminate with `state.status === 'won'` (stepping on the exit portal).
   - Score is calculated server-side based on par steps, move efficiency, elapsed time, combo chains, and damage taken.
   - Client-reported scores and times are completely ignored.

---

## 3. Cryptographic Verification & On-Chain Identity

### Canonical Content Hashing:
- Dungeons are canonically formatted with sorted fields and grid data using UTF-8 canonical encoding (`src/game/canonicalIdentity.ts`).
- Content hash is computed via SHA-256 and matched identically between TypeScript and Rust (`scripts/canonical_identity_compat.rs`).
- The canonical hash is registered on NEAR Protocol in `trap_run_registry`.

### NEAR Smart Contract Security:
1. **Predecessor Attribution:**
   `env::predecessor_account_id()` is enforced as the sole creator of registered challenges. Callers cannot attribute registrations to other accounts.
2. **Reverse Hash Index & Duplicate Protection:**
   The contract maintains a `LookupMap<[u8; 32], u64>` mapping dungeon content hashes to challenge IDs. Duplicate registrations of the exact same dungeon hash revert.
3. **Storage Accounting & Deposit Bounds:**
   Storage costs (0.01 NEAR minimum) are precisely measured. Any excess deposit is immediately refunded to the caller's predecessor account.
4. **Bounded Pagination:**
   Pagination limits are strictly clamped (`MIN_PAGINATION_LIMIT = 1`, `MAX_PAGINATION_LIMIT = 100`) preventing out-of-gas exploits during view queries.
5. **Safe Arithmetic:**
   All challenge counters and indexing operations use `checked_add` with overflow reverts.

---

## 4. Database Security & Row Level Security (RLS)

Located in `supabase/migrations/20261111000002_rls_policies.sql`.

### Policies Enforced:
- **`profiles`:**
  - `SELECT`: Public access for all users.
  - `INSERT`: Allowed for authenticated wallet accounts.
  - `UPDATE`: Only the owner matching `near_account_id` can update profile metadata (display name, avatar, bio).
- **`dungeons`:**
  - `SELECT`: Public access to published dungeons.
  - `INSERT`: Authenticated creators matching `creator_near_account`.
  - `UPDATE`: Creators can update only their own unpublished/draft dungeons.
- **`challenges` & `daily_challenges`:**
  - `SELECT`: Public access.
  - `INSERT/UPDATE`: Authenticated creators or system cron jobs.
- **`challenge_attempts`:**
  - `SELECT`: Public access to attempt metadata.
  - `INSERT`: Players can submit their attempts with `validation_status = 'pending'`.
  - `UPDATE`: **Restricted.** Regular players cannot update attempts once submitted.
- **`scores` (Competitive Integrity Gate):**
  - `SELECT`: Public read access for leaderboard generation.
  - `INSERT / UPDATE`: **RESTRICTED TO SERVICE ROLE ONLY.**
  - No client-facing authenticated session or anonymous API key can write directly to the `scores` table. Only the trusted server-side validator function operating with `service_role` credentials can insert verified scores.

---

## 5. Security Checklist Summary

| Security Vector | Mechanism | Status |
|-----------------|-----------|--------|
| Spoofed Client Score | Deterministic server re-simulation via `runValidator.ts` | Enforced |
| Tool-Assisted / Bot Speed | Minimum 50ms/move threshold + physics validation | Enforced |
| Duplicate / Replay Abuse | `attempt_id` unique constraint + idempotency store | Enforced |
| Database Tampering | PostgreSQL RLS + Service-role only for `scores` | Enforced |
| Identity Impersonation | NEAR Protocol cryptographic wallet signature | Enforced |
| Contract Front-running | `predecessor_account_id` check + reverse hash map | Enforced |
| Storage Griefing | Explicit deposit check (0.01 NEAR) + exact refund | Enforced |
| Pagination DoS | Hard limits on `from_index` and `limit` (max 100) | Enforced |

