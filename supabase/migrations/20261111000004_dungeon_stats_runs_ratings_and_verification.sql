-- TRAP//RUN: Migration 004 - Dungeon Stats, Runs, Ratings & Verified Publishing Lifecycle
-- Extends dungeons with on-chain verification metadata, adds stats, runs, ratings, triggers, and RLS

-- 1. Extend dungeons table with dimensions and verified on-chain fields
ALTER TABLE public.dungeons
    ADD COLUMN IF NOT EXISTS width INT NOT NULL DEFAULT 9,
    ADD COLUMN IF NOT EXISTS height INT NOT NULL DEFAULT 9,
    ADD COLUMN IF NOT EXISTS on_chain_tx_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_account_id TEXT,
    ADD COLUMN IF NOT EXISTS on_chain_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS on_chain_verified_at TIMESTAMPTZ;

-- Unique index on on_chain_tx_hash when set to prevent double-spending tx receipts
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeons_on_chain_tx_hash 
    ON public.dungeons (on_chain_tx_hash) 
    WHERE on_chain_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dungeons_verified 
    ON public.dungeons (on_chain_verified, created_at DESC);

-- 2. Dungeon Stats table (authoritative aggregate counters per dungeon)
CREATE TABLE IF NOT EXISTS public.dungeon_stats (
    dungeon_id UUID PRIMARY KEY REFERENCES public.dungeons(id) ON DELETE CASCADE,
    play_count INT NOT NULL DEFAULT 0,
    clear_count INT NOT NULL DEFAULT 0,
    completion_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Dungeon Runs table (individual play attempts)
CREATE TABLE IF NOT EXISTS public.dungeon_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dungeon_id UUID NOT NULL REFERENCES public.dungeons(id) ON DELETE CASCADE,
    player_near_account TEXT,
    result TEXT NOT NULL CHECK (result IN ('win', 'loss')),
    duration_ms INT,
    moves INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dungeon_runs_dungeon_id 
    ON public.dungeon_runs (dungeon_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dungeon_runs_player 
    ON public.dungeon_runs (player_near_account, created_at DESC);

-- 4. Ratings table (community ratings and reviews)
CREATE TABLE IF NOT EXISTS public.ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dungeon_id UUID NOT NULL REFERENCES public.dungeons(id) ON DELETE CASCADE,
    player_near_account TEXT NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_player_dungeon_rating UNIQUE (dungeon_id, player_near_account)
);

CREATE INDEX IF NOT EXISTS idx_ratings_dungeon 
    ON public.ratings (dungeon_id);

-- 5. Trigger: Initialize dungeon_stats upon dungeon insertion
CREATE OR REPLACE FUNCTION public.handle_new_dungeon_stats()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.dungeon_stats (dungeon_id, play_count, clear_count, completion_rate, updated_at)
    VALUES (NEW.id, 0, 0, 0.00, now())
    ON CONFLICT (dungeon_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_init_dungeon_stats ON public.dungeons;
CREATE TRIGGER tr_init_dungeon_stats
    AFTER INSERT ON public.dungeons
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_dungeon_stats();

-- 6. Trigger: Update dungeon_stats upon run insertion
CREATE OR REPLACE FUNCTION public.handle_new_dungeon_run()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_plays INT;
    v_clears INT;
BEGIN
    -- Ensure stats row exists
    INSERT INTO public.dungeon_stats (dungeon_id, play_count, clear_count, completion_rate, updated_at)
    VALUES (NEW.dungeon_id, 0, 0, 0.00, now())
    ON CONFLICT (dungeon_id) DO NOTHING;

    -- Update play and clear counts
    UPDATE public.dungeon_stats
    SET 
        play_count = play_count + 1,
        clear_count = clear_count + (CASE WHEN NEW.result = 'win' THEN 1 ELSE 0 END),
        updated_at = now()
    WHERE dungeon_id = NEW.dungeon_id
    RETURNING play_count, clear_count INTO v_plays, v_clears;

    -- Recalculate completion rate
    IF v_plays > 0 THEN
        UPDATE public.dungeon_stats
        SET completion_rate = ROUND((v_clears::numeric / v_plays::numeric) * 100, 2)
        WHERE dungeon_id = NEW.dungeon_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_update_dungeon_stats ON public.dungeon_runs;
CREATE TRIGGER tr_update_dungeon_stats
    AFTER INSERT ON public.dungeon_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_dungeon_run();

-- 7. Row Level Security Policies
ALTER TABLE public.dungeon_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dungeon_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- dungeon_stats RLS
DROP POLICY IF EXISTS "Dungeon stats are readable by everyone" ON public.dungeon_stats;
CREATE POLICY "Dungeon stats are readable by everyone"
    ON public.dungeon_stats FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Dungeon stats only modifiable by service role" ON public.dungeon_stats;
CREATE POLICY "Dungeon stats only modifiable by service role"
    ON public.dungeon_stats FOR ALL
    USING (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

-- dungeon_runs RLS
DROP POLICY IF EXISTS "Dungeon runs are readable by everyone" ON public.dungeon_runs;
CREATE POLICY "Dungeon runs are readable by everyone"
    ON public.dungeon_runs FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Anyone can record a dungeon run" ON public.dungeon_runs;
CREATE POLICY "Anyone can record a dungeon run"
    ON public.dungeon_runs FOR INSERT
    WITH CHECK (dungeon_id IS NOT NULL);

DROP POLICY IF EXISTS "Dungeon runs cannot be modified by clients" ON public.dungeon_runs;
CREATE POLICY "Dungeon runs cannot be modified by clients"
    ON public.dungeon_runs FOR UPDATE
    USING (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

-- ratings RLS
DROP POLICY IF EXISTS "Ratings are readable by everyone" ON public.ratings;
CREATE POLICY "Ratings are readable by everyone"
    ON public.ratings FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Players can insert their own rating" ON public.ratings;
CREATE POLICY "Players can insert their own rating"
    ON public.ratings FOR INSERT
    WITH CHECK (player_near_account IS NOT NULL);

DROP POLICY IF EXISTS "Players can update their own rating" ON public.ratings;
CREATE POLICY "Players can update their own rating"
    ON public.ratings FOR UPDATE
    USING (
        player_near_account = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'near_account_id', '')
        OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role'
    );

-- 8. Protection of Verified On-Chain Publication Fields
-- Enforces that only service_role (Edge Functions) can set or mutate verified on-chain fields.
-- Any client insert/update attempting to forge on_chain_verified or fake tx hashes is stripped or rejected.
CREATE OR REPLACE FUNCTION public.protect_dungeon_on_chain_fields()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    is_service_role BOOLEAN;
BEGIN
    is_service_role := (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');
    
    IF TG_OP = 'INSERT' THEN
        -- If not service_role, force on-chain verification fields to unverified defaults
        IF NOT is_service_role THEN
            NEW.on_chain_verified := false;
            NEW.on_chain_verified_at := NULL;
            NEW.on_chain_tx_hash := NULL;
            NEW.near_registry_id := NULL;
            NEW.contract_account_id := NULL;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- If not service_role, strictly disallow modifying any verified on-chain fields
        IF NOT is_service_role THEN
            IF NEW.on_chain_verified IS DISTINCT FROM OLD.on_chain_verified
               OR NEW.on_chain_tx_hash IS DISTINCT FROM OLD.on_chain_tx_hash
               OR NEW.near_registry_id IS DISTINCT FROM OLD.near_registry_id
               OR NEW.contract_account_id IS DISTINCT FROM OLD.contract_account_id
               OR NEW.on_chain_verified_at IS DISTINCT FROM OLD.on_chain_verified_at THEN
                RAISE EXCEPTION 'Unauthorized: only service_role can modify on-chain verification fields';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_dungeon_on_chain_fields ON public.dungeons;
CREATE TRIGGER tr_protect_dungeon_on_chain_fields
    BEFORE INSERT OR UPDATE ON public.dungeons
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_dungeon_on_chain_fields();


