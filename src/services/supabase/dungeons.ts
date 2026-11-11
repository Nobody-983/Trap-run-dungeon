import { getSupabaseClient } from './client'
import type { DungeonRecord } from './types'
import { canonicalDungeonHashHex } from '../../game/canonicalIdentity'
import { encodeDungeon } from '../../game/codec'
import type { Dungeon } from '../../game/types'

const localDungeons = new Map<string, DungeonRecord>()

export async function publishDungeon(input: {
  dungeon: Dungeon
  creatorNearAccount: string
  title: string
  description?: string
  par: number
  difficulty?: number
  nearRegistryId?: bigint | null
}): Promise<DungeonRecord> {
  const hashHex = await canonicalDungeonHashHex(input.dungeon)
  const encoded = encodeDungeon(input.dungeon)
  const now = new Date().toISOString()

  const record: DungeonRecord = {
    id: localDungeons.get(hashHex)?.id ?? crypto.randomUUID(),
    creator_near_account: input.creatorNearAccount,
    title: input.title,
    description: input.description ?? null,
    dungeon_hash: hashHex,
    canonical_format_version: 1,
    serialized_dungeon: encoded,
    grid_data: {
      cells: input.dungeon.cells,
      start: input.dungeon.start,
      exit: input.dungeon.exit,
    },
    par: input.par,
    difficulty: input.difficulty ?? 1,
    status: 'published',
    near_registry_id: input.nearRegistryId ? Number(input.nearRegistryId) : null,
    created_at: localDungeons.get(hashHex)?.created_at ?? now,
    updated_at: now,
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    localDungeons.set(record.id, record)
    localDungeons.set(hashHex, record)
    return record
  }

  const { data, error } = await supabase
    .from('dungeons')
    .upsert(
      {
        creator_near_account: input.creatorNearAccount,
        title: input.title,
        description: input.description ?? null,
        dungeon_hash: hashHex,
        canonical_format_version: 1,
        serialized_dungeon: encoded,
        grid_data: record.grid_data,
        par: input.par,
        difficulty: input.difficulty ?? 1,
        status: 'published',
        near_registry_id: input.nearRegistryId ? Number(input.nearRegistryId) : null,
        updated_at: now,
      },
      { onConflict: 'dungeon_hash' },
    )
    .select()
    .single()

  if (error) {
    console.warn('[Supabase] Failed to publish dungeon to remote, saved locally:', error.message)
    localDungeons.set(record.id, record)
    localDungeons.set(hashHex, record)
    return record
  }

  const result = data as DungeonRecord
  localDungeons.set(result.id, result)
  localDungeons.set(result.dungeon_hash, result)
  return result
}

export async function getDungeonById(id: string): Promise<DungeonRecord | null> {
  const local = localDungeons.get(id)
  if (local) return local

  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('dungeons')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  const res = data as DungeonRecord
  localDungeons.set(res.id, res)
  localDungeons.set(res.dungeon_hash, res)
  return res
}

export async function getDungeonByHash(hashHex: string): Promise<DungeonRecord | null> {
  const local = localDungeons.get(hashHex)
  if (local) return local

  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('dungeons')
    .select('*')
    .eq('dungeon_hash', hashHex)
    .maybeSingle()

  if (error || !data) return null
  const res = data as DungeonRecord
  localDungeons.set(res.id, res)
  localDungeons.set(res.dungeon_hash, res)
  return res
}

export async function listPublicDungeons(limit = 20): Promise<DungeonRecord[]> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    return Array.from(new Set(localDungeons.values())).slice(0, limit)
  }

  const { data, error } = await supabase
    .from('dungeons')
    .select('*')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[Supabase] Error listing public dungeons:', error.message)
    return Array.from(new Set(localDungeons.values())).slice(0, limit)
  }

  return (data ?? []) as DungeonRecord[]
}

export async function listDungeonsByCreator(creatorNearAccount: string): Promise<DungeonRecord[]> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    return Array.from(new Set(localDungeons.values())).filter(
      (d) => d.creator_near_account === creatorNearAccount,
    )
  }

  const { data, error } = await supabase
    .from('dungeons')
    .select('*')
    .eq('creator_near_account', creatorNearAccount)
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('[Supabase] Error listing creator dungeons:', error.message)
    return Array.from(new Set(localDungeons.values())).filter(
      (d) => d.creator_near_account === creatorNearAccount,
    )
  }

  return (data ?? []) as DungeonRecord[]
}
