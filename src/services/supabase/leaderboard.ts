import { getSupabaseClient } from './client'
import type { GlobalLeaderboardEntry, LeaderboardEntry, ScoreRecord } from './types'

interface ScoreRow {
  id: string
  player_near_account: string
  score: number
  completion_time_ms: number
  moves: number
  created_at: string
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null
}

interface DailyLeaderboardRow {
  player_near_account: string
  display_name?: string | null
  avatar_url?: string | null
  score: number
  completion_time_ms: number
  moves: number
  created_at: string
}

// In-memory score cache / local fallback
const localScores: ScoreRecord[] = []

export async function recordVerifiedScore(input: {
  playerNearAccount: string
  dungeonId: string
  challengeId?: string | null
  attemptId: string
  completionTimeMs: number
  moves: number
  score: number
}): Promise<ScoreRecord> {
  const record: ScoreRecord = {
    id: crypto.randomUUID(),
    player_near_account: input.playerNearAccount,
    dungeon_id: input.dungeonId,
    challenge_id: input.challengeId ?? null,
    attempt_id: input.attemptId,
    completion_time_ms: input.completionTimeMs,
    moves: input.moves,
    score: input.score,
    validation_status: 'verified',
    created_at: new Date().toISOString(),
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    localScores.push(record)
    return record
  }

  const { data, error } = await supabase
    .from('scores')
    .insert({
      player_near_account: input.playerNearAccount,
      dungeon_id: input.dungeonId,
      challenge_id: input.challengeId ?? null,
      attempt_id: input.attemptId,
      completion_time_ms: input.completionTimeMs,
      moves: input.moves,
      score: input.score,
      validation_status: 'verified',
    })
    .select()
    .single()

  if (error) {
    console.warn('[Supabase] Failed to write verified score to DB, cached locally:', error.message)
    localScores.push(record)
    return record
  }

  localScores.push(data as ScoreRecord)
  return data as ScoreRecord
}

export async function getDungeonLeaderboard(
  dungeonId: string,
  limit = 20,
  currentNearAccount?: string | null,
): Promise<LeaderboardEntry[]> {
  const supabase = getSupabaseClient()
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc('get_dungeon_leaderboard', {
        p_dungeon_id: dungeonId,
        p_limit: limit,
        p_offset: 0,
      })
      if (!error && data && data.length > 0) {
        return (data as LeaderboardEntry[]).map((entry, index) => ({
          ...entry,
          rank: index + 1,
          isYou: Boolean(currentNearAccount && entry.player_near_account === currentNearAccount),
        }))
      }
    } catch {
      // fallback to table query or local
    }

    const { data: rows, error: qError } = await supabase
      .from('scores')
      .select('id, player_near_account, score, completion_time_ms, moves, created_at, profiles(display_name, avatar_url)')
      .eq('dungeon_id', dungeonId)
      .eq('validation_status', 'verified')
      .order('score', { ascending: false })
      .order('completion_time_ms', { ascending: true })
      .order('moves', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(limit)

    if (!qError && rows && rows.length > 0) {
      return (rows as unknown as ScoreRow[]).map((r, idx: number) => ({
        rank: idx + 1,
        player_near_account: r.player_near_account,
        display_name: r.profiles?.display_name ?? r.player_near_account,
        avatar_url: r.profiles?.avatar_url ?? null,
        score: r.score,
        completion_time_ms: r.completion_time_ms,
        moves: r.moves,
        created_at: r.created_at,
        isYou: Boolean(currentNearAccount && r.player_near_account === currentNearAccount),
      }))
    }
  }

  // Local fallback: filter in-memory scores
  const matching = localScores
    .filter((s) => s.dungeon_id === dungeonId && s.validation_status === 'verified')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.completion_time_ms !== b.completion_time_ms) return a.completion_time_ms - b.completion_time_ms
      return a.moves - b.moves
    })
    .slice(0, limit)

  return matching.map((s, idx) => ({
    rank: idx + 1,
    player_near_account: s.player_near_account,
    display_name: s.player_near_account,
    score: s.score,
    completion_time_ms: s.completion_time_ms,
    moves: s.moves,
    created_at: s.created_at,
    isYou: Boolean(currentNearAccount && s.player_near_account === currentNearAccount),
  }))
}

export async function getDailyLeaderboard(
  limit = 20,
  currentNearAccount?: string | null,
): Promise<LeaderboardEntry[]> {
  const supabase = getSupabaseClient()
  if (supabase) {
    const { data, error } = await supabase
      .from('daily_leaderboard')
      .select('*')
      .limit(limit)

    if (!error && data && data.length > 0) {
      return (data as unknown as DailyLeaderboardRow[]).map((entry, index) => ({
        rank: index + 1,
        player_near_account: entry.player_near_account,
        display_name: entry.display_name ?? entry.player_near_account,
        avatar_url: entry.avatar_url ?? null,
        score: entry.score,
        completion_time_ms: entry.completion_time_ms,
        moves: entry.moves,
        created_at: entry.created_at,
        isYou: Boolean(currentNearAccount && entry.player_near_account === currentNearAccount),
      }))
    }
  }

  return []
}

export async function getGlobalLeaderboard(
  limit = 20,
  currentNearAccount?: string | null,
): Promise<GlobalLeaderboardEntry[]> {
  const supabase = getSupabaseClient()
  if (supabase) {
    const { data, error } = await supabase
      .from('global_leaderboard')
      .select('*')
      .limit(limit)

    if (!error && data && data.length > 0) {
      return (data as unknown as GlobalLeaderboardEntry[]).map((entry, index) => ({
        rank: index + 1,
        player_near_account: entry.player_near_account,
        display_name: entry.display_name ?? entry.player_near_account,
        avatar_url: entry.avatar_url ?? null,
        total_score: entry.total_score,
        dungeons_cleared: entry.dungeons_cleared,
        best_time_ms: entry.best_time_ms,
        isYou: Boolean(currentNearAccount && entry.player_near_account === currentNearAccount),
      }))
    }
  }

  return []
}
