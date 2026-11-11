# TRAP//RUN — System Architecture

## 1. System Overview

TRAP//RUN is a competitive dungeon-building and escape game powered by **NEAR Protocol** for blockchain-backed proof of authorship and ownership, and **Supabase (PostgreSQL + Row Level Security + Server Verification)** for persistent application data, leaderboard aggregation, and cheat-proof score validation.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT (REACT + VITE)                           │
│                                                                             │
│   ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌────────────┐   │
│   │ Game Engine   │  │ Level Editor  │  │ Canvas Render │  │ NEAR Wallet│   │
│   │ & Local Solver│  │ & Validator   │  │ (2D Retro)    │  │ Selector   │   │
│   └──────┬────────┘  └───────┬───────┘  └───────────────┘  └─────┬──────┘   │
└──────────┼───────────────────┼───────────────────────────────────┼──────────┘
           │                   │                                   │
           │ Replay Payload    │ Canonical Dungeon & Hash          │ Sign / Call
           ▼                   ▼                                   ▼
┌─────────────────────────────────────────┐         ┌─────────────────────────┐
│           BACKEND / SUPABASE            │         │      NEAR PROTOCOL      │
│                                         │         │        (TESTNET)        │
│  ┌───────────────────────────────────┐  │         │                         │
│  │ Server-Side Replay Verification   │  │         │  ┌───────────────────┐  │
│  │  - Re-simulates complete run      │  │         │  │ trap_run_registry │  │
│  │  - Validates exit reachability    │  │         │  │  - register_dungeon│ │
│  │  - Computes authoritative score   │  │         │  │  - verify_creator │  │
│  │  - Checks idempotency & timing    │  │         │  │  - get_challenge  │  │
│  └─────────────────┬─────────────────┘  │         │  │  - update_metadata│  │
│                    ▼                    │         │  └───────────────────┘  │
│  ┌───────────────────────────────────┐  │         │                         │
│  │ PostgreSQL + Row Level Security   │  │ Hash &  │ Monotonically increasing│
│  │  - profiles (keyed by near_id)    │◄─┼─────────┤ challenge IDs & verified│
│  │  - dungeons (payloads + hashes)   │  │ Creator │ receipts                │
│  │  - challenges & daily_challenges  │  │         │                         │
│  │  - scores (verified scores only)  │  │         │                         │
│  │  - achievements                   │  │         │                         │
│  └───────────────────────────────────┘  │         └─────────────────────────┘
└─────────────────────────────────────────┘
```

---

## 2. Layer Responsibilities & Strict Separation

| Concern | Managed By | Description |
|---|---|---|
| **Turn Simulation & Rendering** | Client Canvas Engine | 60 FPS interpolated rendering. Immediate responsive player movement with turn-based hazard progression. |
| **Dungeon Proof & Authorship** | NEAR Protocol Contract | Deterministic 32-byte SHA-256 dungeon hash, creator `AccountId`, registration timestamp, and block height stored immutably on-chain. |
| **Game Storage & Metadata** | Supabase PostgreSQL | Full 9x9 grid layout, cell arrays, creator bios, titles, descriptions, difficulty ratings, and challenge codes. |
| **Competitive Integrity** | Server Replay Validator | The client **never** declares its score. The client submits raw action traces (`u`, `d`, `l`, `r`, `w`) and timestamps. The trusted engine re-simulates the game from tile 0 to finish. |
| **Leaderboards & Queries** | Supabase Views & Indexes | Indexed queries for global top scores, daily challenge standings, and per-dungeon leaderboards. |

---

## 3. Cryptographic & Canonical Identities

### 3.1 Canonical Dungeon Format (v1)
To ensure that hashing is deterministic regardless of JSON key ordering or whitespace:
1. **Magic Header:** 4 bytes ASCII `TRDG`.
2. **Schema Version:** 1 byte `0x01`.
3. **Dimensions:** Width (1 byte = 9), Height (1 byte = 9).
4. **Coordinates:** Start X, Start Y, Exit X, Exit Y (4 bytes).
5. **Tile Codes:** 81 bytes in row-major order:
   - `0: empty`, `1: wall`, `2: spike`, `3: pulse`, `4: sentryH`, `5: sentryV`, `6: key`, `7: door`, `8: switch`, `9: gate`.
6. **Total Length:** 92 bytes fixed.

### 3.2 Canonical Dungeon Hash
`SHA-256("TRAPRUN:DUNGEON\0" || CanonicalDungeonBytes)`  
The resulting 32-byte digest is the universal key across NEAR smart contracts, Supabase database records, and share codes.

### 3.3 Canonical Share Code (`TRI1.<base64url>`)
Shareable challenge string encoding:
- Magic `TRSC`
- Version `0x01`
- Kind (`0: Dungeon`, `1: Challenge`)
- Length-prefixed Registry Context (`chain: near`, `network: testnet`, `registry: <account>`)
- 92-byte Canonical Dungeon
- Big-Endian U64 Challenge ID (for Kind 1)

---

## 4. Smart Contract Architecture (`near/registry`)

The Rust smart contract implements an immutable, storage-efficient registry on NEAR Protocol.

### 4.1 State Structure
```rust
pub struct TrapRunRegistry {
    next_challenge_id: u64,
    challenges: LookupMap<u64, ChallengeRecord>,
    creator_counts: LookupMap<AccountId, u64>,
    creator_challenges: LookupMap<CreatorIndexKey, u64>,
    dungeon_challenges: LookupMap<[u8; 32], u64>, // Hash to Challenge ID lookup
}
```

### 4.2 Methods
- `register_challenge(dungeon_hash: Base64VecU8) -> U64`: Payable method. Validates 32-byte hash, ensures unique dungeon hash mapping or attributes existing challenge, records block height/time, emits NEP-297 event, deducts storage cost, and refunds excess yoctoNEAR.
- `get_challenge(challenge_id: U64) -> Option<ChallengeView>`: Returns challenge record.
- `get_challenge_by_hash(dungeon_hash: Base64VecU8) -> Option<ChallengeView>`: Reverse lookup.
- `get_challenges_by_creator(creator: AccountId, from_index: Option<U64>, limit: Option<u32>) -> Vec<ChallengeView>`: Paginated query bounded to 50 items.
- `verify_creator(challenge_id: U64, account_id: AccountId) -> bool`: Verifies ownership.
- `get_next_challenge_id() -> U64`: Current counter value.

---

## 5. Supabase Database Schema & Security

### 5.1 Tables
- `profiles`:
  - `near_account_id` (PRIMARY KEY, text)
  - `display_name` (text)
  - `avatar_url` (text)
  - `bio` (text)
  - `created_at`, `updated_at` (timestamptz)
- `dungeons`:
  - `id` (uuid, PRIMARY KEY)
  - `creator_near_account` (text REFERENCES profiles)
  - `title` (text, not null)
  - `description` (text)
  - `dungeon_hash` (text, UNIQUE, 64-char hex)
  - `canonical_format_version` (int = 1)
  - `grid_data` (jsonb, containing cells, start, exit)
  - `par` (int)
  - `difficulty` (int)
  - `status` (text: 'draft', 'published', 'verified')
  - `near_challenge_id` (bigint)
  - `created_at`, `updated_at` (timestamptz)
- `challenges`:
  - `id` (uuid, PRIMARY KEY)
  - `dungeon_id` (uuid REFERENCES dungeons)
  - `creator_near_account` (text)
  - `challenge_code` (text, UNIQUE)
  - `is_daily` (boolean)
  - `created_at` (timestamptz)
- `daily_challenges`:
  - `day` (date, PRIMARY KEY)
  - `dungeon_id` (uuid REFERENCES dungeons)
  - `title` (text)
  - `par` (int)
  - `created_at` (timestamptz)
- `challenge_attempts`:
  - `id` (uuid, PRIMARY KEY)
  - `challenge_id` (uuid REFERENCES challenges)
  - `player_near_account` (text)
  - `actions` (text, action sequence)
  - `client_elapsed_ms` (int)
  - `outcome` (text: 'win', 'loss')
  - `status` (text: 'pending', 'verified', 'rejected')
  - `submitted_at`, `validated_at` (timestamptz)
- `scores`:
  - `id` (uuid, PRIMARY KEY)
  - `player_near_account` (text REFERENCES profiles)
  - `dungeon_id` (uuid REFERENCES dungeons)
  - `challenge_id` (uuid REFERENCES challenges)
  - `attempt_id` (uuid REFERENCES challenge_attempts UNIQUE)
  - `completion_time_ms` (int, not null)
  - `moves` (int, not null)
  - `score` (int, not null)
  - `validation_status` (text, default 'verified')
  - `created_at` (timestamptz)
- `achievements`:
  - `id` (text)
  - `player_near_account` (text REFERENCES profiles)
  - `unlocked_at` (timestamptz)
  - PRIMARY KEY (`id`, `player_near_account`)

### 5.2 Row Level Security (RLS) Policies
- `profiles`: Publicly readable (`SELECT true`). Writable only if `auth.uid() = near_account_id` or matching authenticated NEAR session.
- `dungeons`: Public can view published dungeons (`SELECT status = 'published'`). Creators can manage their own drafts.
- `scores`: Public read-only (`SELECT true`). Insert/update strictly restricted to service-role / validation function. **No client direct write allowed.**
- `challenge_attempts`: Players can insert their attempts. Validated status updated only by server.

---

## 6. Authoritative Replay & Fair Play Architecture

```
Client Completes Run
       │
       │ POST /api/validate-run (or Supabase Edge Function)
       │ {
       │   dungeonId: string,
       │   playerNearAccount: string,
       │   actions: string ("uuddrlw..."),
       │   elapsedMs: number,
       │   clientTimestamp: number,
       │   signature?: string
       │ }
       ▼
1. Fetch canonical dungeon record from Database by dungeonId.
2. Verify canonical dungeon hash matches stored hash.
3. Check Idempotency: has (player, dungeon, actions_hash) been processed?
4. Re-simulate deterministic stepGame() from initialState(dungeon):
   - For each char in actions:
     - Check bounds & execute stepGame(dungeon, analysis, state, action).
     - Update turn counter, lives lost, combos, near-misses.
     - If all lives lost -> reject win claim.
5. Confirm final tile == dungeon.exit and outcome == 'win'.
6. Check timing plausibility:
   - Minimum physical human reaction time per move (~60ms).
   - Authoritative elapsedMs calculation.
7. Calculate authoritative score:
   - score = 1000 + comboBonus - floor(timeMs/1000)*8 - max(0, moves - par)*4 - livesLost*150.
8. Store validated attempt & score in atomic transaction.
9. Return verified result with ranking update to client.
```
