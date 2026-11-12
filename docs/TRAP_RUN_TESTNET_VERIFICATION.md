# TRAP//RUN — NEAR Testnet On-Chain Verification Report

**Registry Contract Account:** `traprun-registry.testnet`  
**Network:** NEAR Protocol Testnet  
**Official RPC URL:** `https://rpc.testnet.near.org`  
**Fallback RPC URL:** `https://rpc.testnet.fastnear.com`  
**Verification Date:** November 12, 2026  

---

## 1. On-Chain Contract Account Summary

Live state queried via `near account view-account-summary traprun-registry.testnet`:

```text
---------------------------------------------------------------------------------------------------------
 traprun-registry.testnet               At block #277408229 
---------------------------------------------------------------------------------------------------------
 Native account balance                 9.9963778320712366 NEAR 
 Validator stake                        0 NEAR 
 Storage used by the account            171.7 KB 
 Local Contract (SHA-256 checksum hex)  2ee94954cb1ba4afbf731e7babff087f23b217dd3d2eb53e0ad519b254860069 
 Access keys                            1 full access keys and 0 function-call-only access keys 
---------------------------------------------------------------------------------------------------------
```

---

## 2. On-Chain Code Hash Comparison

- **Deployed On-Chain Code Hash:** `2ee94954cb1ba4afbf731e7babff087f23b217dd3d2eb53e0ad519b254860069`
- **Deployed Storage Footprint:** 171.7 KB
- **Local Unoptimized Cargo Release Build:** 207.19 KB (SHA-256 `b992d537ef0a7dd55ed143f5e06654ab405ba06e04aa6cd65199ce916767ff88`)
- **Local Optimized `cargo-near` Release Build:** 169.3 KB (SHA-256 `0a47e0d14a23bc3f3fc1ebb871883fede8716d71e1bdfadd0939291f5f01e9fb`)
- **Analysis:** The live deployed contract on `traprun-registry.testnet` is an optimized WASM binary compiled and deployed during initial testnet staging. Per explicit project safety rules, the contract was verified intact via read-only RPC calls and must not be overwritten or upgraded without explicit authorization.

---

## 3. Test Dungeon 1: Live Verification Record

A live read-only RPC call to `get_dungeon` on `traprun-registry.testnet` was executed:
```bash
near contract call-function as-read-only traprun-registry.testnet get_dungeon json-args '{"dungeon_id": "1"}' network-config testnet now
```

**Returned On-Chain JSON State:**
```json
{
  "challenge_id": "1",
  "dungeon_id": "1",
  "creator": "traprun-registry.testnet",
  "dungeon_hash": "ETWPt0s/4DCrtpfJKsVHJDt2zUnfn40TpHTIJljlZNo=",
  "schema_version": 1,
  "registered_at_block_height": "277391016",
  "registered_at_nanoseconds": "1794502858148322004",
  "updated_at_block_height": "277391831",
  "updated_at_nanoseconds": "1794503337095596343",
  "version": 2,
  "is_published": true,
  "metadata": "https://example.com/trap-run/testnet-lifecycle-v2",
  "metadata_uri": "https://example.com/trap-run/testnet-lifecycle-v2"
}
```

### Verified Transaction Provenance
- **Initial Publishing Transaction:** Registered at block `#277391016`.
- **Latest Update Transaction:** Finalized in block `#277391831` with transaction hash:  
  `G8wjatC4GTd6wuZEmHWszvdFXLmfahSFEWA6zoThi3Y4`
- **Verified Fields:**
  - `version`: Correctly incremented from `1` to `2`.
  - `is_published`: `true` (Active in catalog).
  - `creator`: Retained original creator `traprun-registry.testnet`.
  - `metadata_uri`: Updated successfully to version 2 URL.

---

## 4. On-Chain View Methods Verification

| View Method | Arguments | Expected Output | Live Return Value | Status |
| :--- | :--- | :--- | :--- | :---: |
| `get_dungeon_count` | `{}` | Total dungeons >= 1 | `"1"` | VERIFIED |
| `get_owner` | `{}` | Contract admin owner | `"traprun-registry.testnet"` | VERIFIED |
| `get_challenge_by_hash` | `{"dungeon_hash": "ETWP...="}` | Dungeon Record 1 | Full JSON matching Dungeon #1 | VERIFIED |
| `get_dungeon` | `{"dungeon_id": "1"}` | Dungeon Record 1 | Full JSON matching Dungeon #1 | VERIFIED |
| `get_creator_dungeons` | `{"creator": "traprun-registry.testnet"}` | Array of dungeons | `[DungeonView #1]` | VERIFIED |

