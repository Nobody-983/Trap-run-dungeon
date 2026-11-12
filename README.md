# TRAP//RUN

> "Build a trap. Escape someone else's."

A competitive, deterministic dungeon-building and escape game for the browser. Build 9x9 tactical dungeons loaded with pulse beams, arrow launchers, sentries, and pressure switches, then compete on verified global and daily leaderboards.

Powered by **native NEAR Protocol** (Testnet) for immutable challenge ownership & registration, and **Supabase PostgreSQL** for persistent leaderboards, profiles, and server-side replay verification.

---

## ⚡ Key Features

- **Practice Campaign:** 12 handmade, solver-verified levels scaling in difficulty.
- **Creator Mode:** 30-second build clock, budget constraints, mandatory solver & test-run clearance.
- **NEAR Protocol Integration:** Register dungeon challenges on-chain with deterministic SHA-256 canonical hashes (`TRI1` share codes).
- **Competitive Fair-Play Engine:** Server-side deterministic re-simulation of player action traces (`stepGame`) to prevent client score spoofing.
- **Supabase Backend:** Indexed leaderboards (Global, Daily, Per-Dungeon), player profiles, attempt histories, and daily challenges.
- **Progression & Armory:** Earn XP, level up, unlock cosmetics, and track personal bests.
- **Wallet-Based Identity:** Native NEAR Wallet Selector (MyNearWallet) with guest fallback.

---

## 🛠 Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Lucide Icons, Canvas 2D Renderer, Web Audio API
- **Blockchain:** Native NEAR Protocol (Testnet), Rust smart contracts compiled to WebAssembly (`near-sdk` v5.1.0), `@near-wallet-selector`
- **Backend & Database:** Supabase PostgreSQL with Row Level Security (RLS), migrations, indexed views, and stored functions
- **Verification Engine:** Pure deterministic TypeScript engine with human-speed gating (>=50ms/move) and idempotency controls

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.1+) or Node.js (v20+)
- [Rust](https://rustup.rs) (1.70+) with `wasm32-unknown-unknown` target (for contract builds)

### Installation & Development

```bash
# Install dependencies
bun install

# Start local development server
bun run dev

# Run typechecker
bun run typecheck

# Run linter
bun run lint
```

---

## 🧪 Test Suite

Run the full verification matrix:

```bash
# 1. Server-side deterministic replay validator tests
bun test scripts/run-validator.test.ts

# 2. NEAR Rust smart contract unit tests
bun run near:registry:test

# 3. Compile release WebAssembly contract artifact
bun run near:registry:build

# 4. NEAR registry TypeScript client integration tests
bun run near:registry:client-test

# 5. Canonical identity & hashing compatibility tests (TS + Rust)
bun run identity:test:ts
bun run identity:test:rust

# 6. Verify campaign level solvability
bun run verify:levels

# 7. Production bundle build
bun run build
```

---

## 📖 Architecture & Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — System component architecture, data flow, and separation of concerns.
- [SECURITY.md](SECURITY.md) — Security model, fair-play validation pipeline, RLS policies, and anti-cheat controls.
- [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — Database schema, migration runbook, and views.
- [NEAR_TESTNET.md](NEAR_TESTNET.md) — NEAR contract methods, deployment parameters, and view/call instructions.
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment guide for Web, Contract, and Supabase.
- [TEST_REPORT.md](TEST_REPORT.md) — Test matrix and verification proof.
- [MIGRATION_PLAN.md](MIGRATION_PLAN.md) — Arc-to-NEAR migration execution record.
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) — Phase-by-phase implementation status.

---

## 🔐 Environment Variables

Copy `.env.example` to `.env`:

```env
# NEAR Testnet
VITE_NEAR_NETWORK=testnet
VITE_NEAR_REGISTRY_CONTRACT=traprun-registry.testnet
VITE_NEAR_RPC_URL=https://rpc.testnet.fastnear.com

# Supabase Backend
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```
