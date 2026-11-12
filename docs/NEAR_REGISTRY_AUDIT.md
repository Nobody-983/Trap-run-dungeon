# TRAP//RUN — Native NEAR Registry Contract Audit Report

## 1. Executive Summary

This audit assesses the existing smart contract, frontend integration, wallet communication, and backend verification architecture for TRAP//RUN's creator-owned on-chain dungeon publishing lifecycle.

The application currently has:
1. A compiled and locally tested native NEAR Rust contract in `near/registry/src/lib.rs`.
2. A frontend service layer in `src/services/chain/` providing wallet connection, transaction construction, RPC queries, and outcome receipt parsing.
3. An on-chain verification Edge Function in `supabase/functions/verify-publishing/index.ts` that audits FastNear RPC transaction status, NEP-297 event logs, and contract views.
4. A frontend UI in `src/screens/EditorScreen.tsx` that enforces self-clear certification before publishing to NEAR Testnet with a 0.05 NEAR deposit.

---

## 2. Existing Architecture & Publishing Lifecycle

```
[ Player in EditorScreen ]
          │
          │ 1. Self-clear certification (solvability + fairness check)
          ▼
[ NEAR Wallet Selector ]
          │
          │ 2. functionCall: register_challenge / register_challenge_with_metadata
          │    Deposit: 0.05 NEAR (50,000,000,000,000,000,000,000 yoctoNEAR)
          ▼
[ NEAR Testnet Contract (trap_run_registry) ]
          │
          │ 3. Verifies predecessor account, checks duplicate hash, records ChallengeRecord,
          │    emits NEP-297 event: "challenge_registered", refunds excess storage deposit
          ▼
[ FinalExecutionOutcome ]
          │
          │ 4. Extracts challenge ID from NEP-297 logs (EVENT_JSON:...)
          ▼
[ Supabase Edge Function: verify-publishing ]
          │
          │ 5. Queries FastNear RPC for transaction receipt outcome
          │    Verifies signer == creator, receiver == contract, deposit >= 0.05 NEAR,
          │    verifies NEP-297 event log, and double-checks contract view `get_challenge`
          ▼
[ Supabase public.dungeons ]
          │
          │ 6. Updates row with on_chain_verified = true, on_chain_tx_hash, near_registry_id
          ▼
[ Community Catalog / Social Share Code ]
```

---

## 3. Existing Wallet Integration

- **Wallet Selector**: Integrated via `@near-wallet-selector/core` and official wallet packages (MyNearWallet, Meteor, Here, Nightly, Sender).
- **Session**: Retains `accountId`, `publicKey`, and `network: 'testnet'`.
- **Change Calls**: Uses `wallet.signAndSendTransaction` via `wallet.signAndSendRegistryCall`.
- **View Calls**: Executes read-only queries against FastNear JSON-RPC (`https://rpc.testnet.fastnear.com`) via `NearRegistryRpcTransport`.

---

## 4. Existing Supabase Verification Flow

In `supabase/functions/verify-publishing/index.ts`:
- Checks `txHash` format (Base58, 40-46 chars).
- Prevents replay by checking if `on_chain_tx_hash` was already verified.
- Calls `https://rpc.testnet.fastnear.com` RPC method `tx` with `[txHash, creatorAccountId]`.
- Enforces:
  - `signerId === creatorAccountId`
  - `receiverId === registryContract`
  - Method name is `register_challenge` or `register_challenge_with_metadata` (must support `publish_dungeon`).
  - Attached deposit is at least `50_000_000_000_000_000_000_000n` yoctoNEAR (0.05 NEAR).
  - NEP-297 event log matches standard `trap_run_registry` and event `challenge_registered`.
  - Queries contract view `get_challenge` with `{ challenge_id: ... }` to verify creator and dungeon hash.

---

## 5. Contract Requirements & Gaps Identified

### Current Capabilities (`near/registry/src/lib.rs`):
- `register_challenge(dungeon_hash)`
- `register_challenge_with_metadata(dungeon_hash, metadata)`
- `update_metadata(challenge_id, metadata)`
- `get_challenge(challenge_id)`
- `get_challenge_by_hash(dungeon_hash)`
- `is_dungeon_registered(dungeon_hash)`
- `verify_creator(challenge_id, account_id)`
- `get_creator_challenge_count(creator)`
- `get_challenge_count()`
- `get_challenges_by_creator(creator, from_index, limit)`
- `get_challenges(from_index, limit)`

### Gaps vs. Requested Phase 2/3 Specification:
1. **Method Naming**: The prompt requests canonical registry methods:
   - `publish_dungeon`
   - `update_dungeon`
   - `unpublish_dungeon`
   - `get_dungeon`
   - `get_creator_dungeons`
   - `get_dungeon_count`
2. **Dungeon Record Fields**:
   - `is_published` / `status` (active vs unpublished).
   - `version` (starts at 1, increments on update).
   - `updated_at_nanoseconds` / `updated_at_block_height`.
   - `metadata_uri` (URL or IPFS/Arweave CID).
3. **NEP-297 Events**:
   - Currently only emits `challenge_registered`.
   - Needs:
     - `dungeon_published` (while maintaining compatibility with `challenge_registered`).
     - `dungeon_updated`.
     - `dungeon_unpublished`.
4. **Creator-Authorized Unpublishing**:
   - Needs `unpublish_dungeon` (and alias `unpublish_challenge`): Only predecessor == creator can unpublish. Sets `is_published = false`.

---

## 6. Compatibility Constraints

1. **Edge Function Compatibility**: `supabase/functions/verify-publishing/index.ts` looks for:
   - Methods: `register_challenge` or `register_challenge_with_metadata` (we will alias `publish_dungeon`).
   - NEP-297 log: `trap_run_registry`, event: `challenge_registered` with `data[0].challenge_id`.
   - View method: `get_challenge` with `{ challenge_id: ... }` returning `creator` and `dungeon_hash`.
2. **Frontend Compatibility**: `src/services/chain/nearRegistry.ts` and `src/services/chain/nearService.ts` construct `register_challenge` and decode `ChallengeView`.
3. **Dual API Support**: The contract must provide both the legacy `challenge` methods and the new `dungeon` methods as aliases or overloaded wrappers.

---

## 7. Files That Need Modification / Expansion

1. `near/registry/src/lib.rs`: Expand contract state, add versioning, status flag, update/unpublish methods, new NEP-297 events, and aliases.
2. `src/services/chain/nearRegistry.ts`: Add `publish_dungeon`, `update_dungeon`, `unpublish_dungeon` calls and types.
3. `src/services/chain/nearService.ts`: Add `unpublishDungeon` and `updateDungeon` service methods.
4. `supabase/functions/verify-publishing/index.ts`: Accept `publish_dungeon` and `dungeon_published` alongside legacy names.
5. `contracts/registry/README.md`: Create comprehensive contract documentation.
6. `docs/NEAR_REGISTRY_DESIGN.md`: Document data model, storage cost model, and security rules.
7. `docs/NEAR_REGISTRY_TESTING.md`: Document Rust unit tests, mock VM tests, and verification results.
8. `docs/NEAR_REGISTRY_DEPLOYMENT.md`: Document exact deployment and verification commands.

---

## 8. Risks and Unresolved Assumptions

- **NEAR Sandbox Availability**: Native NEAR Sandbox requires container or specific binaries. We must verify if `near-workspaces` or unit tests via `near-sdk::test_utils` are appropriate. Native unit tests with `VMContextBuilder` provide 100% deterministic local coverage without network dependencies.
- **Gas Limit**: Registration does multiple storage inserts; attached gas of 30 Tgas is safe and standard.
- **Deposit Refund**: Storage cost is measured dynamically (`storage_after - storage_before`); excess attached deposit above actual storage cost is refunded via `Promise::new(creator).transfer(...)`.

