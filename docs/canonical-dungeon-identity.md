# TRAP//RUN canonical dungeon identity v1

Status: stable for NEAR Milestone 1. This specification is additive. It does not replace the legacy `TR1` share code, `layoutId`, room code, Arc Keccak dungeon hash, or deployed Arc contract behavior.

## 1. Existing model and identity inputs

The runtime `Dungeon` model contains `id`, `name`, `cells`, `start`, `exit`, `creator`, `source`, optional `par`, `difficulty`, and `createdAt` (`src/game/types.ts`). Only the following fields directly define the current turn-by-turn dungeon rules:

- `cells`: exactly 81 cells in row-major order, `index = y * 9 + x`;
- `start`: initial player coordinate;
- `exit`: winning coordinate.

Hazard timing and behavior are fixed by game/schema code rather than per-dungeon fields. `par` is derived by the solver. `difficulty` affects XP and presentation, not movement or collision rules.

The existing identities are not suitable as a cross-language canonical standard:

- `layoutKey` is an unversioned JavaScript string;
- `layoutId` and room codes use a 32-bit non-cryptographic FNV-derived value;
- the deployed Arc hash is Keccak-256 of the legacy `layoutKey` string;
- `TR1` nibble-packs layout data but carries unverified display metadata and an optional decimal Arc challenge ID;
- none of those formats includes a chain, network, registry contract, or schema domain.

All legacy paths remain unchanged for Arc compatibility.

## 2. Identity layers

### Dungeon identity

A dungeon identity represents gameplay geometry only. It is independent of chain, network, registry, creator, challenge, and display metadata.

```text
dungeon_hash = SHA-256(
  ASCII("TRAPRUN:DUNGEON\\0") || canonical_dungeon_bytes_v1
)
```

### Challenge identity

A challenge identity represents one registry challenge for one dungeon. It includes the registry domain and challenge ID.

```text
challenge_hash = SHA-256(
  ASCII("TRAPRUN:CHALLENGE\\0") || canonical_challenge_bytes_v1
)
```

Two challenges can therefore reference the same dungeon hash while having different challenge identities.

## 3. Included and excluded fields

| Field | Dungeon hash | Challenge hash/share | Reason |
|---|---:|---:|---|
| Schema version | Yes | Yes | Binds interpretation and tile rules |
| 81 row-major cells | Yes | Via dungeon hash/payload | Defines geometry and hazards |
| Start coordinate | Yes | Via dungeon hash/payload | Defines initial state |
| Exit coordinate | Yes | Via dungeon hash/payload | Defines win condition |
| Chain identifier | No | Yes | Registry domain separation |
| Network identifier | No | Yes | Prevents testnet/mainnet ambiguity |
| Registry contract identifier | No | Yes | Prevents registry substitution |
| Challenge ID | No | When present | Identifies one challenge record |
| `par` | No | No | Must be recomputed by the versioned solver |
| `difficulty` | No | No | Reward/presentation metadata, not movement rules |
| Dungeon name | No | No | Volatile display metadata |
| Creator display name/profile ID | No | No | Volatile and not cryptographic identity |
| Local dungeon ID | No | No | Device/application bookkeeping |
| Source | No | No | Provenance metadata |
| Timestamp | No | No | Volatile metadata |

If a future ruleset adds per-dungeon gameplay parameters, it must introduce a new canonical dungeon schema version.

## 4. Canonical dungeon bytes v1

All integers are unsigned and big-endian. Every current integer occupies one byte. No JSON, object keys, separators, locale conversion, or platform-native integer encoding is used.

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | ASCII magic `TRDG` |
| 4 | 1 | Schema version, `0x01` |
| 5 | 1 | Width, `0x09` |
| 6 | 1 | Height, `0x09` |
| 7 | 1 | Start X, 0–8 |
| 8 | 1 | Start Y, 0–8 |
| 9 | 1 | Exit X, 0–8 |
| 10 | 1 | Exit Y, 0–8 |
| 11 | 81 | Tile codes in row-major order |

Total length: 92 bytes.

### Tile codes

| Code | Tile |
|---:|---|
| 0 | `empty` |
| 1 | `wall` |
| 2 | `spike` |
| 3 | `pulse` |
| 4 | `sentryH` |
| 5 | `sentryV` |
| 6 | `key` |
| 7 | `door` |
| 8 | `switch` |
| 9 | `gate` |

Codes may never be reordered or reused. A new tile requires a schema decision: add a previously unused code if v1 semantics remain unambiguous, or preferably introduce v2 when rules change.

## 5. Registry identifiers and Unicode

`chain`, `network`, and `registry` are canonical protocol identifiers, not display strings.

- They must already be lowercase ASCII.
- Allowed bytes are `a-z`, `0-9`, `.`, `_`, `:`, and `-`.
- The first byte must be `a-z` or `0-9`.
- `chain` and `network` are limited to 32 bytes each.
- `registry` is limited to 128 bytes.
- No case folding, trimming, Unicode normalization, or locale conversion is performed.
- Unicode is rejected rather than normalized.

Human-readable Unicode names remain outside the canonical identity and may be transported separately by future UI/backend layers.

## 6. Canonical challenge bytes v1

| Field order | Encoding |
|---|---|
| Magic | ASCII `TRCH` |
| Version | u8 `1` |
| Chain | u8 byte length, then ASCII bytes |
| Network | u8 byte length, then ASCII bytes |
| Registry | u16 big-endian byte length, then ASCII bytes |
| Challenge ID | u64 big-endian, range 1 to 2^64−1 |
| Dungeon hash | 32 raw SHA-256 bytes |

The challenge ID is represented as `bigint` in TypeScript and `u64` in Rust. It must not pass through a JavaScript `number` because large values would lose precision.

## 7. Share code v1

The textual form is:

```text
TRI1.<unpadded-base64url(binary-envelope)>
```

`TRI1` is deliberately distinct from legacy `TR1` Arc share codes.

Binary envelope field order:

| Field order | Encoding |
|---|---|
| Magic | ASCII `TRSC` |
| Share version | u8 `1` |
| Kind | u8: `0` dungeon reference, `1` challenge |
| Chain | u8 length + ASCII bytes |
| Network | u8 length + ASCII bytes |
| Registry | u16 big-endian length + ASCII bytes |
| Dungeon | Exact 92 canonical dungeon bytes |
| Challenge ID | u64 big-endian, present only when kind is `1` |

Base64url uses `A-Z`, `a-z`, `0-9`, `-`, and `_`, with no `=` padding. Decoders must reject noncanonical encodings, unknown versions/kinds, truncated data, and trailing bytes.

### Null and optional values

Null bytes or textual `null` values do not exist in the binary format.

- Omitted or explicit `null` `challengeId` produces kind `0` and no challenge-ID bytes.
- A present challenge ID produces kind `1` and exactly eight challenge-ID bytes.
- Chain, network, registry, dungeon, start, and exit are mandatory.

## 8. Object and array ordering

Input object property order is irrelevant. Implementations read named fields and emit them in the field order defined above.

Cell array order is significant and must be row-major:

```text
index = y * 9 + x
```

Reordering the cells changes the dungeon identity.

## 9. Invalid input

Canonicalization must reject:

- unsupported schema/share versions;
- a cell count other than 81;
- unknown tile names/codes;
- noninteger or out-of-range coordinates;
- identical start and exit coordinates;
- a nonempty start or exit cell;
- empty, uppercase, Unicode, oversized, or otherwise invalid registry identifiers;
- challenge ID zero or values above u64;
- malformed/noncanonical base64url;
- truncated or trailing share bytes.

Solvability, editor budget, and piece-count limits remain application validation performed by `validateDungeon`. They are intentionally not recomputed by the identity codec or future registry contract.

### Valid and invalid examples

| Input | Result |
|---|---|
| 81 known tile codes, start `(0,8)`, exit `(8,0)`, both endpoint cells empty | Valid dungeon input |
| The same named fields supplied in a different JavaScript object-property order | Valid; produces identical bytes and hash |
| 80 or 82 cells | Invalid; the layout must contain exactly 81 row-major cells |
| Start `(-1,0)`, exit `(9,0)`, or any fractional coordinate | Invalid; coordinates must be integer values from 0 through 8 |
| Start and exit both `(0,0)` | Invalid; endpoints must differ |
| `chain = "NEAR"` or `registry = "régistry.testnet"` | Invalid; protocol identifiers must already be lowercase ASCII |
| Omitted `challengeId` or explicit `null` | Valid dungeon-reference share; kind `0`, no u64 bytes |
| `challengeId = 42` | Valid challenge share; kind `1`, u64 big-endian `000000000000002a` |
| `challengeId = 0` or `2^64` | Invalid; challenge IDs are in the inclusive range 1 through `2^64-1` |
| Share/dungeon version `2` presented to a v1-only decoder | Invalid; unknown versions are rejected explicitly |

## 10. Cross-language test vector

The authoritative machine-readable fixture is `test-vectors/canonical-dungeon-v1.txt`. Both the TypeScript and Rust tests consume that same file.

Fixture layout tile digits:

```text
000000000012345678900000000000000000000000000000000000000000000000000000000000000
```

Start `(0,8)`, exit `(8,0)`, chain `near`, network `testnet`, registry `trap-run-registry.testnet`, challenge ID `42`.

Canonical dungeon bytes, lowercase hex:

```text
5452444701090900080800000000000000000000000102030405060708090000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

Dungeon hash:

```text
7f0f64fb4b105e56eca43c6d67f542a7dd8575949b71f53c8a67db39d0795641
```

Dungeon-reference share code:

```text
TRI1.VFJTQwEABG5lYXIHdGVzdG5ldAAZdHJhcC1ydW4tcmVnaXN0cnkudGVzdG5ldFRSREcBCQkACAgAAAAAAAAAAAAAAAECAwQFBgcICQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Challenge share code:

```text
TRI1.VFJTQwEBBG5lYXIHdGVzdG5ldAAZdHJhcC1ydW4tcmVnaXN0cnkudGVzdG5ldFRSREcBCQkACAgAAAAAAAAAAAAAAAECAwQFBgcICQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACo
```

Challenge hash:

```text
2a9ee2f1dcdfe24fd58f14ba11edcf8070283602377f524f849720b2db0bedaa
```

Changing cell 40 from empty to spike changes the dungeon hash to:

```text
af4cfe6f0658219492fb1b65d7b40596cb627533ae86f148f2e30509cc9196d5
```

## 11. Future NEAR contract verification

The registry contract should:

1. accept a 32-byte dungeon hash produced by this specification;
2. key registrations by `predecessor_account_id` and dungeon hash;
3. allocate a u64 challenge ID;
4. store the creator account and dungeon hash;
5. emit the schema version, challenge ID, and dungeon hash in a structured event;
6. expose view methods returning the exact stored 32 bytes;
7. reject unsupported identity versions rather than interpreting them as v1.

The contract does not need to receive or solve the 92-byte dungeon payload. A client or backend decodes the `TRI1` code, recomputes the SHA-256 dungeon hash, reads the registry challenge, and compares the stored hash and registry context.

For near-sdk, SHA-256 should use the host hashing function rather than a custom implementation. The dependency-free Rust file in `scripts/canonical_identity_compat.rs` exists only as an independently compiled compatibility reference for this milestone.

## 12. Versioning rules

- V1 bytes and meanings are immutable after this milestone.
- New interpretations require a new schema version and share prefix/version handling.
- Decoders must never silently treat an unknown version as the latest version.
- Legacy `TR1` and Arc Keccak identifiers remain separate namespaces and are not convertible merely by relabeling their hashes.
