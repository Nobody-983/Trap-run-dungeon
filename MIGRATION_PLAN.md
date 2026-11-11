# TRAP//RUN — Migration Plan: Arc to NEAR & Supabase

## 1. Migration Strategy Overview

This plan outlines the systematic removal of all Arc Studio, Circle AppKit, Wagmi/Viem, and Ethereum tooling, followed by the deployment-ready implementation of native NEAR Protocol wallet/contracts and a Supabase persistent backend with server-side fair-play verification.

---

## 2. Phase-by-Phase Roadmap

### Phase 1: Repository Audit & Clean Baseline (COMPLETE)
- [x] Full inspection of project files, directory structure, build system, and test vectors.
- [x] Initial Git repository initialization and baseline checkpoint.
- [x] Execution of existing tests (`identity:test:ts`, `identity:test:rust`, `near:registry:test`, `near:registry:client-test`, `verify-levels.ts`, `vite build`).
- [x] Documentation of current failures and blockers (`scripts/compass-deploy.ts` missing module, oxlint over-scanning `lib/openzeppelin-contracts`).
- [x] Delivery of `AUDIT.md`, `ARCHITECTURE.md`, `MIGRATION_PLAN.md`, `IMPLEMENTATION_STATUS.md`.

### Phase 2: Complete NEAR Protocol Integration & Contract Expansion
- [ ] Extend `near/registry/src/lib.rs` to add:
  - `get_challenge_by_hash(dungeon_hash)`
  - `verify_creator(challenge_id, account_id)`
  - Duplicate registration protection / reverse index
  - Comprehensive Rust unit tests for new methods
- [ ] Compile WASM artifact reproducibly (`trap_run_registry.wasm`).
- [ ] Update frontend NEAR service client (`src/services/chain/nearRegistry.ts`, `nearService.ts`, `nearWallet.ts`).
- [ ] Integrate NEAR wallet connection into root application header and profile.

### Phase 3: Supabase Backend Implementation
- [ ] Create Supabase migration SQL files:
  - `001_initial_schema.sql`: tables (`profiles`, `dungeons`, `challenges`, `daily_challenges`, `challenge_attempts`, `scores`, `achievements`).
  - `002_row_level_security.sql`: RLS policies enforcing read/write permissions.
  - `003_indexes_and_views.sql`: High-performance leaderboard indexes and views.
- [ ] Implement TypeScript Supabase client and service wrappers:
  - Profiles service (retrieve, upsert NEAR profiles).
  - Dungeons service (save, fetch published, list by creator).
  - Challenges service (daily and custom challenges).
  - Leaderboard service (global, daily, per-dungeon queries).
- [ ] Create `.env.example` with clear instructions and placeholders.

### Phase 4: Fair Play & Server Replay Validation
- [ ] Build standalone deterministic validator module (`src/services/validation/runValidator.ts`):
  - Pure simulation of `stepGame` on action traces.
  - Verification of start, movement sequence, hazards, win condition, and time bounds.
  - Authoritative calculation of score, moves, combos, and lives.
  - Anti-cheat checks (impossible movement speed, falsified scores, invalid turn sequences).
- [ ] Implement secure validation API endpoint / handler.
- [ ] Write automated tests validating good runs and rejecting manipulated/tampered runs.

### Phase 5: Complete Frontend Game Integration
- [ ] Remove Arc dependencies from `package.json` and codebase:
  - Remove `@circle-fin/*`, `wagmi`, `viem`, `connectkit`, `@openzeppelin/contracts`.
  - Remove `contracts/` (Solidity), `foundry.toml`, `remappings.txt`, `lib/openzeppelin-contracts`, `lib/forge-std`.
  - Remove `scripts/compass-deploy*.ts`, `scripts/self-deploy.ts`, `scripts/fetch-abi.ts`.
  - Clean up `src/web3/`, `src/screens/ShopScreen.tsx`, `src/config.ts`.
- [ ] Replace `ShopScreen` with progression/achievement unlock showcase or NEAR Testnet faucet/profile hub.
- [ ] Replace synthetic `demoBoard` in `Leaderboard.tsx`, `DailyScreen.tsx`, and `ResultScreen.tsx` with live Supabase leaderboard data.
- [ ] Connect Editor publish flow to:
  1. Save canonical dungeon to Supabase.
  2. Register hash on NEAR Testnet contract.
  3. Generate canonical `TRI1` share link.
- [ ] Connect Play/Daily/Challenge results to the server validation pipeline.

### Phase 6: Automated Testing & Verification
- [ ] Rust contract unit tests (`bun run near:registry:test`).
- [ ] TypeScript unit & integration tests:
  - Canonical identity & hashing.
  - Replay validator with valid and fraudulent traces.
  - Supabase client service mocks.
  - UI components and wallet states.
- [ ] Lint & Typecheck (`bun run typecheck`, `bun run lint`).
- [ ] Production build verification (`bun run build`).

### Phase 7: Deployment Preparation & Documentation
- [ ] Create `SECURITY.md`, `DEPLOYMENT.md`, `SUPABASE_SETUP.md`, `NEAR_TESTNET.md`, `TEST_REPORT.md`.
- [ ] Update `README.md` and `IMPLEMENTATION_STATUS.md`.
- [ ] Final executive summary for user authorization.
