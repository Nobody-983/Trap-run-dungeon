import { encodeCanonicalShareCode } from '@/game/canonicalIdentity'
import { decodeDungeon } from '@/game/codec'
import { emptyCells, idx, CREATOR_START, CREATOR_EXIT, type Dungeon } from '@/game/types'
import { getSupabaseClient, isSupabaseConfigured } from '@/services/supabase/client'
import { NEAR_CONFIG } from '@/services/chain/nearConfig'

export interface CommunityDungeon {
  id: string
  title: string
  creator: string
  creatorType: 'near' | 'guest'
  difficulty: number // 1 to 5
  par: number
  plays: number
  clears: number
  shareCode: string
  createdAt: number
  dungeon: Dungeon
  verifiedOnChain?: boolean
  nearChallengeId?: string
  nearTxHash?: string
  origin?: 'preset' | 'on-chain' | 'supabase' | 'local'
}

export interface CatalogFetchResult {
  dungeons: CommunityDungeon[]
  totalCount: number
  isRemote: boolean
  error?: string
}

interface SupabaseDungeonRow {
  id: string
  title: string
  serialized_dungeon?: string | null
  grid_data?: {
    cells?: Dungeon['cells']
    start?: Dungeon['start']
    exit?: Dungeon['exit']
  }
  creator_near_account: string
  difficulty?: number
  par?: number
  created_at: string
  near_registry_id?: number | null
  contract_account_id?: string | null
  on_chain_tx_hash?: string | null
  on_chain_verified?: boolean
  dungeon_stats?: {
    play_count?: number
    clear_count?: number
  } | null
}

const STORAGE_KEY = 'trap-run:community-catalog:v1'

export function buildSampleDungeons(): CommunityDungeon[] {
  // 1. Sentry Corridor
  const sentryCells = emptyCells()
  sentryCells[idx(4, 5)] = 'sentryH'
  sentryCells[idx(6, 3)] = 'sentryV'
  sentryCells[idx(2, 6)] = 'wall'
  sentryCells[idx(3, 6)] = 'wall'
  sentryCells[idx(4, 6)] = 'wall'
  sentryCells[idx(6, 2)] = 'wall'
  const sentryDungeon: Dungeon = {
    id: 'comm-sentry-corridor',
    name: 'Sentry Corridor',
    cells: sentryCells,
    start: CREATOR_START,
    exit: CREATOR_EXIT,
    creator: { profileId: 'c1', displayName: 'neon_runner.testnet' },
    source: 'creator',
    difficulty: 2,
    par: 18,
    createdAt: Date.now() - 86400000 * 3,
  }

  // 2. Pulse Gauntlet
  const pulseCells = emptyCells()
  pulseCells[idx(3, 7)] = 'pulse'
  pulseCells[idx(5, 5)] = 'pulse'
  pulseCells[idx(6, 4)] = 'pulse'
  pulseCells[idx(4, 3)] = 'wall'
  pulseCells[idx(5, 3)] = 'wall'
  const pulseDungeon: Dungeon = {
    id: 'comm-pulse-gauntlet',
    name: 'Pulse Gauntlet',
    cells: pulseCells,
    start: CREATOR_START,
    exit: CREATOR_EXIT,
    creator: { profileId: 'c2', displayName: 'near_architect.testnet' },
    source: 'creator',
    difficulty: 3,
    par: 22,
    createdAt: Date.now() - 86400000 * 2,
  }

  // 3. Vault of Keys
  const keyCells = emptyCells()
  keyCells[idx(1, 7)] = 'key'
  keyCells[idx(5, 4)] = 'door'
  keyCells[idx(5, 3)] = 'wall'
  keyCells[idx(5, 5)] = 'wall'
  keyCells[idx(3, 5)] = 'spike'
  keyCells[idx(6, 2)] = 'spike'
  const keyDungeon: Dungeon = {
    id: 'comm-vault-keys',
    name: 'Vault of Keys',
    cells: keyCells,
    start: CREATOR_START,
    exit: CREATOR_EXIT,
    creator: { profileId: 'c3', displayName: 'cipher_escapist.testnet' },
    source: 'creator',
    difficulty: 4,
    par: 26,
    createdAt: Date.now() - 86400000,
  }

  const sampleRegistry = { chain: 'near' as const, network: 'testnet' as const, registry: 'traprun-registry.testnet' }

  return [
    {
      id: sentryDungeon.id,
      title: sentryDungeon.name,
      creator: sentryDungeon.creator.displayName,
      creatorType: 'near',
      difficulty: 2,
      par: 18,
      plays: 42,
      clears: 28,
      shareCode: encodeCanonicalShareCode({ dungeon: sentryDungeon, registry: sampleRegistry, challengeId: 101n }),
      createdAt: sentryDungeon.createdAt,
      dungeon: sentryDungeon,
      verifiedOnChain: true,
      nearChallengeId: '101',
      origin: 'preset',
    },
    {
      id: pulseDungeon.id,
      title: pulseDungeon.name,
      creator: pulseDungeon.creator.displayName,
      creatorType: 'near',
      difficulty: 3,
      par: 22,
      plays: 35,
      clears: 19,
      shareCode: encodeCanonicalShareCode({ dungeon: pulseDungeon, registry: sampleRegistry, challengeId: 102n }),
      createdAt: pulseDungeon.createdAt,
      dungeon: pulseDungeon,
      verifiedOnChain: true,
      nearChallengeId: '102',
      origin: 'preset',
    },
    {
      id: keyDungeon.id,
      title: keyDungeon.name,
      creator: keyDungeon.creator.displayName,
      creatorType: 'near',
      difficulty: 4,
      par: 26,
      plays: 68,
      clears: 24,
      shareCode: encodeCanonicalShareCode({ dungeon: keyDungeon, registry: sampleRegistry, challengeId: 103n }),
      createdAt: keyDungeon.createdAt,
      dungeon: keyDungeon,
      verifiedOnChain: true,
      nearChallengeId: '103',
      origin: 'preset',
    },
  ]
}

let memoryCatalog: CommunityDungeon[] | null = null

/**
 * Returns local community catalog synchronously (cached or local-storage backed).
 */
export function getCommunityCatalog(): CommunityDungeon[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as CommunityDungeon[]
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } else if (memoryCatalog) {
      return memoryCatalog
    }
  } catch {
    /* ignore parse errors */
  }

  const initial = buildSampleDungeons()
  saveCommunityCatalog(initial)
  return initial
}

export function saveCommunityCatalog(catalog: CommunityDungeon[]): void {
  memoryCatalog = catalog
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog))
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * Fetches community catalog from Supabase when available,
 * seamlessly merged with presets, or gracefully falls back to local storage.
 */
export async function fetchSharedCommunityCatalog(options?: {
  query?: string
  difficulty?: number | 'all'
  page?: number
  limit?: number
}): Promise<CatalogFetchResult> {
  const query = options?.query?.trim().toLowerCase() ?? ''
  const diff = options?.difficulty ?? 'all'
  const page = options?.page ?? 0
  const limit = options?.limit ?? 20

  const supabase = getSupabaseClient()
  if (isSupabaseConfigured && supabase) {
    try {
      let req = supabase
        .from('dungeons')
        .select('*, dungeon_stats(*)', { count: 'exact' })
        .eq('status', 'published')
        .order('created_at', { ascending: false })

      if (diff !== 'all') {
        req = req.eq('difficulty', diff)
      }
      if (query) {
        req = req.or(`title.ilike.%${query}%,creator_near_account.ilike.%${query}%`)
      }

      const from = page * limit
      const to = from + limit - 1
      req = req.range(from, to)

      const { data, count, error } = await req

      if (error) {
        console.warn('[Supabase Catalog] Query error, falling back to local:', error.message)
      } else if (data) {
        const mapped: CommunityDungeon[] = (data as unknown as SupabaseDungeonRow[]).map((row: SupabaseDungeonRow) => {
          let parsedDungeon: Dungeon | null = null
          if (row.serialized_dungeon) {
            try {
              parsedDungeon = decodeDungeon(row.serialized_dungeon)
            } catch {
              /* ignore parse error */
            }
          }
          if (!parsedDungeon) {
            parsedDungeon = {
              id: row.id,
              name: row.title,
              cells: row.grid_data?.cells ?? emptyCells(),
              start: row.grid_data?.start ?? CREATOR_START,
              exit: row.grid_data?.exit ?? CREATOR_EXIT,
              creator: { profileId: row.creator_near_account, displayName: row.creator_near_account },
              source: 'creator',
              difficulty: row.difficulty ?? 1,
              par: row.par ?? 20,
              createdAt: new Date(row.created_at).getTime(),
            }
          }

          const stats = row.dungeon_stats
          const plays = stats?.play_count ?? 0
          const clears = stats?.clear_count ?? 0

          const shareCode = encodeCanonicalShareCode({
            dungeon: parsedDungeon,
            registry: {
              chain: 'near',
              network: 'testnet',
              registry: row.contract_account_id || NEAR_CONFIG.registryAccountId,
            },
            challengeId: row.near_registry_id ? BigInt(row.near_registry_id) : null,
          })

          return {
            id: row.id,
            title: row.title,
            creator: row.creator_near_account,
            creatorType: 'near',
            difficulty: row.difficulty ?? 1,
            par: row.par ?? 20,
            plays,
            clears,
            shareCode,
            createdAt: new Date(row.created_at).getTime(),
            dungeon: parsedDungeon,
            verifiedOnChain: Boolean(row.on_chain_verified),
            nearChallengeId: row.near_registry_id ? String(row.near_registry_id) : undefined,
            nearTxHash: row.on_chain_tx_hash ?? undefined,
            origin: row.on_chain_verified ? 'on-chain' : 'supabase',
          }
        })

        // Add matching sample presets so users can always explore standard levels
        const presets = searchAndFilterCommunityDungeons(buildSampleDungeons(), query, diff)
        const combined = [...mapped]
        for (const preset of presets) {
          if (!combined.some((d) => d.id === preset.id || d.title === preset.title)) {
            combined.push(preset)
          }
        }

        return {
          dungeons: combined,
          totalCount: (count ?? mapped.length) + presets.length,
          isRemote: true,
        }
      }
    } catch (cause) {
      console.warn('[Supabase Catalog] Network failure, using local catalog:', cause)
    }
  }

  // Local fallback
  const local = getCommunityCatalog()
  const filtered = searchAndFilterCommunityDungeons(local, query, diff)
  const paginated = filtered.slice(page * limit, (page + 1) * limit)

  return {
    dungeons: paginated,
    totalCount: filtered.length,
    isRemote: false,
  }
}

export function addOrUpdateCommunityDungeon(dungeon: CommunityDungeon): void {
  const catalog = getCommunityCatalog()
  const existingIndex = catalog.findIndex((item) => item.id === dungeon.id || item.shareCode === dungeon.shareCode)
  if (existingIndex >= 0) {
    catalog[existingIndex] = {
      ...catalog[existingIndex],
      ...dungeon,
      plays: Math.max(catalog[existingIndex].plays, dungeon.plays),
      clears: Math.max(catalog[existingIndex].clears, dungeon.clears),
    }
  } else {
    catalog.unshift(dungeon)
  }
  saveCommunityCatalog(catalog.slice(0, 100))
}

export function recordCommunityDungeonRun(
  dungeonId: string,
  won: boolean,
  metadata?: {
    playerNearAccount?: string
    durationMs?: number
    moves?: number
  },
): void {
  // 1. Update local storage immediately for responsive UI
  const catalog = getCommunityCatalog()
  const item = catalog.find((entry) => entry.id === dungeonId)
  if (item) {
    item.plays += 1
    if (won) item.clears += 1
    saveCommunityCatalog(catalog)
  }

  // 2. If Supabase is configured, record run asynchronously
  const supabase = getSupabaseClient()
  if (isSupabaseConfigured && supabase) {
    void supabase
      .from('dungeon_runs')
      .insert({
        dungeon_id: dungeonId,
        player_near_account: metadata?.playerNearAccount ?? null,
        result: won ? 'win' : 'loss',
        duration_ms: metadata?.durationMs ?? null,
        moves: metadata?.moves ?? null,
      })
      .then(({ error }) => {
        if (error) {
          console.warn('[Community Catalog] Error posting run to Supabase:', error.message)
        }
      })
  }
}

export function searchAndFilterCommunityDungeons(
  catalog: CommunityDungeon[],
  query: string,
  difficultyFilter: number | 'all' = 'all',
): CommunityDungeon[] {
  const q = query.trim().toLowerCase()
  return catalog.filter((entry) => {
    if (difficultyFilter !== 'all' && entry.difficulty !== difficultyFilter) {
      return false
    }
    if (q) {
      const matchesTitle = entry.title.toLowerCase().includes(q)
      const matchesCreator = entry.creator.toLowerCase().includes(q)
      if (!matchesTitle && !matchesCreator) return false
    }
    return true
  })
}
