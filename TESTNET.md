# NEAR testnet pilot handoff

The app and registry are prepared for NEAR testnet. No registry deployment or live transaction is included in this repository state.

## Environment variables

Names only:

- `VITE_NEAR_NETWORK` — must be `testnet`; any other value stops NEAR initialization.
- `VITE_NEAR_REGISTRY_ACCOUNT` — required to enable the NEAR UI; set it to the account where the registry WASM is deployed.
- `VITE_NEAR_RPC_URL` — optional testnet RPC override. The client checks the RPC network ID before reads and writes.
- `VITE_NEAR_STORAGE_DEPOSIT_YOCTO` — optional positive yoctoNEAR storage buffer override.

Existing Arc variables remain independent. Never put a private key, seed phrase, wallet callback secret, or session token in a Vite environment variable.

## Registry deployment boundary

Prerequisites:

1. A funded NEAR testnet account controlled by the operator.
2. Explicit authorization to deploy and sign.
3. The release artifact built from `near/registry`:

```bash
bun run near:registry:test
bun run near:registry:build
```

The resulting artifact is `near/registry/target/wasm32-unknown-unknown/release/trap_run_registry.wasm`. Deploy it to the configured testnet account, then initialize it once with `new` and no arguments. Do not deploy this pilot to mainnet.

After deployment, confirm these final view calls before enabling the UI:

- `get_next_challenge_id` returns a decimal-string U64.
- `get_challenge` returns `null` for an unused positive ID.
- `get_challenges_by_creator` accepts a limit from 1 through 50.

## Wallet and network setup

The frontend supports MyNearWallet through the official NEAR Wallet Selector packages. The connection is separate from the existing Arc wallet and is fixed to testnet. The client verifies that the configured RPC reports `testnet` before wallet or registry operations.

In the app:

1. Open **Challenge a Friend**.
2. Select a saved solver-checked dungeon.
3. In **NEAR registry · TRI1**, connect MyNearWallet.
4. Confirm the displayed account and approve the registration in the wallet popup.

Disconnecting clears the active NEAR session from the app. Gameplay and the Arc/TR1 path continue to work when NEAR is unavailable.

## Storage deposit

`register_challenge` measures the actual persistent storage increase. The caller must attach enough yoctoNEAR to cover it. The frontend attaches a conservative buffer (0.01 NEAR by default), and the contract refunds the excess to `predecessor_account_id`.

An underfunded call fails atomically: no challenge, creator index, counter increment, event, or refund receipt remains. Gas can still be spent on a failed transaction.

## Registration

The frontend hashes the actual gameplay fields (`cells`, `start`, and `exit`) with canonical dungeon identity v1 and sends the exact 32 bytes as `Base64VecU8`. The contract assigns a monotonically increasing U64 challenge ID, records the predecessor as creator, and emits a NEP-297 `challenge_registered` event.

The UI states are:

- wallet approval;
- pending finality;
- success with the final transaction receipt link;
- failure with a user-facing reason.

Success is shown only after the transaction reaches finality, the returned ID is decoded, the challenge is read back, and creator/hash verification passes.

## Retrieval and verification

Paste a `TRI1` code or its app share link into **Join a challenge**. The client:

1. rejects unknown versions, malformed bytes, trailing data, non-testnet contexts, and a registry mismatch;
2. retrieves the challenge by ID at final finality;
3. strictly decodes U64 strings, account ID, schema version, timestamps, and the 32-byte base64 hash;
4. recomputes the canonical hash from the decoded dungeon;
5. compares the stored and local hashes before enabling play.

The connected creator's latest registrations are fetched with bounded pagination (10 entries in the UI; contract maximum 50). Missing challenges are reported as missing, and RPC failures do not stop local gameplay.

Legacy `TR1` codes and Arc contract verification remain unchanged and separate from `TRI1`.

## Expected outcomes

Successful registration:

- wallet shows a testnet call to the configured registry;
- the attached deposit is the configured buffer;
- the final receipt succeeds;
- the returned challenge ID exists and names the connected creator;
- its stored hash matches the shared dungeon;
- a `TRI1` code and share link are available.

Expected failures:

- no registry variable: NEAR controls remain disabled;
- mainnet network setting or RPC: client refuses the operation;
- wallet cancellation: no success is shown;
- insufficient balance/deposit: transaction fails and no challenge is created;
- missing ID, malformed response, wrong registry, wrong schema, or changed dungeon: verification fails and play is blocked for that code.

## Troubleshooting and rollback

- Confirm the registry account and RPC both belong to testnet.
- Run the native tests and release build again before redeployment.
- Increase only `VITE_NEAR_STORAGE_DEPOSIT_YOCTO` if the contract reports an underfunded storage deposit; excess is refunded.
- Check the final receipt and `EVENT_JSON` log before treating an ID as registered.
- If the frontend configuration is wrong, remove `VITE_NEAR_REGISTRY_ACCOUNT` and rebuild. This disables NEAR actions while leaving gameplay and Arc features available.
- The registry records are immutable and have no delete method. Rollback means disabling the frontend configuration or deploying a corrected contract to a new testnet account, then updating the registry variable. Never reuse a mainnet account or silently reinterpret existing IDs.
