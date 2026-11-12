import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  Compass,
  Copy,
  Hammer,
  Link2,
  Loader2,
  LogOut,
  Play,
  Search,
  Share2,
  Swords,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { inbox } from '@/app/inbox'
import { useNav } from '@/app/nav'
import { Button, Difficulty, Label, Notice, Panel, Screen } from '@/components/ui'
import { encodeCanonicalShareCode, type DecodedCanonicalShare, decodeCanonicalShareCode } from '@/game/canonicalIdentity'
import { decodeDungeon, extractCode } from '@/game/codec'
import { validateDungeon } from '@/game/validate'
import type { Dungeon } from '@/game/types'
import { buildShareLink } from '@/lib/share'
import { profileStore, useProfile } from '@/progress/store'
import { services } from '@/services'
import { NEAR_CONFIG, NEAR_NETWORK_LABEL } from '@/services/chain/near'
import type { NearTransactionPhase } from '@/services/chain/nearWallet'
import {
  verifyNearPublishingTransaction,
  syncVerifiedPublishingToSupabase,
  getPendingSyncs,
  type PendingPublishSync,
} from '@/services/chain/nearTransactionVerifier'
import {
  addOrUpdateCommunityDungeon,
  fetchSharedCommunityCatalog,
  getCommunityCatalog,
  recordCommunityDungeonRun,
  searchAndFilterCommunityDungeons,
  type CommunityDungeon,
} from '@/services/community/catalog'
import { isSupabaseConfigured } from '@/services/supabase/client'

type Tab = 'community' | 'host' | 'join'
type NearPhase = 'idle' | 'connecting' | 'wallet-approval' | 'pending-finality'

interface Joined {
  dungeon: Dungeon
  verified: { chain: 'near'; id: string; creator: string } | null
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error('Copy failed. Select the text and copy it manually.')
  }
}

function extractCanonicalCode(input: string): string | null {
  return /TRI1\.[A-Za-z0-9_-]+/.exec(input.trim())?.[0] ?? null
}

export function FriendScreen() {
  const { go } = useNav()
  const p = useProfile()
  const [tab, setTab] = useState<Tab>(() => (inbox.code ? 'join' : 'community'))
  const [input, setInput] = useState(() => {
    const code = inbox.code
    inbox.code = null
    return code ?? ''
  })
  const [selected, setSelected] = useState(0)
  const [joined, setJoined] = useState<Joined | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [nearAccount, setNearAccount] = useState<string | null>(null)
  const [nearPhase, setNearPhase] = useState<NearPhase>('idle')
  const [nearError, setNearError] = useState<string | null>(null)

  // Community Catalog state
  const [communitySearch, setCommunitySearch] = useState('')
  const [diffFilter, setDiffFilter] = useState<number | 'all'>('all')
  const [catalog, setCatalog] = useState<CommunityDungeon[]>(() => getCommunityCatalog())
  const [isRemoteCatalog, setIsRemoteCatalog] = useState<boolean>(() => isSupabaseConfigured)
  const [pendingSyncs, setPendingSyncs] = useState<PendingPublishSync[]>(() => getPendingSyncs())
  const [isSyncing, setIsSyncing] = useState(false)

  const refreshCatalog = useCallback(async () => {
    const res = await fetchSharedCommunityCatalog({ query: communitySearch, difficulty: diffFilter })
    setCatalog(res.dungeons)
    setIsRemoteCatalog(res.isRemote)
    setPendingSyncs(getPendingSyncs())
  }, [communitySearch, diffFilter])

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      void fetchSharedCommunityCatalog({ query: communitySearch, difficulty: diffFilter }).then((res) => {
        if (!active) return
        setCatalog(res.dungeons)
        setIsRemoteCatalog(res.isRemote)
        setPendingSyncs(getPendingSyncs())
      })
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [communitySearch, diffFilter])

  const syncAllPending = async () => {
    setIsSyncing(true)
    let syncedCount = 0
    for (const item of pendingSyncs) {
      const res = await syncVerifiedPublishingToSupabase(item)
      if (res.synced) syncedCount++
    }
    setPendingSyncs(getPendingSyncs())
    void refreshCatalog()
    setIsSyncing(false)
    if (syncedCount > 0) {
      toast.success(`Synced ${syncedCount} challenge(s) to shared database!`)
    } else {
      toast.info('Could not sync pending challenges. Check Supabase connection in .env.')
    }
  }

  const hosted = p.published[selected] ?? null
  const nearChallenges = useMemo(
    () => p.nearChallenges.filter((entry) => hosted && entry.dungeonId === hosted.id),
    [p.nearChallenges, hosted],
  )
  const _latestNear = nearChallenges[0] ?? null

  useEffect(() => {
    let live = true
    void services.near.wallet.restore().then((session) => {
      if (!live) return
      setNearAccount(session ? session.identity.accountId : null)
    })
    return () => {
      live = false
    }
  }, [])

  const connectNear = async () => {
    setNearPhase('connecting')
    setNearError(null)
    try {
      const session = await services.near.wallet.connect()
      setNearAccount(session.identity.accountId)
      profileStore.switchTo(session.identity.accountId)
      setNearPhase('idle')
      toast.success(`Connected as ${session.identity.accountId}`)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Could not connect NEAR wallet'
      setNearError(msg)
      setNearPhase('idle')
    }
  }

  const disconnectNear = async () => {
    await services.near.wallet.disconnect()
    setNearAccount(null)
    setNearPhase('idle')
    setNearError(null)
    toast.info('Disconnected NEAR wallet')
  }

  const registerNearChallenge = async () => {
    if (!hosted || !nearAccount) return
    setNearPhase('wallet-approval')
    setNearError(null)
    try {
      const registration = await services.near.registry.registerChallenge(hosted, {
        depositYocto: 50_000_000_000_000_000_000_000n, // 0.05 NEAR
        onPhase: (phase: NearTransactionPhase) => setNearPhase(phase),
      })

      const shareCode = encodeCanonicalShareCode({
        dungeon: hosted,
        registry: { chain: 'near', network: 'testnet', registry: NEAR_CONFIG.registryAccountId },
        challengeId: registration.challengeId,
      })

      profileStore.recordNearChallenge({
        dungeonId: hosted.id,
        challengeId: registration.challengeId.toString(),
        creator: registration.creator,
        txHash: registration.txHash,
        shareCode,
        at: Date.now(),
      })

      // Independent transaction verification
      await verifyNearPublishingTransaction({
        txHash: registration.txHash,
        creatorAccountId: registration.creator,
        expectedChallengeId: registration.challengeId.toString(),
        dungeon: hosted,
      })

      // Sync to Supabase
      const syncResult = await syncVerifiedPublishingToSupabase({
        txHash: registration.txHash,
        creatorAccountId: registration.creator,
        challengeId: registration.challengeId.toString(),
        dungeon: hosted,
        shareCode,
        registeredAt: Date.now(),
      })

      // Add to verified community catalog
      addOrUpdateCommunityDungeon({
        id: hosted.id,
        title: hosted.name,
        creator: registration.creator,
        creatorType: 'near',
        difficulty: hosted.difficulty,
        par: hosted.par ?? 20,
        plays: 0,
        clears: 0,
        shareCode,
        createdAt: hosted.createdAt,
        dungeon: hosted,
        verifiedOnChain: true,
        nearChallengeId: registration.challengeId.toString(),
        nearTxHash: registration.txHash,
        origin: 'on-chain',
      })
      void refreshCatalog()

      if (syncResult.synced) {
        toast.success(`Challenge #${registration.challengeId} registered & synced to shared database!`)
      } else {
        toast.success(`Challenge #${registration.challengeId} registered on NEAR testnet!`)
      }
    } catch (cause) {
      setNearError(cause instanceof Error ? cause.message : 'NEAR testnet registration failed')
    } finally {
      setNearPhase('idle')
    }
  }

  const lookupNear = async (code: string) => {
    setChecking(true)
    try {
      let decoded: DecodedCanonicalShare
      try {
        decoded = decodeCanonicalShareCode(code)
      } catch (err) {
        return setError(err instanceof Error ? err.message : 'Malformed TRI1 challenge code.')
      }

      if (!NEAR_CONFIG.configured) {
        return setError('NEAR testnet registry is not configured. Set VITE_NEAR_REGISTRY_ACCOUNT in .env to verify on-chain challenges.')
      }

      if (
        decoded.registry.chain !== 'near' ||
        decoded.registry.network !== 'testnet' ||
        decoded.registry.registry !== NEAR_CONFIG.registryAccountId
      ) {
        return setError(
          `This challenge expects NEAR registry "${decoded.registry.registry}" on ${decoded.registry.network}, but this app is configured for "${NEAR_CONFIG.registryAccountId}".`,
        )
      }

      const candidate: Dungeon = {
        id: `near-${decoded.challengeId ?? 'custom'}`,
        name: `NEAR Challenge #${decoded.challengeId ?? 'Custom'}`,
        ...decoded.dungeon,
        creator: { profileId: 'near:pending', displayName: 'NEAR Creator' },
        source: 'friend',
        difficulty: 2,
        createdAt: Date.now(),
      }

      const validation = validateDungeon(candidate)
      if (!validation.ok) return setError(`Invalid dungeon rules: ${validation.errors[0]}`)

      if (decoded.challengeId === null) {
        return setJoined({ dungeon: { ...candidate, par: validation.par ?? undefined }, verified: null })
      }

      const challenge = await services.near.registry.getChallenge(decoded.challengeId)
      if (!challenge) return setError(`Challenge #${decoded.challengeId} was not found on NEAR testnet.`)

      const verified = await services.near.registry.verifyChallenge({ dungeon: decoded.dungeon, challenge })
      if (!verified.valid) return setError(verified.reason ?? 'The NEAR challenge could not be verified.')

      setJoined({
        dungeon: {
          ...candidate,
          par: validation.par ?? undefined,
          creator: { profileId: `near:${challenge.creator}`, displayName: challenge.creator.slice(0, 16) },
        },
        verified: { chain: 'near', id: challenge.challenge_id, creator: challenge.creator },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach NEAR testnet to verify this challenge.')
    } finally {
      setChecking(false)
    }
  }

  const lookup = async (raw: string) => {
    setError(null)
    setJoined(null)
    const text = raw.trim()
    if (!text) return setError('Paste a challenge code, link or room code.')
    const canonicalCode = extractCanonicalCode(text)
    if (canonicalCode) return lookupNear(canonicalCode)

    // TR1 challenge code or local room code fallback
    const tr1 = extractCode(text)
    const stored = p.rooms[text.toUpperCase()]
    const code = tr1 || stored || (/^[A-Za-z0-9_.-]+$/.test(text) ? text : null)
    const dungeon = code ? decodeDungeon(code) : null
    if (!code || !dungeon) {
      setChecking(false)
      return setError('That code could not be read. Please check your challenge code or link.')
    }

    const validation = validateDungeon(dungeon)
    if (!validation.ok) {
      setChecking(false)
      return setError(`This dungeon is not valid: ${validation.errors[0]}`)
    }

    setJoined({
      dungeon: { ...dungeon, par: validation.par ?? undefined },
      verified: null,
    })
    setChecking(false)
  }

  useEffect(() => {
    if (!input || tab !== 'join') return
    const timer = setTimeout(() => {
      void lookup(input)
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const playDungeon = useCallback(
    (dungeonToPlay: Dungeon, own: boolean) => {
      recordCommunityDungeonRun(dungeonToPlay.id, false)
      const val = validateDungeon(dungeonToPlay)
      const resolvedPar = dungeonToPlay.par ?? (val.ok && val.par ? val.par : undefined)
      go({
        name: 'play',
        dungeon: { ...dungeonToPlay, par: resolvedPar },
        mode: own ? 'test' : 'friend',
        back: { name: 'friend' },
        next: null,
        attempt: Math.floor(performance.now()),
      })
    },
    [go],
  )

  const nearBusy = nearPhase === 'connecting' || nearPhase === 'wallet-approval' || nearPhase === 'pending-finality'

  const filteredCommunity = useMemo(
    () => searchAndFilterCommunityDungeons(catalog, communitySearch, diffFilter),
    [catalog, communitySearch, diffFilter],
  )

  return (
    <Screen title="Community & Challenges" onBack={() => go({ name: 'modes' })}>
      <div className="flex flex-col gap-4">
        {/* Navigation Tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-800 p-1" role="tablist">
          {(
            [
              { key: 'community', label: 'Community', icon: Compass },
              { key: 'host', label: 'My Creations', icon: Swords },
              { key: 'join', label: 'Enter Code', icon: Link2 },
            ] as const
          ).map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => {
                  setTab(t.key)
                  if (t.key === 'community') void refreshCatalog()
                }}
                className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg font-display text-xs sm:text-sm font-semibold uppercase tracking-wider transition ${
                  tab === t.key ? 'bg-volt-500 text-white shadow-volt' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <Icon size={15} />
                <span>{t.label}</span>
              </button>
            )
          })}
        </div>

        {/* --- TAB 1: COMMUNITY CATALOG --- */}
        {tab === 'community' && (
          <div className="flex flex-col gap-3">
            {/* Backend Sync Status & Pending Sync Notice */}
            <div className="flex items-center justify-between text-xs px-1">
              <div>
                {isRemoteCatalog ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 font-pixel">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Cloud Backend Active (Supabase)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-400 font-pixel">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Local-First Catalog Mode
                  </span>
                )}
              </div>
              <button
                onClick={() => void refreshCatalog()}
                className="text-zinc-400 hover:text-zinc-200 font-pixel text-xs underline"
              >
                Refresh
              </button>
            </div>

            {pendingSyncs.length > 0 && (
              <div className="rounded-xl border border-volt-500/30 bg-volt-500/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs text-zinc-200">
                  <span className="font-bold text-volt-300">{pendingSyncs.length} verified challenge(s)</span> pending cloud synchronization.
                </div>
                <Button size="sm" variant="volt" onClick={() => void syncAllPending()} disabled={isSyncing}>
                  {isSyncing ? <Loader2 size={12} className="animate-spin" /> : 'Sync to Cloud'}
                </Button>
              </div>
            )}

            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-3 text-zinc-400" />
                <input
                  value={communitySearch}
                  onChange={(e) => setCommunitySearch(e.target.value)}
                  placeholder="Search dungeons by title or creator..."
                  className="h-10 w-full rounded-xl border border-ink-600 bg-ink-900 pl-9 pr-3 text-sm text-zinc-100 outline-none focus:border-volt-400"
                />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                {(['all', 2, 3, 4] as const).map((filterVal) => (
                  <button
                    key={String(filterVal)}
                    onClick={() => setDiffFilter(filterVal)}
                    className={`rounded-lg px-2.5 py-1.5 font-pixel text-xs transition ${
                      diffFilter === filterVal
                        ? 'bg-volt-500 text-ink-950 font-bold'
                        : 'border border-ink-600 bg-ink-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {filterVal === 'all' ? 'All' : `D${filterVal}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Community Dungeon Cards */}
            {filteredCommunity.length === 0 ? (
              <Panel className="py-8 text-center">
                <p className="text-zinc-400 text-sm">No community dungeons found matching your filters.</p>
              </Panel>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filteredCommunity.map((comm) => {
                  const clearPct = comm.plays > 0 ? Math.round((comm.clears / comm.plays) * 100) : 0
                  return (
                    <Panel key={comm.id} className="flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="font-display font-bold text-base text-zinc-100 leading-tight">
                                {comm.title}
                              </h3>
                              {comm.verifiedOnChain && (
                                <span title="Verified on NEAR Testnet">
                                  <BadgeCheck size={16} className="text-volt-400" />
                                </span>
                              )}
                              {comm.origin === 'preset' ? (
                                <span className="rounded bg-ink-700 px-1.5 py-0.2 text-[10px] text-zinc-300 font-pixel">
                                  Preset
                                </span>
                              ) : comm.verifiedOnChain ? (
                                <span className="rounded bg-volt-500/20 px-1.5 py-0.2 text-[10px] text-volt-300 font-pixel border border-volt-500/30">
                                  NEAR #{comm.nearChallengeId ?? 'On-Chain'}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-zinc-400 mt-0.5 truncate max-w-[220px]">
                              by {comm.creator}
                            </div>
                          </div>
                          <Difficulty level={comm.difficulty} />
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs text-zinc-400 font-pixel">
                          <span>Par: {comm.par} moves</span>
                          <span>
                            {comm.plays} runs · {comm.clears} clears ({clearPct}%)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-ink-700/60 gap-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              void (async () => {
                                const link = await buildShareLink(`/?c=${comm.shareCode}`)
                                await copy(link, 'Share link')
                              })()
                            }}
                            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-volt-300"
                            title="Copy share link"
                          >
                            <Share2 size={13} /> Link
                          </button>
                          <button
                            onClick={() => void copy(comm.shareCode, 'TRI1 code')}
                            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-volt-300"
                            title="Copy TRI1 share code"
                          >
                            <Copy size={13} /> Code
                          </button>
                        </div>
                        <Button size="sm" variant="volt" onClick={() => playDungeon(comm.dungeon, false)}>
                          <Play size={14} /> Play
                        </Button>
                      </div>
                    </Panel>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* --- TAB 2: HOST / MY CREATIONS --- */}
        {tab === 'host' && (
          <div className="flex flex-col gap-4">
            <Panel>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet size={18} className="text-volt-400" />
                  <span className="font-display font-bold">NEAR Protocol ({NEAR_NETWORK_LABEL})</span>
                </div>
                {nearAccount ? (
                  <Button size="sm" variant="ghost" onClick={() => void disconnectNear()}>
                    <LogOut size={14} /> Disconnect
                  </Button>
                ) : (
                  <Button size="sm" variant="volt" onClick={() => void connectNear()} disabled={nearBusy}>
                    Connect Wallet
                  </Button>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                {nearAccount
                  ? `Signed in as ${nearAccount}. Register challenges on-chain with 0.05 NEAR.`
                  : 'Connect your NEAR wallet to register immutable challenges and prove authorship on-chain.'}
              </p>
              {nearError && (
                <div className="mt-2">
                  <Notice tone="error">{nearError}</Notice>
                </div>
              )}
            </Panel>

            {p.published.length === 0 ? (
              <Panel className="py-8 text-center">
                <p className="text-zinc-400 mb-3 text-sm">You haven't published any dungeons yet.</p>
                <Button variant="volt" onClick={() => go({ name: 'editor' })}>
                  <Hammer size={16} /> Open Dungeon Creator
                </Button>
              </Panel>
            ) : (
              <div className="flex flex-col gap-3">
                {p.published.map((d, index) => {
                  const nearRec = p.nearChallenges.find((nc) => nc.dungeonId === d.id)
                  return (
                    <Panel key={d.id} className="flex flex-col gap-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-display font-bold text-base">{d.name}</span>
                            {nearRec && (
                              <span className="flex items-center gap-1 rounded bg-volt-500/20 px-1.5 py-0.5 font-pixel text-[10px] text-volt-300">
                                <BadgeCheck size={12} /> NEAR #{nearRec.challengeId}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-zinc-400">Par: {d.par ?? 20} moves · Difficulty D{d.difficulty}</span>
                        </div>
                        <Difficulty level={d.difficulty} />
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-ink-700/60">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              void (async () => {
                                const code = nearRec?.shareCode || d.id
                                const link = await buildShareLink(`/?c=${code}`)
                                await copy(link, 'Challenge link')
                              })()
                            }}
                          >
                            <Copy size={13} /> Copy Link
                          </Button>
                          {!nearRec && (
                            <Button
                              size="sm"
                              variant="volt"
                              disabled={!nearAccount || nearBusy}
                              onClick={() => {
                                setSelected(index)
                                void registerNearChallenge()
                              }}
                            >
                              Register (0.05 NEAR)
                            </Button>
                          )}
                        </div>
                        <Button size="sm" onClick={() => playDungeon(d, true)}>
                          <Play size={14} /> Practice
                        </Button>
                      </div>
                    </Panel>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* --- TAB 3: JOIN BY CODE --- */}
        {tab === 'join' && (
          <div className="flex flex-col gap-3">
            <Panel>
              <Label className="mb-2">Enter Challenge Code or Link</Label>
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste TRI1... share code, link, or room code..."
                  className="h-11 flex-1 rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm text-zinc-100 outline-none focus:border-volt-400"
                />
                <Button variant="volt" onClick={() => void lookup(input)} disabled={checking || !input.trim()}>
                  {checking ? <Loader2 size={16} className="animate-spin" /> : 'Inspect'}
                </Button>
              </div>
              {error && (
                <div className="mt-2">
                  <Notice tone="error">{error}</Notice>
                </div>
              )}
            </Panel>

            {joined && (
              <Panel className="flex flex-col gap-3 border-volt-400">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-lg">{joined.dungeon.name}</span>
                      {joined.verified && (
                        <span className="flex items-center gap-1 rounded bg-volt-500/20 px-2 py-0.5 font-pixel text-xs text-volt-300">
                          <BadgeCheck size={14} /> Verified #{joined.verified.id}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-400">by {joined.dungeon.creator.displayName}</span>
                  </div>
                  <Difficulty level={joined.dungeon.difficulty} />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-ink-700/60">
                  <span className="font-pixel text-xs text-zinc-400">Par: {joined.dungeon.par ?? 20} moves</span>
                  <Button variant="volt" onClick={() => playDungeon(joined.dungeon, false)}>
                    <Play size={16} /> Enter Dungeon
                  </Button>
                </div>
              </Panel>
            )}
          </div>
        )}
      </div>
    </Screen>
  )
}
