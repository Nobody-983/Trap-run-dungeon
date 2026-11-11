import { getSupabaseClient } from './client'
import type { ProfileRecord } from './types'

// Local cache/fallback for profiles when Supabase is offline
const localProfiles = new Map<string, ProfileRecord>()

export async function getProfile(nearAccountId: string): Promise<ProfileRecord | null> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    return localProfiles.get(nearAccountId) ?? null
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('near_account_id', nearAccountId)
    .maybeSingle()

  if (error) {
    console.warn('[Supabase] Failed to fetch profile:', error.message)
    return localProfiles.get(nearAccountId) ?? null
  }
  if (data) {
    localProfiles.set(nearAccountId, data)
  }
  return (data) ?? null
}

export async function upsertProfile(input: {
  nearAccountId: string
  displayName?: string
  avatarUrl?: string
  bio?: string
}): Promise<ProfileRecord> {
  const now = new Date().toISOString()
  const fallbackRecord: ProfileRecord = {
    id: localProfiles.get(input.nearAccountId)?.id ?? crypto.randomUUID(),
    near_account_id: input.nearAccountId,
    username: input.nearAccountId,
    display_name: input.displayName ?? input.nearAccountId,
    avatar_url: input.avatarUrl ?? null,
    bio: input.bio ?? null,
    created_at: localProfiles.get(input.nearAccountId)?.created_at ?? now,
    updated_at: now,
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    localProfiles.set(input.nearAccountId, fallbackRecord)
    return fallbackRecord
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        near_account_id: input.nearAccountId,
        display_name: input.displayName ?? input.nearAccountId,
        avatar_url: input.avatarUrl,
        bio: input.bio,
        updated_at: now,
      },
      { onConflict: 'near_account_id' },
    )
    .select()
    .single()

  if (error) {
    console.warn('[Supabase] Failed to upsert profile, using fallback:', error.message)
    localProfiles.set(input.nearAccountId, fallbackRecord)
    return fallbackRecord
  }

  localProfiles.set(input.nearAccountId, data)
  return data
}
