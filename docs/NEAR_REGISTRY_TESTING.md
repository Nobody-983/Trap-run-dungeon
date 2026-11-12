# TRAP//RUN — NEAR Registry Contract & Integration Testing Report

**Test Engine:** Cargo Test (Mocked NEAR VM) & Bun Test (TypeScript Runtime)  
**Total Rust Unit Tests:** 21 / 21 Passing  
**Total Frontend & Integration Tests:** 83 / 83 Passing  
**Status:** All Verification Gates Clean  

---

## 1. Rust Smart Contract Test Suite (`near/registry/src/lib.rs`)

The Rust test suite executes against `MockedBlockchain` with full gas, receipt, and storage simulation.

| # | Test Case Name | Scenario Tested | Result |
| :---: | :--- | :--- | :---: |
| 1 | `test_contract_initialization` | One-time contract init with owner, state persistence, duplicate init rejection | PASSED |
| 2 | `test_successful_creator_publishing` | Clean publishing lifecycle, ID increment, timestamp recording, metadata preservation | PASSED |
| 3 | `test_duplicate_dungeon_registration_rejected` | Reverse hash index rejection of identical 32-byte layout hashes | PASSED |
| 4 | `test_creator_retrieving_own_dungeon` | Verification of creator attribution and data consistency | PASSED |
| 5 | `test_public_dungeon_retrieval` | View call access for arbitrary third-party accounts without permission gates | PASSED |
| 6 | `test_creator_update_success` | Creator modifying metadata URI, version incrementing, updated timestamps | PASSED |
| 7 | `test_unauthorized_update_rejection` | Impersonation attempt rejected when non-creator attempts `update_dungeon` | PASSED |
| 8 | `test_unpublish_behavior` | Creator setting `is_published = false`, updating state and events | PASSED |
| 9 | `test_unauthorized_unpublish_rejection` | Non-creator unpublish attempt panics with authorization error | PASSED |
| 10 | `test_version_increment` | Sequential updates properly increment monotonic `version` counter | PASSED |
| 11 | `test_different_creators_receive_distinct_attribution_and_indexes` | Creator indexing and count isolation across multiple accounts | PASSED |
| 12 | `test_pagination_limits` | Bounded pagination (clamp max 50, reject 0, offset beyond count returns empty) | PASSED |
| 13 | `test_invalid_content_hash` | Non-32-byte hashes rejected before storage mutation | PASSED |
| 14 | `test_invalid_metadata_uri` | Invalid protocol schemes (e.g. `javascript:`) rejected | PASSED |
| 15 | `test_input_size_limits` | Metadata strings exceeding 512 bytes rejected | PASSED |
| 16 | `test_insufficient_storage_deposit` | Attached deposit < 0.05 NEAR rejected | PASSED |
| 17 | `test_storage_accounting_and_refund` | Dynamic calculation of storage growth and transfer refund of remaining deposit | PASSED |
| 18 | `test_event_emission_format` | Verification of `EVENT_JSON:` log prefix and NEP-297 format | PASSED |
| 19 | `test_nep297_event_json_parsing` | Serde JSON validation of structured `dungeon_published` event payload | PASSED |
| 20 | `test_existing_frontend_and_edge_function_compatibility` | Legacy methods (`register_challenge_with_metadata`) and events work flawlessly | PASSED |
| 21 | `test_milestone_one_fixture_hash_preserved` | Golden test vector `canonical-dungeon-v1.txt` byte-for-byte exact compatibility | PASSED |

### Command to Re-Run:
```bash
cargo test --manifest-path near/registry/Cargo.toml
```

---

## 2. Frontend & Integration Test Suite (`bun test`)

The TypeScript integration suite validates client-side call building, Borsh serialization, NEP-413 signatures, run verification, and database migrations across 13 test files.

| Test File | Tests Passed | Coverage Domain |
| :--- | :---: | :--- |
| `scripts/near-registry-client.test.ts` | 9 / 9 | Call builders, decoders, pagination, hash verification, error cases |
| `scripts/near-publishing.test.ts` | 5 / 5 | Paid publishing flow, outcome parsing, share code generation |
| `scripts/nep413-auth.test.ts` | 5 / 5 | NEP-413 Borsh encoding, Ed25519 signatures, atomic nonce consumption |
| `scripts/creator.test.ts` | 6 / 6 | Dungeon editor, grid constraints, undo/redo, solver parity |
| `scripts/economy.test.ts` | 10 / 10 | Reward calculation, anti-farming, shop purchases, life limits |
| `scripts/run-validator.test.ts` | 9 / 9 | Move trace verification, superhuman speed detection, spike traps |
| `scripts/supabase-profile-sync.test.ts` | 11 / 11 | Monotonic progression merge, ledger balance reconciliation, stale protection |
| `scripts/migrations-validation.test.ts` | 6 / 6 | Zero destructive SQL, RLS policy validation, idempotent migrations |
| `scripts/integration-flow.test.ts` | 1 / 1 | Full end-to-end publishing, playing, scoring, and sync loop |
| `scripts/community.test.ts` | 3 / 3 | Community dungeon catalogs, filters, and counter updates |
| `scripts/supabase-connectivity.test.ts` | 2 / 2 | Supabase network connectivity & client configuration |
| `scripts/canonical-identity.test.ts` | 6 / 6 | SHA-256 layout hashing, share codes, round-trip serialization |
| `scripts/e2e-publishing-and-security.test.ts` | 10 / 10 | End-to-end security protections, underfunding rejections, layout tampering |

**Total:** 83 / 83 Passing (0 Failures).

### Command to Re-Run:
```bash
bun test
```

