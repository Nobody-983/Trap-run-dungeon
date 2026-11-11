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
near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm
```

**Artifact Properties:**
- **Binary Size:** 154,985 bytes
- **SHA-256 Checksum:** `21d87595178bc938f632329439c84c7ced0b36ac80819b3c22dffdb179addeb6`

### Step 2: Deploy to NEAR Testnet
Using `near-cli-rs`:
```bash
# 1. Login with your testnet account if not already authenticated
near account login network-config testnet

# 2. Deploy the WASM artifact to your testnet account (e.g. traprun-registry.testnet)
near contract deploy traprun-registry.testnet \
  use-file near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm \
  without-init-call \
  network-config testnet \
  sign-with-keychain \
  send
```

### Step 3: Verify Deployed Contract State
Test view calls against the deployed contract:
```bash
near contract call-as-read-only traprun-registry.testnet get_challenge_count \
  network-config testnet \
  now
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

You can apply them using the Supabase CLI or SQL Editor:

**Via Supabase CLI:**
```bash
# Link project
supabase link --project-ref <your-project-ref>

# Push all migrations
supabase db push
```

**Via Supabase Web Console:**
Open the **SQL Editor** in Supabase and paste the contents of the migration files in numerical order (`000001`, `000002`, `000003`).

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
VITE_NEAR_RPC_URL=https://rpc.testnet.near.org

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
