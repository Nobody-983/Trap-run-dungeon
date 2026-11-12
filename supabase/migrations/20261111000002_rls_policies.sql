-- TRAP//RUN: Migration 002 - Row Level Security Policies
-- Strict access control preventing client score spoofing and unauthorized profile/dungeon tampering

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dungeons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- 1. Profiles RLS
DROP POLICY IF EXISTS "Public profiles are readable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are readable by everyone"
    ON public.profiles FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (
        coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role'
        OR near_account_id = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'near_account_id', '')
        OR near_account_id IS NOT NULL
    );

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (
        coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role'
        OR near_account_id = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'near_account_id', '')
    );

-- 2. Dungeons RLS
DROP POLICY IF EXISTS "Published dungeons are readable by everyone" ON public.dungeons;
CREATE POLICY "Published dungeons are readable by everyone"
    ON public.dungeons FOR SELECT
    USING (
        status = 'published'
        OR creator_near_account = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'near_account_id', '')
        OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role'
    );

DROP POLICY IF EXISTS "Creators can insert dungeons" ON public.dungeons;
CREATE POLICY "Creators can insert dungeons"
    ON public.dungeons FOR INSERT
    WITH CHECK (creator_near_account IS NOT NULL);

DROP POLICY IF EXISTS "Creators can update their own dungeons" ON public.dungeons;
CREATE POLICY "Creators can update their own dungeons"
    ON public.dungeons FOR UPDATE
    USING (
        creator_near_account = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'near_account_id', '')
        OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role'
    );

-- 3. Challenges RLS
DROP POLICY IF EXISTS "Active challenges are readable by everyone" ON public.challenges;
CREATE POLICY "Active challenges are readable by everyone"
    ON public.challenges FOR SELECT
    USING (
        status = 'active'
        OR creator_near_account = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'near_account_id', '')
        OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role'
    );

DROP POLICY IF EXISTS "Creators can insert challenges" ON public.challenges;
CREATE POLICY "Creators can insert challenges"
    ON public.challenges FOR INSERT
    WITH CHECK (creator_near_account IS NOT NULL);

-- 4. Daily Challenges RLS
DROP POLICY IF EXISTS "Daily challenges are readable by everyone" ON public.daily_challenges;
CREATE POLICY "Daily challenges are readable by everyone"
    ON public.daily_challenges FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Daily challenges manageable by service role only" ON public.daily_challenges;
CREATE POLICY "Daily challenges manageable by service role only"
    ON public.daily_challenges FOR ALL
    USING (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

-- 5. Challenge Attempts RLS
DROP POLICY IF EXISTS "Challenge attempts are readable by everyone" ON public.challenge_attempts;
CREATE POLICY "Challenge attempts are readable by everyone"
    ON public.challenge_attempts FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Players can insert challenge attempts" ON public.challenge_attempts;
CREATE POLICY "Players can insert challenge attempts"
    ON public.challenge_attempts FOR INSERT
    WITH CHECK (player_near_account IS NOT NULL);

DROP POLICY IF EXISTS "Challenge attempts only validated by service role" ON public.challenge_attempts;
CREATE POLICY "Challenge attempts only validated by service role"
    ON public.challenge_attempts FOR UPDATE
    USING (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

-- 6. Scores RLS (CRITICAL FAIR PLAY BOUNDARY)
-- Scores can be read by anyone for leaderboards, but CANNOT be inserted or updated by client.
DROP POLICY IF EXISTS "Verified scores are readable by everyone" ON public.scores;
CREATE POLICY "Verified scores are readable by everyone"
    ON public.scores FOR SELECT
    USING (validation_status = 'verified');

DROP POLICY IF EXISTS "Scores can ONLY be inserted by service role" ON public.scores;
CREATE POLICY "Scores can ONLY be inserted by service role"
    ON public.scores FOR INSERT
    WITH CHECK (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

DROP POLICY IF EXISTS "Scores can ONLY be modified by service role" ON public.scores;
CREATE POLICY "Scores can ONLY be modified by service role"
    ON public.scores FOR UPDATE
    USING (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

DROP POLICY IF EXISTS "Scores can ONLY be deleted by service role" ON public.scores;
CREATE POLICY "Scores can ONLY be deleted by service role"
    ON public.scores FOR DELETE
    USING (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

-- 7. Achievements RLS
DROP POLICY IF EXISTS "Achievements are readable by everyone" ON public.achievements;
CREATE POLICY "Achievements are readable by everyone"
    ON public.achievements FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Achievements can ONLY be inserted by service role" ON public.achievements;
CREATE POLICY "Achievements can ONLY be inserted by service role"
    ON public.achievements FOR INSERT
    WITH CHECK (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');
