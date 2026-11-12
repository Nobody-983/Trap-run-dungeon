# TRAP//RUN Deployment Guide

This guide covers deployment instructions for the smart contract on NEAR Testnet, the Supabase database migrations, and the frontend web application.

---

## 1. Prerequisites

- **Node.js**: v20+ or v22+
- **Bun**: v1.1+ (recommended package manager)
- **Rust**: `rustc` 1.70+ with `wasm32-unknown-unknown` target installed:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **NEAR CLI**: `near-cli-rs` installed (`cargo install near-cli-rs` or `npm install -g near-cli`)
- **Supabase CLI**: `npm install -g supabase` (optional for direct CLI migrations)

---

## 2. NEAR Smart Contract Build & Deployment

### Step 1: Compile the Contract to WebAssembly
Navigate to the repository root and compile the optimized release WASM artifact:
```bash
cargo build --manifest-path near/registry/Cargo.toml --target wasm32-unknown-unknown --release
```

The compiled WASM will be generated at:
```
near/registry/target/near/trap_run_registry.wasm
```

**Artifact Properties:**
- **Binary Size:** 180,897 bytes (~177 KB)
- **SHA-256 Checksum:** `48ef65d72a26f71ecaf0a63b47bfed3ca4a289b94e379bcca9215ce642ad10ee`

### Step 2: Deploy to NEAR Testnet
Using `near-cli-rs`:
```bash
# 1. Login with your testnet account if not already authenticated
near account login network-config testnet

# 2. Deploy and initialize the contract in a single transaction
near contract deploy <your-account>.testnet \
  use-file near/registry/target/near/trap_run_registry.wasm \
  with-init-call init \
  as-json '{"owner_id": "<your-account>.testnet"}' \
  network-config testnet \
  sign-with-keychain \
  send
```

### Step 3: Verify Deployed Contract State
Test view calls against the deployed contract:
```bash
# Verify Owner
near contract call-as-read-only <your-account>.testnet get_owner \
  network-config testnet now

# Verify Total Challenge Count
near contract call-as-read-only <your-account>.testnet get_challenge_count \
  network-config testnet now

# Verify Challenges Pagination
near contract call-as-read-only <your-account>.testnet get_challenges \
  as-json '{"from_index": "0", "limit": 10}' \
  network-config testnet now
```

---

## 3. Supabase Backend Setup & Migrations

### Step 1: Create a Supabase Project
1. Log in to [database.new](https://database.new) or [supabase.com](https://supabase.com).
2. Create a new project (e.g., `traprun-production`).
3. Note your **Project URL**, **Anon Key**, and **Service Role Key** under Project Settings -> API.

### Step 2: Apply Database Migrations
Migrations are located in `supabase/migrations/`:
- `20261111000001_initial_schema.sql`: Core tables, indexes, and constraints.
- `20261111000002_rls_policies.sql`: Row Level Security policies.
- `20261111000003_leaderboard_views_and_functions.sql`: Views & functions for fast querying.
- `20261111000004_dungeon_stats_runs_ratings_and_verification.sql`: Stats, runs, ratings, triggers, and on-chain verification schema.

You can apply them using the Supabase CLI or SQL Editor:

**Via Supabase CLI:**
```bash
# Link project
supabase link --project-ref <your-project-ref>

# Push all migrations
supabase db push
```

**Via Supabase Web Console:**
Open the **SQL Editor** in Supabase and execute the contents of the migration files in numerical order (`000001`, `000002`, `000003`, `000004`).

### Step 3: Deploy Verification Edge Function (Optional)
To independently verify publishing transactions server-side:
```bash
supabase functions deploy verify-publishing --no-verify-jwt
supabase secrets set NEAR_REGISTRY_CONTRACT=<your-account>.testnet
```

---

## 4. Frontend Configuration & Deployment

### Step 1: Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure the environment variables:
```env
# NEAR Configuration
VITE_NEAR_NETWORK=testnet
VITE_NEAR_REGISTRY_CONTRACT=traprun-registry.testnet
VITE_NEAR_RPC_URL=https://rpc.testnet.fastnear.com

# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Step 2: Build Production Frontend
```bash
bun install
bun run build
```
The output will be placed in `dist/`.

### Step 3: Deploy to Hosting Platform

**Vercel:**
```bash
vercel --prod
```
Set the Environment Variables in the Vercel Dashboard matching your `.env`.

**Netlify:**
```bash
netlify deploy --prod --dir=dist
```

**Cloudflare Pages:**
- Build command: `bun run build`
- Build output directory: `dist`

