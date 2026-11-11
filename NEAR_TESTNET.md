# NEAR Protocol Testnet Integration

TRAP//RUN integrates native NEAR Protocol (Testnet) for immutable dungeon challenge registrations, creator verification, and reverse hash lookups.

---

## 1. Smart Contract Architecture

- **Crate:** `near/registry`
- **Language:** Rust (2021 edition)
- **SDK:** `near-sdk` v5.1.0 with NEP-297 Events Standard
- **Target:** `wasm32-unknown-unknown`
- **WASM Size:** 154,985 bytes
- **SHA-256 Checksum:** `21d87595178bc938f632329439c84c7ced0b36ac80819b3c22dffdb179addeb6`

---

## 2. Implemented Smart Contract Methods

### Change Methods (Requires Transaction & Deposit)

#### `register_challenge(dungeon_hash: Base64VecU8) -> U64`
Registers a 32-byte canonical dungeon hash. Requires a 0.01 NEAR storage deposit. Unused deposit is refunded. Returns global challenge ID. Reverts on duplicate hash.

#### `register_challenge_with_metadata(dungeon_hash: Base64VecU8, metadata: Option<String>) -> U64`
Registers a 32-byte canonical hash with an optional JSON metadata string (title, par, difficulty).

#### `update_metadata(challenge_id: U64, metadata: String)`
Allows the original creator of `challenge_id` to update the associated metadata JSON. Reverts if called by any other account.

### View Methods (Free / Read-Only)

#### `get_challenge(challenge_id: U64) -> Option<ChallengeRecord>`
Fetches challenge record by its global ID.

#### `get_challenge_by_hash(dungeon_hash: Base64VecU8) -> Option<ChallengeRecord>`
Performs O(1) reverse lookup using the SHA-256 content hash.

#### `is_dungeon_registered(dungeon_hash: Base64VecU8) -> bool`
Returns `true` if the dungeon hash has already been registered on-chain.

#### `verify_creator(challenge_id: U64, account_id: AccountId) -> bool`
Returns `true` if `account_id` was the recorded predecessor who registered `challenge_id`.

#### `get_challenges_by_creator(creator: AccountId, from_index: Option<U64>, limit: Option<u64>) -> Vec<ChallengeRecord>`
Returns paginated list of challenges created by an account.

#### `get_challenge_count() -> U64`
Returns total number of registered challenges.

---

## 3. Deployment & Interaction Runbook

### Step 1: Create a Testnet Account
You can create a free NEAR Testnet account at:
- [testnet.mynearwallet.com](https://testnet.mynearwallet.com)

### Step 2: Deploy Contract
```bash
near contract deploy <your-account>.testnet \
  use-file near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm \
  without-init-call \
  network-config testnet \
  sign-with-keychain \
  send
```

### Step 3: Register a Test Dungeon Hash
```bash
# Register a 32-byte sha256 hash (base64 encoded)
near contract call-as-transaction <your-account>.testnet register_challenge \
  args-json '{"dungeon_hash": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="}' \
  deposit 0.02 NEAR \
  prepaid-gas '30.0 Tgas' \
  network-config testnet \
  sign-with-keychain \
  send
```

### Step 4: Verify via View Call
```bash
near contract call-as-read-only <your-account>.testnet get_challenge \
  args-json '{"challenge_id": "1"}' \
  network-config testnet \
  now
```

---

## 4. Wallet Selector Configuration

The frontend uses `@near-wallet-selector/core` and `@near-wallet-selector/my-near-wallet`.

Configured in `src/services/chain/near.ts`:
- **Network ID:** `testnet`
- **Node URL:** `https://rpc.testnet.near.org`
- **Wallet URL:** `https://testnet.mynearwallet.com`
- **Explorer URL:** `https://testnet.nearblocks.io`
