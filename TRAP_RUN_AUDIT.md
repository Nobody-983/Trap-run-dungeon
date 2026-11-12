# TRAP//RUN — Complete Pre-Integration Project Audit

**Repository:** `~/Desktop/trap_run_dungeon_challenge_yjacwo`  
**Date:** November 12, 2026  
**Auditor:** Senior Full-Stack Engineer, Supabase Architect & NEAR Blockchain Specialist  

---

## 1. Executive Summary

TRAP//RUN is a turn-based dungeon escape and creator game built on a deterministic grid engine with a dual economy:
1. **In-game Off-Chain Economy:** In-game coins earned via dungeon runs (with anti-farming diminishing returns and streak rewards) spent on consumables (health potions, elixirs) and cosmetic skins/trails.
2. **On-Chain NEAR Publishing Economy:** Native NEAR Testnet smart contract registry where creators pay a fixed fee of 0.05 NEAR to publish immutable 32-byte layout hashes, verified on-chain and shared via canonical share codes (`TRI1.`) and community catalogs.

This audit evaluates the application state across 10 critical dimensions to ensure seamless Supabase integration without degrading existing offline capability, wallet authentication, or smart contract workflows.

---

## 2. Frontend Framework & Architecture

- **Core Framework:** React 18.3.1 with TypeScript 5.8
- **Build Tool:** Vite 6.4.5 with Tailwind CSS 3.4
- **State Management:**
  - `useSyncExternalStore` pattern in `src/progress/store.ts` for reactive profile state.
  - Custom event/callback listeners for modal routing and screen switches.
- **Routing:** Controlled screen-switch architecture in `src/App.tsx` managing active routes:
  - `modes`: Game mode selector (Campaign, Daily, Custom/Community, Dungeon Creator).
  - `play`: Real-time canvas-rendered puzzle gameplay.
  - `editor`: 9x9 grid authoring tool with budget, undo/redo, solver verification, and clear certification.
  - `friend`: Community catalog, level browser, share code decoder/importer, and on-chain sync.
  - `shop`: In-game cosmetics and consumable item store.
  - `profile`: Player stats, wallet connection status, inventory, and achievements.
  - `result`: Post-dungeon summary, par delta, coin rewards, and ratings.
- **Styling & Assets:** Dark arcade terminal aesthetic with neon accents (`#00f0ff`, `#00ff66`), custom pixel art icons, and responsive desktop/mobile layouts.

---

## 3. Game Mechanics & Solver Engine

- **Grid System:** 9x9 discrete grid with coordinates `(x, y)` indexed `0..80`.
- **Hazards & Entities:**
  - Static obstacles: `wall`.
  - Dynamic traps: `spike` (toggle on/off per turn), `fire` (timed bursts), `laser` (beam cycles), `boulder` (directional rolling), `portal` (teleport pairs), `lock` / `key` (item pickup gates), `potion` (in-run health pickups).
- **Turn-based Synchronization:** All hazards advance exactly one phase per player movement or wait step.
- **Authoritative Solver (`src/game/solver.ts`):**
  - Deterministic Breadth-First Search (BFS) state-space explorer.
  - Explores state tuples `(player_pos, hazard_phases, keys_collected)` to compute the minimum move par.
  - Rejects unsolvable dungeons before authoring or publishing.
- **Self-Clear Proof:** Creators cannot publish a level until they beat it themselves in test mode. The clear certificate is bound to the exact cell layout hash.

---

## 4. Current localStorage Usage

| Storage Key | Module | Purpose | Transient vs. Persistent |
|---|---|---|---|
| `trap-run:profile:v1:near:<account>` | `src/progress/store.ts` | Authenticated player profile, stats, inventory, coins, unlocks | **Persistent** (Candidate for Supabase sync) |
| `trap-run:profile:v1` | `src/progress/store.ts` | Guest profile for players without a connected wallet | **Local/Guest** (Migrated upon wallet connect) |
| `trap-run:community-catalog:v1` | `src/services/community/catalog.ts` | Locally cached community dungeons & imported levels | **Hybrid** (Mirrors Supabase catalog) |
| `trap-run:pending-publishing-sync:v1` | `src/services/chain/nearTransactionVerifier.ts` | Buffer for NEAR publication receipts awaiting cloud sync | **Transient Buffer** (Cleared upon cloud sync) |
| `traprun:session:v1` | `src/auth/session.ts` | Active wallet authentication session | **Transient** (Session state) |

---

## 5. Supabase Integration State

- **SDK:** `@supabase/supabase-js` v2.49.1 installed.
- **Client Configuration (`src/services/supabase/client.ts`):**
  - Requires update to support `VITE_SUPABASE_PUBLISHABLE_KEY` alongside `VITE_SUPABASE_ANON_KEY`.
  - Configured with session persistence and auto token refresh.
- **Database Migrations:**
  1. `20261111000001_initial_schema.sql`: Core tables (`profiles`, `dungeons`, `challenges`, `daily_challenges`, `challenge_attempts`, `scores`, `achievements`).
  2. `20261111000002_rls_policies.sql`: Row-Level Security rules.
  3. `20261111000003_leaderboard_views_and_functions.sql`: Leaderboard views and ranking RPCs.
  4. `20261111000004_dungeon_stats_runs_ratings_and_verification.sql`: Aggregate stats triggers, ratings, and anti-forgery publication trigger.
- **Edge Functions:**
  - `supabase/functions/verify-publishing/index.ts`: On-chain NEAR transaction verification against FastNear RPC.

---

## 6. NEAR Wallet & Registry Integration

- **Wallet Selector:** `@near-wallet-selector/core` v8.9.15 with multi-wallet support:
  - Meteor Wallet (`@near-wallet-selector/meteor-wallet`)
  - MyNearWallet (`@near-wallet-selector/my-near-wallet`)
  - HERE Wallet (`@near-wallet-selector/here-wallet`)
  - Sender Wallet (`@near-wallet-selector/sender`)
  - Ledger (`@near-wallet-selector/ledger`)
- **RPC Infrastructure:** Configured to `https://rpc.testnet.fastnear.com` (CORS-enabled for browser preflights).
- **Smart Contract (`near/registry/src/lib.rs`):**
  - Compiled release WASM SHA-256: `48ef65d72a26f71ecaf0a63b47bfed3ca4a289b94e379bcca9215ce642ad10ee`.
  - Enforces minimum 0.05 NEAR deposit (`MIN_PUBLISHING_DEPOSIT_YOCTO`).
  - Emits NEP-297 events (`challenge_registered`).
  - Storage cost delta calculated dynamically with excess yoctoNEAR refunded to caller.

---

## 7. Authentication Architecture

- **Primary Identity:** Cryptographic NEAR account ID (e.g., `runner.testnet`).
- **Guest Support:** Unconnected players can play all campaign levels, build drafts, and earn local progress without forced sign-up.
- **Account Linking:** When a guest connects a NEAR wallet for the first time, local guest progress is merged into the newly keyed profile (`claimedBy: address`).
- **Supabase Auth Boundary:**
  - No email/password requirement.
  - Public operations (browsing, leaderboard reads) use the public publishable key.
  - User-specific updates are authenticated using client-side wallet identity mapped to RLS policies.

---

## 8. Test Suites & Quality Assurance

- **Rust Contract Tests:** 26/26 passed (`cargo test --manifest-path near/registry/Cargo.toml`).
- **TypeScript & E2E Tests:** 58/58 passed across 9 test files (`bun test`).
- **Solvability Verification:** 12/12 campaign levels verified solvable (`bun run verify:levels`).
- **Type Checking:** 0 errors (`tsc --noEmit`).
- **Linter:** 0 errors (`oxlint`).
- **Production Build:** Success (`dist/assets/index-BPWCwv_S.js` 3,599 kB).

---

## 9. Identified Integration Gaps & Remediation Plan

1. **Client Env Variable Normalization:**
   `src/services/supabase/client.ts` must read `VITE_SUPABASE_PUBLISHABLE_KEY` (as provided in `.env`) and fall back to `VITE_SUPABASE_ANON_KEY`.
2. **Profile Cloud Synchronization:**
   Currently, profile progression lives exclusively in `localStorage`. We need an asynchronous background sync service (`src/services/supabase/profileSync.ts`) that loads and persists player profiles to `public.profiles` when a wallet is connected, while preserving offline/guest play when disconnected or offline.
3. **Remote Schema Deployment:**
   The remote Supabase project `cjfammcpgqnidbvuggii` currently has an unmigrated schema (`PGRST205`). Migrations 001–004 must be prepared and presented for user review before application.
4. **Community Catalog Hybrid Mode:**
   `src/services/community/catalog.ts` must query Supabase for community dungeons and gracefully merge with local custom levels.

---

## 10. Audit Conclusion

The application architecture is modular, thoroughly tested, and cleanly separated between pure deterministic gameplay and network persistence. Integration with Supabase can be completed with zero disruption to gameplay or NEAR smart contract functionality.

