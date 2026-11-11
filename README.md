# TRAP//RUN

A dungeon-building and escape game for the browser. Build a 9x9 dungeon of traps, doors and switches, then race to escape dungeons made by the game, the daily challenge, or your friends.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Practice: 12 handmade dungeons that get harder as you go.
- Daily Challenge: one dungeon per day for everyone, with a streak.
- Challenge a Friend: preserve Arc `TR1` challenges or register and verify canonical `TRI1` challenge hashes on NEAR testnet.
- Creator Mode: 30 second build clock, resource budget, test run, and a solver check so every published dungeon can be escaped.
- XP, levels, best times, achievements and unlockable cosmetics, all earned through play.
- Wallet sign-up and sign-in on Arc Testnet (guests can still play). Each run costs 1 health: 5 free per day, +2 for clearing the daily challenge, more from the shop.
- Shop: buy health packs and cosmetic skins with test USDC. Creators pay a small USDC fee to publish a dungeon and to create a friend challenge; friends play free.
- Keyboard, touch pad and swipe controls, sound effects, replays of your runs.

The game is fully playable with no wallet. MyNearWallet can be connected separately for the NEAR testnet challenge registry; Stellar remains a mock adapter.

## Tech stack

React, TypeScript, Vite, Tailwind CSS, wagmi and viem, canvas rendering, Web Audio, Solidity (Foundry) for the shop contract in `contracts/`.

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
bun run dev      # start the dev server
bun run check    # lint and typecheck
bun scripts/verify-levels.ts   # solve every built-in level
bun run identity:test:ts       # canonical identity TypeScript vectors
bun run identity:test:rust     # independent Rust compatibility vectors
bun run near:registry:test     # native NEAR registry tests
bun run near:registry:build    # release WASM
bun run near:registry:client-test
```

The versioned dungeon identity and future NEAR share-code specification is documented in `docs/canonical-dungeon-identity.md`. It is separate from the deployed Arc contract's legacy hash and `TR1` share codes.

### Environment variables

- `VITE_SHOP_ADDRESS`: address of the deployed `TrapRunShop` contract on Arc Testnet (public). Shop features are switched off while it is unset.
- `VITE_NETWORK`: set to `mainnet` to use Arc mainnet. Leave unset for testnet.
- `VITE_SHOP_ADDRESS_MAINNET`: address of the `TrapRunShop` contract on Arc mainnet (public). Only read when `VITE_NETWORK=mainnet`.
- `VITE_NEAR_NETWORK`: must be `testnet` for the pilot.
- `VITE_NEAR_REGISTRY_ACCOUNT`: deployed NEAR testnet registry account (public). NEAR controls are disabled while unset.
- `VITE_NEAR_RPC_URL`: optional NEAR testnet RPC override.
- `VITE_NEAR_STORAGE_DEPOSIT_YOCTO`: optional positive storage-deposit buffer in yoctoNEAR.

See `TESTNET.md` for the deployment boundary and verification procedure.

For Arc mainnet, follow `docs/mainnet-launch.md`. The NEAR pilot remains testnet-only.
