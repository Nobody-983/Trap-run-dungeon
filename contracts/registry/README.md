# TRAP//RUN Native NEAR Dungeon Registry Contract

The TRAP//RUN native NEAR smart contract provides a decentralized, permissionless, creator-owned registry for custom dungeons.

## Features

- **Creator-Owned Publishing:** Anyone with a NEAR account can publish their dungeon by attaching a minimum storage deposit (0.05 NEAR).
- **Canonical Hash Indexing:** Reverse index on 32-byte layout hashes guarantees that each unique dungeon layout is authored once and attributed permanently.
- **Dynamic Storage Refund:** Exact state growth is measured in yoctoNEAR (`storage_after - storage_before`), retaining only what is needed and refunding all excess tokens immediately.
- **NEP-297 Standard Events:** Deterministic structured logs for indexing (`dungeon_published`, `dungeon_updated`, `dungeon_unpublished`, `challenge_registered`).
- **100% Backwards Compatibility:** Exposes canonical `dungeon_*` methods while maintaining legacy `challenge_*` aliases so existing frontends and Edge Functions continue operating seamlessly.

## Building and Testing

Source directory: `near/registry/`

```bash
# Run unit tests (21 tests)
cargo test --manifest-path near/registry/Cargo.toml

# Check code formatting
cargo fmt --manifest-path near/registry/Cargo.toml --check

# Check clippy lints
cargo clippy --manifest-path near/registry/Cargo.toml

# Build optimized release WASM
cargo build --manifest-path near/registry/Cargo.toml --target wasm32-unknown-unknown --release
```

## Contract Methods

### Mutable (Change) Methods
- `publish_dungeon(dungeon_hash: Base64VecU8, metadata_uri: Option<String>) -> U64`
- `update_dungeon(dungeon_id: U64, metadata_uri: Option<String>)`
- `unpublish_dungeon(dungeon_id: U64)`
- `register_challenge(dungeon_hash: Base64VecU8) -> U64` (Legacy alias)
- `register_challenge_with_metadata(dungeon_hash: Base64VecU8, metadata: Option<String>) -> U64` (Legacy alias)
- `update_metadata(challenge_id: U64, metadata: Option<String>)` (Legacy alias)

### View (Read-Only) Methods
- `get_dungeon(dungeon_id: U64) -> Option<DungeonView>`
- `get_creator_dungeons(creator: AccountId, from_index: Option<U64>, limit: Option<u32>) -> Vec<DungeonView>`
- `get_dungeon_count() -> U64`
- `get_next_dungeon_id() -> U64`
- `get_challenge_by_hash(dungeon_hash: Base64VecU8) -> Option<DungeonView>`
- `is_dungeon_registered(dungeon_hash: Base64VecU8) -> bool`
- `verify_creator(challenge_id: U64, account_id: AccountId) -> bool`
- `get_owner() -> AccountId`

