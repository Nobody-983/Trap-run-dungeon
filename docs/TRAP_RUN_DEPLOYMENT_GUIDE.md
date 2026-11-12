# TRAP//RUN — Full-Stack Production & Testnet Deployment Guide

This guide details the complete deployment procedure for TRAP//RUN across frontend hosting, Supabase database, Edge Functions, and NEAR smart contracts.

---

## 1. Network & Environment Separation

| Environment | NEAR Network | Registry Contract | Supabase Project |
| :--- | :--- | :--- | :--- |
| **Testnet** | `testnet` | `traprun-registry.testnet` | `cjfammcpgqnidbvuggii` |
| **Mainnet** *(Future)* | `mainnet` | *Requires authorized deployment* | *Requires production instance* |

---

## 2. Frontend Configuration & Deployment

### 2.1 Environment Setup (`.env`)
```env
# NEAR Configuration
VITE_NEAR_NETWORK=testnet
VITE_NEAR_RPC_URL=https://rpc.testnet.fastnear.com
VITE_NEAR_REGISTRY_ACCOUNT=traprun-registry.testnet
VITE_NEAR_STORAGE_DEPOSIT_YOCTO=50000000000000000000000

# Supabase Configuration
VITE_SUPABASE_URL=https://cjfammcpgqnidbvuggii.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sHYtzsQ-2TDpouRm_tdjGA_VJjTMHJP
```

### 2.2 Build Production Bundle
```bash
bun install
bun run build
```
The optimized static build is emitted to `dist/`.

### 2.3 Hosting Options
- **Vercel:**
  ```bash
  vercel --prod
  ```
- **Netlify:**
  ```bash
  netlify deploy --prod --dir=dist
  ```
- **Cloudflare Pages:**
  Deploy folder `dist/` with framework preset `Vite`.

---

## 3. Supabase Database & Migrations

### 3.1 Migration Order
Migrations must be executed chronologically:
1. `supabase/migrations/20261111000001_initial_schema.sql` (Core tables: `profiles`, `dungeons`, `challenges`, `daily_challenges`, `challenge_attempts`, `scores`, `achievements`)
2. `supabase/migrations/20261111000002_rls_policies.sql` (Row Level Security for player and public access)
3. `supabase/migrations/20261111000003_leaderboard_views_and_functions.sql` (Leaderboard views & security-definer helper functions)
4. `supabase/migrations/20261111000004_dungeon_stats_runs_ratings_and_verification.sql` (Dungeon stats, runs, ratings)
5. `supabase/migrations/20261111000005_player_persistence_and_profile_sync.sql` (Atomic `auth_nonces`, economy ledger)

### 3.2 Applying Migrations
Via Supabase CLI:
```bash
supabase link --project-ref cjfammcpgqnidbvuggii
supabase db push
```
*Note: Always inspect migration history with `supabase migration list` before pushing.*

---

## 4. Supabase Edge Functions Deployment

### 4.1 Deploying `verify-publishing`
```bash
supabase functions deploy verify-publishing --project-ref cjfammcpgqnidbvuggii --no-verify-jwt
supabase secrets set --project-ref cjfammcpgqnidbvuggii \
  NEAR_REGISTRY_ACCOUNT=traprun-registry.testnet \
  NEAR_NETWORK=testnet
```

### 4.2 Deploying `sync-profile`
```bash
supabase functions deploy sync-profile --project-ref cjfammcpgqnidbvuggii --no-verify-jwt
supabase secrets set --project-ref cjfammcpgqnidbvuggii \
  SYNC_RECIPIENT=traprun.testnet \
  NEAR_REGISTRY_CONTRACT=traprun-registry.testnet
```

---

## 5. Rollback & Emergency Procedures

1. **Frontend Rollback:** Revert deployment in Vercel/Netlify dashboard to previous deployment instant hash.
2. **Contract State Emergency:**
   - Unpublishing: The creator (or owner) can call `unpublish_dungeon(dungeon_id)` to hide a compromised or broken layout from the community catalog.
   - Ownership Transfer: The contract owner can be transferred via `set_owner(new_owner)` by calling the method from the current owner account.

