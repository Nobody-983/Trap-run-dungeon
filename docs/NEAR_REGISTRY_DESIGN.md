# TRAP//RUN — Native NEAR Dungeon Registry Contract Design

**Standard:** NEP-297 (Events) / Creator-Owned On-Chain Identity  
**Contract Package:** `trap-run-registry` (Rust, `near-sdk v5.7.0`)  
**Network:** NEAR Protocol (Testnet / Mainnet)  
**Schema Version:** 1  

---

## 1. Architectural Philosophy & Publishing Model

The TRAP//RUN Dungeon Registry is architected around **Creator-Owned Publishing**.
- **Permissionless Publishing:** Any connected NEAR account can publish their dungeon to the on-chain registry without prior admin approval or centralized gatekeeping.
- **Permanent Authorship & Immutability:** On-chain registry entries tie a unique 32-byte canonical dungeon layout hash to the signer's `AccountId`. Once registered, authorship is established cryptographically.
- **Self-Governed Updates & Lifecycle:** Only the original creator can update metadata (such as titles, descriptions, IPFS CIDs) or toggle published/unpublished status.
- **Dual API Compatibility:** The contract guarantees 100% backwards compatibility with earlier frontend versions and Edge Functions by exposing canonical `dungeon_*` methods alongside legacy `challenge_*` aliases.

---

## 2. On-Chain Data Model & Storage Structures

### 2.1 State Storage Keys
```rust
enum StorageKey {
    Challenges,         // Map: dungeon_id (u64) -> DungeonRecord
    CreatorCounts,      // Map: creator (AccountId) -> total published count (u64)
    CreatorChallenges,  // Map: (creator, index) -> dungeon_id (u64)
    DungeonChallenges,  // Map: [u8; 32] (hash) -> dungeon_id (u64)
}
```

### 2.2 Core Record Structure
```rust
#[near(serializers = [borsh])]
pub struct DungeonRecord {
    pub dungeon_hash: [u8; 32],
    pub creator: AccountId,
    pub schema_version: u8,
    pub registered_at_nanoseconds: u64,
    pub registered_at_block_height: u64,
    pub updated_at_nanoseconds: u64,
    pub updated_at_block_height: u64,
    pub version: u32,
    pub is_published: bool,
    pub metadata_uri: Option<String>,
}
```

### 2.3 Serialization & Gas Efficiency
- Internal storage utilizes **Borsh** for compact byte encoding and minimal CPU deserialization gas.
- Public views and return values serialize to standard JSON conforming to NEAR conventions (with 64-bit unsigned integers represented as decimal strings via `near_sdk::json_types::U64`).

---

## 3. Contract Interface Specifications

### 3.1 Change (Mutable) Methods

#### `publish_dungeon(dungeon_hash: Base64VecU8, metadata_uri: Option<String>) -> U64`
- **Payable:** Requires a minimum attached deposit of **0.05 NEAR** (`50_000_000_000_000_000_000_000` yoctoNEAR).
- **Validation:**
  - `dungeon_hash` must be exactly 32 bytes.
  - `dungeon_hash` must not already be registered in `dungeon_challenges`.
  - `metadata_uri` (if provided) must not exceed 512 bytes and must start with `http://`, `https://`, `ipfs://`, or `ar://`.
- **Execution:**
  - Assigns incremental `dungeon_id = next_challenge_id++`.
  - Records registration block height and nanosecond timestamp.
  - Measures storage growth dynamically and refunds any excess attached deposit to `env::predecessor_account_id()`.
  - Emits both NEP-297 events: `dungeon_published` and `challenge_registered` (for legacy clients).
- **Returns:** Newly allocated `U64` ID.

#### `update_dungeon(dungeon_id: U64, metadata_uri: Option<String>)`
- **Payable:** Optional attached deposit to cover additional storage if metadata grows.
- **Authorization:** Only the original `creator` can update. Any other account panics with `"Only the dungeon creator can update metadata"`.
- **Execution:**
  - Increments `version` counter.
  - Updates `updated_at_nanoseconds` and `updated_at_block_height`.
  - Updates `metadata_uri`.
  - Dynamically calculates storage delta; retains required cost and refunds excess.
  - Emits `dungeon_updated` event.

#### `unpublish_dungeon(dungeon_id: U64)`
- **Payable:** Requires 1 yoctoNEAR for explicit wallet authorization.
- **Authorization:** Only the original `creator` can unpublish.
- **Execution:**
  - Sets `is_published = false`.
  - Updates timestamps.
  - Emits `dungeon_unpublished` event.

#### Legacy Change Aliases
- `register_challenge(dungeon_hash: Base64VecU8) -> U64`: Calls `publish_dungeon(dungeon_hash, None)`.
- `register_challenge_with_metadata(dungeon_hash: Base64VecU8, metadata: Option<String>) -> U64`: Calls `publish_dungeon(dungeon_hash, metadata)`.
- `update_metadata(challenge_id: U64, metadata: Option<String>)`: Calls `update_dungeon(challenge_id, metadata)`.

---

### 3.2 View (Read-Only) Methods

| Canonical Method | Legacy Alias | Description |
| :--- | :--- | :--- |
| `get_dungeon(dungeon_id: U64)` | `get_challenge(challenge_id: U64)` | Retrieves complete `DungeonView` by numeric ID |
| `get_creator_dungeons(creator, from_index, limit)` | `get_challenges_by_creator(...)` | Paginated list of creator's dungeons (limit 1..50) |
| `get_dungeon_count()` | `get_challenge_count()` | Total number of registered dungeons |
| `get_next_dungeon_id()` | `get_next_challenge_id()` | Next sequential ID to be assigned |
| `get_challenge_by_hash(dungeon_hash)` | — | Reverse lookup by 32-byte layout hash |
| `is_dungeon_registered(dungeon_hash)` | — | Quick boolean check for layout uniqueness |
| `verify_creator(challenge_id, account_id)` | — | Cryptographic attribution verification |
| `get_creator_challenge_count(creator)` | — | Total dungeons published by a specific account |
| `get_owner()` | — | Returns current admin/treasury owner account |

---

## 4. Storage Economics & Dynamic Refund Formula

On NEAR Protocol, storage is state-staked at **10^19 yoctoNEAR per byte** (0.00001 NEAR/byte).

1. **Storage Measurement:**
   ```rust
   let storage_before = env::storage_usage();
   // ... state mutations ...
   let storage_after = env::storage_usage();
   let storage_cost = if storage_after > storage_before {
       u128::from(storage_after - storage_before) * env::storage_byte_cost().as_yoctonear()
   } else {
       0
   };
   ```
2. **Refund Calculation:**
   ```rust
   assert!(attached_deposit >= storage_cost, "Attached deposit insufficient");
   let refund = attached_deposit - storage_cost;
   if refund > 0 {
       Promise::new(creator).transfer(NearToken::from_yoctonear(refund));
   }
   ```
3. **Safety Guarantee:** Users never overpay for storage. The required deposit buffer protects against out-of-storage panics, while the immediate transfer refund guarantees fair pricing.

---

## 5. NEP-297 Event Schema

All state-changing operations emit structured events prefixed with `EVENT_JSON:`:

```json
{
  "standard": "trap_run_registry",
  "version": "1.0.0",
  "event": "dungeon_published",
  "data": [
    {
      "dungeon_id": "1",
      "dungeon_hash": "base64Encoded32Bytes==",
      "creator": "player.testnet",
      "schema_version": 1,
      "version": 1,
      "metadata_uri": "ipfs://bafy..."
    }
  ]
}
```

For backwards compatibility with existing indexing bots and Edge Functions, publishing simultaneously emits:
```json
{
  "standard": "trap_run_registry",
  "version": "1.0.0",
  "event": "challenge_registered",
  "data": [
    {
      "challenge_id": "1",
      "dungeon_hash": "base64Encoded32Bytes==",
      "creator": "player.testnet",
      "schema_version": 1,
      "metadata": "ipfs://bafy..."
    }
  ]
}
```

---

## 6. Edge Function & Frontend Integration

1. **Frontend Call Builders (`src/services/chain/nearRegistry.ts`):**
   - Implements builders for both canonical and legacy methods (`buildPublishDungeonCall`, `buildUpdateDungeonCall`, `buildUnpublishDungeonCall`).
   - Normalizes decoder `decodeNearRegistryChallenge` to accept both contract schemas seamlessly.
2. **High-Level Service (`src/services/chain/nearService.ts`):**
   - Exposes typed TypeScript API `publishDungeon`, `updateDungeon`, `unpublishDungeon`, `getDungeon`, etc.
3. **Edge Function Verification (`supabase/functions/verify-publishing/index.ts`):**
   - Accepts both `'publish_dungeon'` and `'register_challenge'`.
   - Extracts either `dungeon_id` or `challenge_id` from event logs.

