import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

void describe('Supabase Migrations Security & Idempotency Audit', () => {
  const migrationsDir = path.resolve(import.meta.dirname, '../supabase/migrations')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

  void it('contains all 5 staged migrations in correct chronological order', () => {
    assert.equal(files.length, 5)
    assert.match(files[0], /000001_initial_schema\.sql$/)
    assert.match(files[1], /000002_rls_policies\.sql$/)
    assert.match(files[2], /000003_leaderboard_views_and_functions\.sql$/)
    assert.match(files[3], /000004_dungeon_stats_runs_ratings_and_verification\.sql$/)
    assert.match(files[4], /000005_player_persistence_and_profile_sync\.sql$/)
  })

  void it('guarantees zero destructive operations (no DROP TABLE, no DROP COLUMN)', () => {
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      assert.equal(/DROP\s+TABLE/i.test(content), false, `${file} must not drop tables`)
      assert.equal(/DROP\s+COLUMN/i.test(content), false, `${file} must not drop columns`)
      assert.equal(/TRUNCATE/i.test(content), false, `${file} must not truncate data`)
    }
  })

  void it('enforces search_path on all SECURITY DEFINER functions', () => {
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      const secDefinerMatches = content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)[\s\S]*?SECURITY\s+DEFINER[\s\S]*?\$\$/gi) || []
      for (const match of secDefinerMatches) {
        assert.ok(
          /SET\s+search_path\s*=\s*public/i.test(match),
          `Function in ${file} with SECURITY DEFINER must specify SET search_path = public, pg_temp:\n${match}`,
        )
      }
    }
  })

  void it('enforces Row Level Security (RLS) on all user-facing tables', () => {
    const requiredRlsTables = [
      'profiles',
      'dungeons',
      'challenges',
      'daily_challenges',
      'challenge_attempts',
      'scores',
      'achievements',
      'dungeon_stats',
      'dungeon_runs',
      'ratings',
      'auth_nonces',
    ]

    const allSql = files.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n')
    for (const table of requiredRlsTables) {
      const rlsRegex = new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i')
      assert.ok(rlsRegex.test(allSql), `Table ${table} must have RLS explicitly enabled`)
    }
  })

  void it('verifies policy idempotency with DROP POLICY IF EXISTS before CREATE POLICY', () => {
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      const createPolicies = Array.from(content.matchAll(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([^\s]+)/gi))
      for (const match of createPolicies) {
        const policyName = match[1]
        const table = match[2]
        const dropRegex = new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"${policyName}"\\s+ON\\s+${table}`, 'i')
        assert.ok(
          dropRegex.test(content),
          `Policy "${policyName}" on ${table} in ${file} must be preceded by DROP POLICY IF EXISTS for safe re-run`,
        )
      }
    }
  })

  void it('rejects insecure blanket update policies on profiles', () => {
    const allSql = files.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n')
    // Ensure no policy like: USING (near_account_id IS NOT NULL) on profiles FOR UPDATE
    const insecureProfileUpdate = /CREATE\s+POLICY[^\n]+ON\s+public\.profiles\s+FOR\s+UPDATE\s+USING\s*\(\s*near_account_id\s+IS\s+NOT\s+NULL\s*\)/i
    assert.equal(
      insecureProfileUpdate.test(allSql),
      false,
      'Migration must NOT contain insecure blanket update policy on public.profiles',
    )
  })
})

