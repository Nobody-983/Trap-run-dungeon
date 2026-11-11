-- TRAP//RUN: Migration 003 - Performance Indexes, Views, and Leaderboard Queries
-- Consistent ranking: Higher score DESC -> Lower completion_time_ms ASC -> Lower moves ASC -> Earlier created_at ASC

-- 1. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_dungeons_hash ON public.dungeons (dungeon_hash);
CREATE INDEX IF NOT EXISTS idx_dungeons_creator ON public.dungeons (creator_near_account);
CREATE INDEX IF NOT EXISTS idx_challenges_code ON public.challenges (challenge_code);
CREATE INDEX IF NOT EXISTS idx_challenges_dungeon ON public.challenges (dungeon_id);
CREATE INDEX IF NOT EXISTS idx_scores_dungeon_ranking ON public.scores (dungeon_id, score DESC, completion_time_ms ASC, moves ASC);
CREATE INDEX IF NOT EXISTS idx_scores_player ON public.scores (player_near_account);
CREATE INDEX IF NOT EXISTS idx_scores_created_at ON public.scores (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_player_dungeon ON public.challenge_attempts (player_near_account, dungeon_id);

-- 2. View: Global Leaderboard (Personal Best per player aggregated by total score)
CREATE OR REPLACE VIEW public.global_leaderboard AS
WITH player_bests AS (
    SELECT DISTINCT ON (player_near_account, dungeon_id)
        player_near_account,
        dungeon_id,
        score,
        completion_time_ms,
        moves,
        created_at
    FROM public.scores
    WHERE validation_status = 'verified'
    ORDER BY player_near_account, dungeon_id, score DESC, completion_time_ms ASC, moves ASC, created_at ASC
),
player_totals AS (
    SELECT
        pb.player_near_account,
        COALESCE(p.display_name, pb.player_near_account) AS display_name,
        p.avatar_url,
        SUM(pb.score)::INT AS total_score,
        COUNT(pb.dungeon_id)::INT AS dungeons_cleared,
        MIN(pb.completion_time_ms)::INT AS best_time_ms
    FROM player_bests pb
    LEFT JOIN public.profiles p ON p.near_account_id = pb.player_near_account
    GROUP BY pb.player_near_account, p.display_name, p.avatar_url
)
SELECT
    ROW_NUMBER() OVER (ORDER BY total_score DESC, dungeons_cleared DESC, best_time_ms ASC) AS rank,
    player_near_account,
    display_name,
    avatar_url,
    total_score,
    dungeons_cleared,
    best_time_ms
FROM player_totals;

-- 3. View: Daily Challenge Leaderboard (for today's UTC daily challenge)
CREATE OR REPLACE VIEW public.daily_leaderboard AS
WITH today_challenge AS (
    SELECT dungeon_id, day
    FROM public.daily_challenges
    WHERE day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::DATE
)
SELECT
    ROW_NUMBER() OVER (ORDER BY s.score DESC, s.completion_time_ms ASC, s.moves ASC, s.created_at ASC) AS rank,
    s.id AS score_id,
    s.player_near_account,
    COALESCE(p.display_name, s.player_near_account) AS display_name,
    p.avatar_url,
    s.score,
    s.completion_time_ms,
    s.moves,
    s.created_at
FROM public.scores s
JOIN today_challenge tc ON s.dungeon_id = tc.dungeon_id
LEFT JOIN public.profiles p ON p.near_account_id = s.player_near_account
WHERE s.validation_status = 'verified'
ORDER BY s.score DESC, s.completion_time_ms ASC, s.moves ASC, s.created_at ASC;

-- 4. Function: Paginated Dungeon Leaderboard
CREATE OR REPLACE FUNCTION public.get_dungeon_leaderboard(
    p_dungeon_id UUID,
    p_limit INT DEFAULT 20,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    rank BIGINT,
    player_near_account TEXT,
    display_name TEXT,
    avatar_url TEXT,
    score INT,
    completion_time_ms INT,
    moves INT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        ROW_NUMBER() OVER (ORDER BY s.score DESC, s.completion_time_ms ASC, s.moves ASC, s.created_at ASC) AS rank,
        s.player_near_account,
        COALESCE(p.display_name, s.player_near_account) AS display_name,
        p.avatar_url,
        s.score,
        s.completion_time_ms,
        s.moves,
        s.created_at
    FROM public.scores s
    LEFT JOIN public.profiles p ON p.near_account_id = s.player_near_account
    WHERE s.dungeon_id = p_dungeon_id
      AND s.validation_status = 'verified'
    ORDER BY s.score DESC, s.completion_time_ms ASC, s.moves ASC, s.created_at ASC
    LIMIT LEAST(p_limit, 50)
    OFFSET GREATEST(p_offset, 0);
$$;
