# Supabase Backend Architecture & Setup

TRAP//RUN uses Supabase (PostgreSQL with Row Level Security) as its authoritative persistent backend for player profiles, community dungeons, challenges, and verified leaderboard scores.

---

## 1. Schema Entity Relationships

```
┌──────────────┐
│   profiles   │ ◄─── Primary player record (near_account_id)
└──────┬───────┘
       │
       ├─────────────────────────────────────┐
       │ (1:N)                               │ (1:N)
       ▼                                     ▼
┌──────────────┐                      ┌────────────────────┐
│   dungeons   │                      │ challenge_attempts │
└──────┬───────┘                      └─────────┬──────────┘
       │                                        │
       │ (1:N)                                  │
       ▼                                        │
┌──────────────┐                                │
│  challenges  │ ◄──────────────────────────────┤
└──────┬───────┘                                │
       │                                        │
       ▼                                        ▼
┌──────────────┐                      ┌────────────────────┐
│ daily_chal.  │                      │       scores       │ ◄── Verified scores only
└──────────────┘                      └────────────────────┘
```

---

## 2. Table Specifications

### 1. `profiles`
- `id` (UUID, Primary Key)
- `near_account_id` (TEXT, Unique, NOT NULL): Canonical player identity (e.g. `alice.testnet`).
- `username` (TEXT, Unique)
- `display_name` (TEXT)
- `avatar_url` (TEXT)
- `bio` (TEXT)
- `created_at`, `updated_at` (TIMESTAMPTZ)

### 2. `dungeons`
- `id` (TEXT, Primary Key): Slug or UUID.
- `creator_near_account` (TEXT, NOT NULL, FK -> `profiles.near_account_id`)
- `title` (TEXT, NOT NULL)
- `description` (TEXT)
- `dungeon_hash` (TEXT, NOT NULL): SHA-256 canonical hex hash.
- `canonical_format_version` (INT, default 1)
- `serialized_dungeon` (TEXT, NOT NULL): Full serialized format.
- `grid_data` (JSONB, NOT NULL): Layout cells, start point, exit point.
- `par` (INT, NOT NULL): Solver-verified par steps.
- `difficulty` (INT, default 1)
- `status` (TEXT): `'draft'` | `'published'` | `'archived'`.
- `near_registry_id` (BIGINT): On-chain challenge ID if registered on NEAR.
- `created_at`, `updated_at` (TIMESTAMPTZ)

### 3. `challenges`
- `id` (UUID, Primary Key)
- `dungeon_id` (TEXT, NOT NULL, FK -> `dungeons.id`)
- `creator_near_account` (TEXT, NOT NULL)
- `challenge_code` (TEXT, Unique, NOT NULL): TRI1 share code.
- `status` (TEXT): `'active'` | `'expired'` | `'completed'`
- `start_time`, `end_time` (TIMESTAMPTZ)

### 4. `daily_challenges`
- `day` (DATE, Primary Key): UTC date (`YYYY-MM-DD`).
- `dungeon_id` (TEXT, NOT NULL, FK -> `dungeons.id`)
- `title` (TEXT, NOT NULL)
- `par` (INT, NOT NULL)
- `created_at` (TIMESTAMPTZ)

### 5. `challenge_attempts`
- `id` (UUID, Primary Key)
- `challenge_id` (UUID, FK -> `challenges.id`)
- `dungeon_id` (TEXT, NOT NULL, FK -> `dungeons.id`)
- `player_near_account` (TEXT, NOT NULL)
- `attempt_id` (TEXT, Unique, NOT NULL): Idempotency key from client.
- `replay_data` (TEXT, NOT NULL): Action trace string (`"UDLRW..."`).
- `completion_status` (TEXT): `'win'` | `'loss'`
- `completion_time_ms` (INT, NOT NULL)
- `moves` (INT, NOT NULL)
- `validation_status` (TEXT): `'pending'` | `'verified'` | `'rejected'`
- `validation_notes` (TEXT)
- `submitted_at` (TIMESTAMPTZ)
- `validated_at` (TIMESTAMPTZ)

### 6. `scores`
- `id` (UUID, Primary Key)
- `player_near_account` (TEXT, NOT NULL)
- `dungeon_id` (TEXT, NOT NULL)
- `challenge_id` (UUID)
- `attempt_id` (TEXT, FK -> `challenge_attempts.attempt_id`)
- `completion_time_ms` (INT, NOT NULL)
- `moves` (INT, NOT NULL)
- `score` (INT, NOT NULL)
- `validation_status` (TEXT): `'verified'` | `'rejected'`
- `created_at` (TIMESTAMPTZ)

---

## 3. Views & Stored Procedures

### `global_leaderboard` View
Aggregates total score, number of solved dungeons, and best completion time per NEAR account across all verified scores.

### `daily_leaderboard` View
Returns the top players for today's active daily dungeon (`day = CURRENT_DATE`), sorted by highest score, fastest completion time, and fewest moves.

### `get_dungeon_leaderboard(p_dungeon_id, p_limit, p_offset)` Function
Performs ranked leaderboard calculation for any specified dungeon, joining profile avatars and display names with deterministic tie-breaking.

---

## 4. Setup Instructions

1. Link your Supabase CLI to your project:
   ```bash
   supabase link --project-ref <your-project-id>
   ```
2. Apply migrations in order:
   ```bash
   supabase db push
   ```
3. Set frontend environment variables:
   ```env
   VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-key>
   ```
