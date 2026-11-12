# TRAP//RUN Test & Verification Matrix

Complete automated test report for TRAP//RUN across smart contracts, server-side validation, TypeScript clients, level solvers, and production compilation.

---

## 1. Test Suite Summary

| Test Domain | Command | Status | Total | Passed | Failed |
|-------------|---------|--------|-------|--------|--------|
| Rust Smart Contract | `cargo test --manifest-path near/registry/Cargo.toml` | **PASS** | 19 | 19 | 0 |
| Server-Side Validator | `bun test scripts/run-validator.test.ts` | **PASS** | 9 | 9 | 0 |
| Canonical Identity (TS) | `bun run identity:test:ts` | **PASS** | 8 | 8 | 0 |
| Canonical Identity (Rust) | `bun run identity:test:rust` | **PASS** | 2 | 2 | 0 |
| NEAR Registry Client | `bun run near:registry:client-test` | **PASS** | 8 | 8 | 0 |
| Level Solver Verification | `bun run verify:levels` | **PASS** | 12 | 12 | 0 |
| TypeScript Typecheck | `bun run typecheck` (`tsc --noEmit`) | **PASS** | - | Clean | 0 |
| Code Linting | `bun run lint` (`oxlint`) | **PASS** | 74 files | Clean | 0 |
| Production Build | `bun run build` (`vite build`) | **PASS** | Bundle | 2.0 MB | 0 |

---

## 2. Detailed Test Results

### 1. NEAR Smart Contract Suite (`cargo test`)
- `tests::creator_is_always_the_predecessor_account`: **OK**
- `tests::challenge_counter_overflow_is_rejected_before_mutation`: **OK**
- `tests::challenge_ids_are_global_and_sequential`: **OK**
- `tests::creator_pagination_is_zero_based_and_ordered`: **OK**
- `tests::duplicate_dungeon_registration_is_rejected`: **OK**
- `tests::different_creators_receive_distinct_attribution_and_indexes`: **OK**
- `tests::exact_32_byte_hash_is_accepted`: **OK**
- `tests::exact_storage_cost_is_retained`: **OK**
- `tests::excess_deposit_is_refunded_to_predecessor`: **OK**
- `tests::pagination_limits_are_bounded`: **OK**
- `tests::malformed_hash_lengths_are_rejected_without_state_changes`: **OK**
- `tests::milestone_one_fixture_hash_is_stored_without_transformation`: **OK**
- `tests::metadata_registration_and_update`: **OK**
- `tests::registration_emits_deterministic_nep_297_event`: **OK**
- `tests::reverse_hash_lookup_finds_challenge`: **OK**
- `tests::successful_challenge_registration_records_registration_information`: **OK**
- `tests::underfunded_registration_reverts_every_write`: **OK**
- `tests::unknown_challenge_lookup_returns_none`: **OK**
- `tests::view_methods_do_not_mutate_state_or_storage`: **OK**

### 2. Server-Side Validator Suite (`scripts/run-validator.test.ts`)
- `runValidator: valid campaign run with solved actions succeeds with authoritative score`: **OK** (37.11ms)
- `runValidator: impossible superhuman speed is rejected`: **OK** (3.95ms)
- `runValidator: action trace that never reaches exit is rejected`: **OK** (1.90ms)
- `runValidator: blocked action into a wall is rejected`: **OK** (2.03ms)
- `runValidator: duplicate attempt submission is rejected by idempotency`: **OK** (3.29ms)
- `runValidator: invalid player NEAR account ID is rejected`: **OK** (0.66ms)
- `runValidator: malformed action characters are rejected`: **OK** (3.10ms)
- `runValidator: fatal run where player steps on repeated spikes is rejected`: **OK** (0.79ms)
- `runValidator: attempting to submit negative or zero completion time is rejected`: **OK** (1.57ms)

### 3. Canonical Identity Compatibility (`TS` & `Rust`)
- `shared v1 fixture matches exact canonical bytes, hashes, and codes`: **OK**
- `same dungeon is stable across runs and object field insertion order`: **OK**
- `gameplay changes produce different dungeon hashes`: **OK**
- `invalid coordinates and layouts are rejected`: **OK**
- `optional challenge id is deterministic and round trips as null or u64`: **OK**
- `unsupported versions are rejected explicitly`: **OK**
- `chain, network, and registry contract domain-separate challenge identity`: **OK**
- `share-code encode/decode is lossless and canonical`: **OK**
- `Rust matches shared TypeScript fixture exactly`: **OK**

### 4. Practice Campaign Levels Solvability (`verify-levels.ts`)
All 12 baseline levels tested with deterministic breadth-first search:
1. `First Steps`: par=20 (3ms)
2. `Spike Garden`: par=22 (1ms)
3. `Pulse Alley`: par=48 (1ms)
4. `Lock & Key`: par=40 (2ms)
5. `Switchback`: par=40 (2ms)
6. `Sentry Garden`: par=16 (4ms)
7. `Rhythm Section`: par=48 (1ms)
8. `Double Lock`: par=48 (2ms)
9. `Crossfire`: par=39 (2ms)
10. `Gatekeeper`: par=41 (0ms)
11. `Gauntlet`: par=37 (6ms)
12. `Final Trial`: par=28 (13ms)

