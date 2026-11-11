import { getSupabaseClient } from './client'
import type { ChallengeRecord, DailyChallengeRecord } from './types'

const localChallenges = new Map<string, ChallengeRecord>()
const localDailyChallenges = new Map<string, DailyChallengeRecord>()

export async function createChallenge(input: {
  dungeonId: string
  creatorNearAccount: string
  challengeCode: string
}): Promise<ChallengeRecord> {
  const now = new Date().toISOString()
  const record: ChallengeRecord = {
    id: localChallenges.get(input.challengeCode)?.id ?? crypto.randomUUID(),
    dungeon_id: input.dungeonId,
    creator_near_account: input.creatorNearAccount,
    challenge_code: input.challengeCode,
    status: 'active',
    start_time: now,
    end_time: null,
    created_at: now,
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    localChallenges.set(input.challengeCode, record)
    return record
  }

  const { data, error } = await supabase
    .from('challenges')
    .upsert(
      {
        dungeon_id: input.dungeonId,
        creator_near_account: input.creatorNearAccount,
        challenge_code: input.challengeCode,
        status: 'active',
      },
      { onConflict: 'challenge_code' },
    )
    .select()
    .single()

  if (error) {
    console.warn('[Supabase] Failed to persist challenge, stored locally:', error.message)
    localChallenges.set(input.challengeCode, record)
    return record
  }

  const result = data as ChallengeRecord
  localChallenges.set(result.challenge_code, result)
  return result
}

export async function getChallengeByCode(challengeCode: string): Promise<ChallengeRecord | null> {
  const local = localChallenges.get(challengeCode)
  if (local) return local

  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('challenge_code', challengeCode)
    .maybeSingle()

  if (error || !data) return null
  const res = data as ChallengeRecord
  localChallenges.set(res.challenge_code, res)
  return res
}

export async function getDailyChallenge(day: string): Promise<DailyChallengeRecord | null> {
  const local = localDailyChallenges.get(day)
  if (local) return local

  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('daily_challenges')
    .select('*')
    .eq('day', day)
    .maybeSingle()

  if (error || !data) return null
  const res = data
  localDailyChallenges.set(day, res)
  return res
}

export async function setDailyChallenge(
  day: string,
  dungeonId: string,
  title: string,
  par: number,
): Promise<DailyChallengeRecord> {
  const now = new Date().toISOString()
  const record: DailyChallengeRecord = {
    day,
    dungeon_id: dungeonId,
    title,
    par,
    created_at: now,
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    localDailyChallenges.set(day, record)
    return record
  }

  const { data, error } = await supabase
    .from('daily_challenges')
    .upsert(record, { onConflict: 'day' })
    .select()
    .single()

  if (error) {
    console.warn('[Supabase] Failed to set daily challenge, stored locally:', error.message)
    localDailyChallenges.set(day, record)
    return record
  }

  const res = data
  localDailyChallenges.set(day, res)
  return res
}
