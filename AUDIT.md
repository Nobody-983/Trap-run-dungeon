# TRAP//RUN — Complete Codebase Audit

**Date:** November 2026  
**Auditor:** Senior Full-Stack, Security, and Smart Contract Engineer  
**Repository:** `trap_run_dungeon_challenge_yjacwo`

---

## 1. Executive Summary

TRAP//RUN is a tile-based turn-based dungeon challenge game ("Build a trap. Escape someone else's.").  
The gameplay engine, solver, canvas renderer, and canonical dungeon hashing are implemented and functional. However, the original project was configured around Arc Studio and Ethereum/EVM tools (Wagmi, Viem, ConnectKit, Circle AppKit, Solidity contract `TrapRunShop.sol`), while competitive data (scores, replays, user profile, challenges) was stored only in browser `localStorage` with synthetic demo leaderboards.

A pilot implementation of a native NEAR Protocol challenge registry exists in `near/registry/src/lib.rs` and frontend services under `src/services/chain/near*.ts`.

This audit details the full codebase structure, dependencies, existing failures, Arc-specific bloat, and provides the architectural foundation for the complete NEAR migration and Supabase backend implementation.

---

## 2. Codebase Inventory

### 2.1 Gameplay & Rules Engine (`src/game/`)
- `types.ts`: Defines 9x9 grid constants, cell types (`empty`, `wall`, `spike`, `pulse`, `sentryH`, `sentryV`, `key`, `door`, `switch`, `gate`), player actions (`u`, `d`, `l`, `r`, `w`), events, and run state.
- `engine.ts`: Pure, deterministic simulation step function `stepGame()`. Advances player, ticks sentries (bouncing along axes), pulses (4-beat cycle), doors, keys, and gates.
- `solver.ts`: Breadth-first state-space solver. Validates reachability from start to exit, proving that every dungeon is beatable without taking damage.
- `validate.ts`: Enforces grid bounds (9x9), budget limits (100 coins), element caps (keys, doors, switches, gates, sentries), and verifies solvability via `solve()`.
- `levels.ts`: 12 built-in campaign levels, all verified solvable.
- `daily.ts`: Deterministic daily dungeon generation based on UTC date (`YYYY-MM-DD`) and `mulberry32` PRNG.
- `canonicalIdentity.ts`: Canonical binary serialization format v1 (`TRDG` magic header, 92 bytes) and SHA-256 canonical dungeon hash. Canonical challenge envelope (`TRCH`) and share code encoding (`TRI1.<base64url>`).
- `run.ts`: `RunController` class managing real-time play, inputs, action traces, combo tracking, near-miss bonuses, lives, and countdowns.
- `result.ts`: Computes score from outcome, time, moves, par, combo bonus, and lives lost. Formats time (`mm:ss.cc`).

### 2.2 Graphics & Rendering (`src/render/`)
- `DungeonCanvas.tsx`: High-performance HTML5 Canvas component rendering grid tiles, sentries, animated hazards, particle trails, floating combat text, and player character with custom skins.
- `scene.ts`: Sprite sheet drawing and procedural canvas rasterization.
- `sprites.ts`: Canvas pixel art and icon rendering routines.

### 2.3 User Interface & Screens (`src/screens/`, `src/components/`, `src/editor/`)
- `App.tsx`: Top-level route switch managing screen navigation (`modes`, `play`, `daily`, `practice`, `editor`, `friend`, `replay`, `result`, `profile`, `shop`, `settings`).
- `screens/EditorScreen.tsx`: Tile-based level designer with budget counter, tool picker, test play, and save capabilities.
- `screens/PlayScreen.tsx` & `PracticeScreen.tsx`: Campaign level selector and playthrough.
- `screens/DailyScreen.tsx`: Daily challenge screen with deterministic level of the day.
- `screens/FriendScreen.tsx`: Custom challenge hosting, code generation (`TR1` legacy and `TRI1` NEAR), code import, and solver checks.
- `screens/ReplayScreen.tsx`: Action trace player re-simulating recorded actions at fixed step intervals.
- `screens/ResultScreen.tsx`: Victory/defeat summary, stats, XP rewards, and leaderboard entry preview.
- `screens/ProfileScreen.tsx`: Displays player stats (levels cleared, near misses, traps placed, daily streak), unlocked achievements, and cosmetics.
- `components/Leaderboard.tsx`: Renders leaderboard rows. Currently driven by synthetic `demoBoard()` in `localStorage`.

### 2.4 Existing NEAR Protocol Implementation
- `near/registry/Cargo.toml`: Rust crate `trap_run_registry` using `near-sdk = "5.30.0"`.
- `near/registry/src/lib.rs`: NEAR smart contract implementing:
  - `register_challenge(dungeon_hash: Base64VecU8) -> U64`
  - `get_challenge(challenge_id: U64) -> Option<ChallengeView>`
  - `get_challenges_by_creator(creator: AccountId, from_index: Option<U64>, limit: Option<u32>) -> Vec<ChallengeView>`
  - `get_next_challenge_id() -> U64`
  - NEP-297 event emission (`challenge_registered`).
  - Storage deposit accounting with exact excess refund to `predecessor_account_id`.
  - 17 unit tests in Rust covering bounds, refunds, events, and sequential ID assignment.
- `src/services/chain/near*.ts`:
  - `nearConfig.ts`: Testnet RPC and contract configuration via `VITE_NEAR_*` env vars.
  - `nearRegistry.ts`: Decoders, input validators, call builders, and challenge verifiers.
  - `nearWallet.ts`: `@near-wallet-selector/core` integration supporting `my-near-wallet`.
  - `nearTransport.ts`: JSON-RPC provider bridge via `near-api-js`.

---

## 3. Arc Studio & EVM Dependencies Identified for Removal

The current application contains extensive Arc Studio / Circle / EVM dependencies that must be removed per project requirements:

1. **`package.json` Dependencies:**
   - `@circle-fin/adapter-viem-v2`
   - `@circle-fin/app-kit`
   - `@circle-fin/developer-controlled-wallets`
   - `@circle-fin/modular-wallets-core`
   - `@circle-fin/smart-contract-platform`
   - `@circle-fin/user-controlled-wallets`
   - `@circle-fin/w3s-pw-web-sdk`
   - `@openzeppelin/contracts`
   - `connectkit`
   - `wagmi`
   - `viem`
   - `@web3icons/react`

2. **Source Code Modules:**
   - `src/config.ts`: Wagmi config referencing Arc chain (`arc`, `arcTestnet`).
   - `src/auth/useAuth.ts` & `src/auth/session.ts`: ConnectKit and EVM wallet state.
   - `src/screens/ShopScreen.tsx`: USDC cosmetic shop calling Arc contract.
   - `src/web3/`: `useShopData.ts`, `shop.ts`, `usePurchase.ts`, `network.ts`.
   - `src/onchain-money.ts`, `src/onchain-facts.ts`, `src/onchain-wait.ts`.
   - `src/components/PayStatus.tsx`.
   - `src/services/chain/adapters/stellar.ts`: Mock Stellar adapter.
   - `src/services/chain/adapters/mockWallet.ts`.

3. **EVM Contract Files:**
   - `contracts/TrapRunShop.sol`
   - `contracts/script/`
   - `contracts/contract-metadata/`
   - `foundry.toml`, `remappings.txt`
   - `lib/openzeppelin-contracts/`
   - `lib/forge-std/`

4. **Scripts:**
   - `scripts/compass-deploy.ts` (references missing `@circlefin/compass-chains`)
   - `scripts/compass-deploy-helpers.ts`
   - `scripts/fetch-abi.ts`
   - `scripts/self-deploy.ts`

---

## 4. Current Test & Build Failures Recorded

| Command | Status | Details / Root Cause |
|---|---|---|
| `bun run typecheck` | **FAILED** | `Cannot find module '@circlefin/compass-chains'` in `scripts/compass-deploy.ts:14`. |
| `bun run lint` | **FAILED** | Fails on `scripts/compass-deploy.ts` and scans `lib/openzeppelin-contracts/` containing CommonJS `require()`. |
| `forge test` | **FAILED** | System `/usr/bin/forge` is a bioinformatics SNAP tool, not Foundry. |
| `bun run identity:test:ts` | **PASSED** | 8/8 tests pass (canonical serialization, hashing, share codes). |
| `bun run identity:test:rust` | **PASSED** | 2/2 tests pass (Rust/TS SHA-256 cross-compatibility). |
| `bun run near:registry:test` | **PASSED** | 17/17 Rust unit tests in `near/registry` pass. |
| `bun run near:registry:client-test` | **PASSED** | 7/7 client decoding and validation tests pass. |
| `bun run ./scripts/verify-levels.ts` | **PASSED** | 12/12 built-in campaign levels validated with solver. |
| `vite build` | **PASSED** | Produces a 3,071 kB bundle overloaded with Circle AppKit / EVM code. |

---

## 5. Architectural Deficiencies in Current State

1. **No Backend Persistence:** Everything is stored in client `localStorage`. If the user clears browser data or changes devices, all dungeons and progress are lost.
2. **Cheat-Prone Scores:** The client calculates its own score and completion time. No server validation exists.
3. **Synthetic Leaderboards:** `demoBoard()` synthesizes fake competitor names (`NEON_WRAITH`, `pixel.pete`) with local PRNG.
4. **Disjointed NEAR Identity:** NEAR wallet selector is only plugged into `FriendScreen` for registry calls; the rest of the application still referenced Wagmi/ConnectKit for account identity.
5. **No Supabase Auth Bridge:** No secure bridge between NEAR ed25519 wallet signatures and Supabase database security.

---

## 6. Actionable Migration Targets

1. **NEAR Protocol:**
   - Expand `near/registry` smart contract to include full dungeon registration, duplicate protection, creator ownership verification, metadata updates, and indexed lookup by hash.
   - Wire NEAR Wallet Selector directly into the application's root authentication layer (`useAuth`).
2. **Supabase PostgreSQL & Security:**
   - Design and generate migrations for: `profiles`, `dungeons`, `challenges`, `challenge_attempts`, `scores`, `daily_challenges`, `achievements`.
   - Comprehensive Row Level Security (RLS) policies ensuring players only modify their own profiles and dungeons, and scores cannot be inserted directly without server verification.
3. **Fair Play & Server Verification Pipeline:**
   - Implement an authoritative game simulation and replay validation API.
   - Verify: player identity, dungeon hash match, valid action trace, deterministic replay simulation to the exit, authoritative calculation of moves, time, combo bonus, lives lost, and score.
4. **Frontend Cleanup:**
   - Remove all Arc/Wagmi/Viem/Circle/Foundry files.
   - Refactor UI to display real global, daily, and dungeon leaderboards powered by Supabase.
   - Update `ShopScreen` or cosmetics unlock flow to use player progression, achievements, and NEAR credentials.
   - Ensure clean `typecheck`, `lint`, and `build`.
