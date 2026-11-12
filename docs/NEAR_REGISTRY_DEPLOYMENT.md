# TRAP//RUN — NEAR Testnet Deployment Runbook

**WASM Artifact:** `near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm`  
**Binary Size:** 207,190 bytes (~202 KB)  
**SHA-256 Digest:** `b992d537ef0a7dd55ed143f5e06654ab405ba06e04aa6cd65199ce916767ff88`  
**Status:** Built and Verified Locally. **Awaiting User Deployment Authorization.**

---

## 1. Prerequisites

1. Install `near-cli-rs` (or standard `near-cli`):
   ```bash
   npm install -g near-cli
   # or
   cargo install near-cli-rs
   ```
2. A NEAR Testnet Account with at least 5 NEAR balance to cover account creation, contract storage staking, and initial execution gas.
   - You can create a testnet account via [MyNearWallet](https://testnet.mynearwallet.com) or [NEAR CLI](https://docs.near.org/tools/near-cli).

---

## 2. Compilation Verification

Before deploying, ensure the release binary is strictly compiled:
```bash
cargo build --manifest-path near/registry/Cargo.toml --target wasm32-unknown-unknown --release
sha256sum near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm
```
Expected output matches: `b992d537ef0a7dd55ed143f5e06654ab405ba06e04aa6cd65199ce916767ff88`.

---

## 3. Deployment Steps

### Step 3.1: Log in with Deployer Account
```bash
near login
```

### Step 3.2: Create Subaccount for Contract (Recommended)
Assuming master account `traprun.testnet`:
```bash
near create-account registry.traprun.testnet --masterAccount traprun.testnet --initialBalance 4
```

### Step 3.3: Deploy WASM Artifact
```bash
near deploy --accountId registry.traprun.testnet \
  --wasmFile near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm
```

### Step 3.4: Initialize Contract State
Call `init` with the intended contract admin account:
```bash
near call registry.traprun.testnet init '{"owner_id": "traprun.testnet"}' --accountId registry.traprun.testnet
```

### Step 3.5: Smoke Test Contract Views
```bash
# Verify owner
near view registry.traprun.testnet get_owner '{}'

# Verify dungeon count starts at 0
near view registry.traprun.testnet get_dungeon_count '{}'

# Verify next dungeon id is 1
near view registry.traprun.testnet get_next_dungeon_id '{}'
```

---

## 4. Frontend & Backend Environment Configuration

Once deployed, set the deployed contract address across the application stack:

### 4.1 Frontend Environment (`.env`)
```env
VITE_NEAR_NETWORK=testnet
VITE_NEAR_REGISTRY_ACCOUNT=registry.traprun.testnet
```

### 4.2 Supabase Edge Functions Secrets
In Supabase dashboard or via CLI:
```bash
supabase secrets set NEAR_REGISTRY_ACCOUNT=registry.traprun.testnet NEAR_NETWORK=testnet
```

---

## 5. Security & Operation Guidelines

1. **Storage Depletion:** The contract retains the exact yoctoNEAR cost for on-chain state growth and refunds the rest. The deployer account should maintain a small buffer (1-2 NEAR) to handle contract-level rent safety.
2. **Key Rotation:** If administrative keys require rotation, use `set_owner` via the current owner account:
   ```bash
   near call registry.traprun.testnet set_owner '{"new_owner": "new_treasury.testnet"}' --accountId traprun.testnet
   ```
3. **No Admin Publishing Override:** The contract does not permit admins to tamper with, edit, or delete player dungeons. Authorship and publishing lifecycle belong solely to the creator account.

