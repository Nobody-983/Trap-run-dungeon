-- TRAP//RUN: Migration 005 - Player Persistence and Profile Cloud Synchronization
-- Extends profiles table with progression, economy, inventory, cosmetics, streaks, bests, and clears

-- 1. Extend profiles table with player progression fields
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS xp INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS coins INT NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS economy_ledger JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS inventory JSONB NOT NULL DEFAULT '{"healthPotions": 1, "fullElixirs": 0, "energyCells": 0}'::jsonb,
    ADD COLUMN IF NOT EXISTS equipped JSONB NOT NULL DEFAULT '{"skin": "runner-default", "trail": "trail-classic"}'::jsonb,
    ADD COLUMN IF NOT EXISTS unlocked JSONB NOT NULL DEFAULT '["runner-default", "trail-classic"]'::jsonb,
    ADD COLUMN IF NOT EXISTS stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS streak JSONB NOT NULL DEFAULT '{"current": 0, "best": 0, "last": null}'::jsonb,
    ADD COLUMN IF NOT EXISTS bests JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS clears JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Indexes for sorting and profile lookup
CREATE INDEX IF NOT EXISTS idx_profiles_xp ON public.profiles (xp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_coins ON public.profiles (coins DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_near_account ON public.profiles (near_account_id);

-- 3. Authentication Nonces Table (Anti-Replay Protection for NEAR Wallet Signature Verification)
CREATE TABLE IF NOT EXISTS public.auth_nonces (
    nonce TEXT PRIMARY KEY,
    near_account_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth nonces only manageable by service role" ON public.auth_nonces;
CREATE POLICY "Auth nonces only manageable by service role"
    ON public.auth_nonces FOR ALL
    USING (coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role');

-- Prune expired nonces function (runs with SECURITY DEFINER and safe search_path)
CREATE OR REPLACE FUNCTION public.prune_expired_nonces()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM public.auth_nonces
    WHERE created_at < (now() - interval '10 minutes');
END;
$$;

-- 4. RLS Policy Enforcement: Strictly prevent unauthorized profile mutations
-- Drops any insecure or overly permissive policies.
-- Profiles may only be updated by the service_role (via verified sync-profile Edge Function)
-- or by an authenticated Supabase JWT matching the specific near_account_id.
DROP POLICY IF EXISTS "Players can update their own progression" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (
        coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role'
        OR near_account_id = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'near_account_id', '')
    );


