-- TRAP//RUN: Migration 001 - Initial Schema
-- Entities: profiles, dungeons, challenges, daily_challenges, challenge_attempts, scores, achievements

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles (NEAR account ID as canonical identity)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    near_account_id TEXT UNIQUE NOT NULL,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Dungeons (canonical format v1, 9x9 grid, deterministic SHA-256 hash)
CREATE TABLE IF NOT EXISTS public.dungeons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_near_account TEXT NOT NULL REFERENCES public.profiles(near_account_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    dungeon_hash TEXT UNIQUE NOT NULL,
    canonical_format_version INT NOT NULL DEFAULT 1,
    serialized_dungeon TEXT NOT NULL,
    grid_data JSONB NOT NULL,
    par INT NOT NULL,
    difficulty INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    near_registry_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Challenges (shareable dungeon challenges)
CREATE TABLE IF NOT EXISTS public.challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dungeon_id UUID NOT NULL REFERENCES public.dungeons(id) ON DELETE CASCADE,
    creator_near_account TEXT NOT NULL REFERENCES public.profiles(near_account_id) ON DELETE CASCADE,
    challenge_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'completed')),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Daily Challenges (UTC calendar date selection)
CREATE TABLE IF NOT EXISTS public.daily_challenges (
    day DATE PRIMARY KEY,
    dungeon_id UUID NOT NULL REFERENCES public.dungeons(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    par INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Challenge Attempts (records player action logs for server-side verification)
CREATE TABLE IF NOT EXISTS public.challenge_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID REFERENCES public.challenges(id) ON DELETE CASCADE,
    dungeon_id UUID NOT NULL REFERENCES public.dungeons(id) ON DELETE CASCADE,
    player_near_account TEXT NOT NULL REFERENCES public.profiles(near_account_id) ON DELETE CASCADE,
    attempt_id TEXT NOT NULL,
    replay_data TEXT NOT NULL,
    completion_status TEXT NOT NULL CHECK (completion_status IN ('win', 'loss')),
    completion_time_ms INT NOT NULL,
    moves INT NOT NULL,
    validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'verified', 'rejected')),
    validation_notes TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    validated_at TIMESTAMPTZ,
    CONSTRAINT unique_player_attempt UNIQUE (player_near_account, attempt_id)
);

-- 6. Authoritative Scores (verified by server replay simulation only)
CREATE TABLE IF NOT EXISTS public.scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_near_account TEXT NOT NULL REFERENCES public.profiles(near_account_id) ON DELETE CASCADE,
    dungeon_id UUID NOT NULL REFERENCES public.dungeons(id) ON DELETE CASCADE,
    challenge_id UUID REFERENCES public.challenges(id) ON DELETE SET NULL,
    attempt_id UUID UNIQUE REFERENCES public.challenge_attempts(id) ON DELETE SET NULL,
    completion_time_ms INT NOT NULL,
    moves INT NOT NULL,
    score INT NOT NULL,
    validation_status TEXT NOT NULL DEFAULT 'verified' CHECK (validation_status IN ('verified', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Achievements (unlocked achievements with verification reference)
CREATE TABLE IF NOT EXISTS public.achievements (
    id TEXT NOT NULL,
    player_near_account TEXT NOT NULL REFERENCES public.profiles(near_account_id) ON DELETE CASCADE,
    verification_reference TEXT,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, player_near_account)
);

-- Foreign Key & Query Performance Indexes
CREATE INDEX IF NOT EXISTS idx_dungeons_creator ON public.dungeons (creator_near_account);
CREATE INDEX IF NOT EXISTS idx_challenges_dungeon ON public.challenges (dungeon_id);
CREATE INDEX IF NOT EXISTS idx_challenges_creator ON public.challenges (creator_near_account);
CREATE INDEX IF NOT EXISTS idx_attempts_player ON public.challenge_attempts (player_near_account);
CREATE INDEX IF NOT EXISTS idx_attempts_dungeon ON public.challenge_attempts (dungeon_id);
CREATE INDEX IF NOT EXISTS idx_scores_player ON public.scores (player_near_account);
CREATE INDEX IF NOT EXISTS idx_scores_dungeon ON public.scores (dungeon_id);

