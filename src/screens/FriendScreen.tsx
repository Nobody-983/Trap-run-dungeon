import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Copy, ExternalLink, Hammer, Link2, Loader2, LogOut, Play, Search, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { inbox } from '@/app/inbox'
import { useNav } from '@/app/nav'
import { Difficulty, Label, MiniDungeon, Notice, Panel, Screen, Button } from '@/components/ui'
import { encodeCanonicalShareCode, type DecodedCanonicalShare, decodeCanonicalShareCode } from '@/game/canonicalIdentity'
import { decodeDungeon } from '@/game/codec'
import { validateDungeon } from '@/game/validate'
import type { Dungeon } from '@/game/types'
import { buildShareLink } from '@/lib/share'
import { profileStore, useProfile } from '@/progress/store'
import { services } from '@/services'
import { NEAR_CONFIG, NEAR_NETWORK_LABEL, nearTxUrl } from '@/services/chain/near'
import type { NearTransactionPhase } from '@/services/chain/nearWallet'
import { getChallengeByCode, publishDungeon, createChallenge } from '@/services/supabase'

type Tab = 'host' | 'join'
type NearPhase = 'idle' | 'connecting' | 'wallet-approval' | 'pending-finality'

interface Joined {
  dungeon: Dungeon
  verified: { chain: 'near' | 'supabase'; id: string; creator: string } | null
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
  const [tab, setTab] = useState<Tab>(() => (inbox.code || p.published.length === 0 ? 'join' : 'host'))
  const [input, setInput] = useState(() => {
    const code = inbox.code
    inbox.code = null
    return code ?? ''
  })
  const [selected, setSelected] = useState(0)
  const [joined, setJoined] = useState<Joined | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [nearLink, setNearLink] = useState<string | null>(null)
  const [nearAccount, setNearAccount] = useState<string | null>(null)
  const [nearPhase, setNearPhase] = useState<NearPhase>('idle')
  const [nearError, setNearError] = useState<string | null>(null)

  const hosted = p.published[selected] ?? null
  const nearChallenges = useMemo(() => p.nearChallenges.filter((entry) => hosted && entry.dungeonId === hosted.id), [p.nearChallenges, hosted])
  const latestNear = nearChallenges[0] ?? null

  useEffect(() => {
    let live = true
    if (latestNear?.shareCode) {
      void buildShareLink(`/?c=${latestNear.shareCode}`).then((link) => {
        if (live) setNearLink(link)
      })
    }
    return () => {
      live = false
    }
  }, [latestNear?.shareCode])

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
      const msg = cause instanceof Error ? cause.message : 'Could not connect MyNearWallet'
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

      // Also persist to Supabase backend
      await publishDungeon({
        dungeon: hosted,
        creatorNearAccount: registration.creator,
        title: hosted.name,
        par: hosted.par ?? 20,
        difficulty: hosted.difficulty,
        nearRegistryId: registration.challengeId,
      })

      await createChallenge({
        dungeonId: hosted.id,
        creatorNearAccount: registration.creator,
        challengeCode: shareCode,
      })

      toast.success(`Challenge #${registration.challengeId} registered on NEAR testnet!`)
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

      if (
        decoded.registry.chain !== 'near' ||
        decoded.registry.network !== 'testnet' ||
        decoded.registry.registry !== NEAR_CONFIG.registryAccountId
      ) {
        return setError('This challenge was registered on an unsupported registry or network.')
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

    // Check Supabase backend for registered challenge code
    setChecking(true)
    try {
      const challengeRec = await getChallengeByCode(text)
      if (challengeRec) {
        if (challengeRec.challenge_code.startsWith('TRI1.')) {
          return lookupNear(challengeRec.challenge_code)
        }
      }
    } catch {
      // continue to local fallback
    }

    // Local room code fallback
    const stored = p.rooms[text.toUpperCase()]
    const code = stored || (/^[A-Za-z0-9_-]+$/.test(text) ? text : null)
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
      verified: { chain: 'supabase', id: text, creator: dungeon.creator.displayName },
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

  const play = (dungeon: Dungeon, own: boolean) => {
    go({
      name: 'play',
      dungeon: { ...dungeon, par: dungeon.par ?? validateDungeon(dungeon).par ?? undefined },
      mode: own ? 'test' : 'friend',
      back: { name: 'friend' },
      next: null,
      attempt: Date.now(),
    })
  }

  const nearBusy = nearPhase === 'connecting' || nearPhase === 'wallet-approval' || nearPhase === 'pending-finality'

  return (
    <Screen title="Challenge a Friend" onBack={() => go({ name: 'modes' })}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-800 p-1" role="tablist">
          {(['host', 'join'] as const).map((nextTab) => (
            <button
              key={nextTab}
              role="tab"
              aria-selected={tab === nextTab}
              onClick={() => setTab(nextTab)}
              className={`min-h-11 rounded-lg font-display text-sm font-semibold uppercase tracking-wider transition ${tab === nextTab ? 'bg-volt-500 text-white shadow-volt' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              {nextTab === 'host' ? 'Send a challenge' : 'Join a challenge'}
            </button>
          ))}
        </div>

        <Notice>
          NEAR Protocol (<span className="text-volt-300">testnet</span>): Challenges are registered on-chain with deterministic SHA-256 hashes and stored in Supabase.
        </Notice>

        {tab === 'host' && (
          <>
            {p.published.length === 0 ? (
              <Panel className="flex flex-col items-center gap-3 py-10 text-center">
                <Hammer size={28} className="text-volt-400" />
                <div className="font-display text-lg font-bold">No dungeons to share yet</div>
                <p className="max-w-xs text-sm text-zinc-400">Build and save a solver-checked dungeon in Creator Mode first.</p>
                <Button variant="primary" onClick={() => go({ name: 'editor' })}>Open Creator Mode</Button>
              </Panel>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {p.published.map((dungeon, index) => (
                    <button key={dungeon.id} onClick={() => setSelected(index)} className={`shrink-0 rounded-xl border p-2 text-left transition ${index === selected ? 'border-volt-400 bg-volt-500/10' : 'border-ink-500 bg-ink-800/70'}`}>
                      <MiniDungeon dungeon={dungeon} px={72} />
                      <div className="mt-1 max-w-[72px] truncate text-xs font-semibold">{dungeon.name}</div>
                    </button>
                  ))}
                </div>
                {hosted && (
                  <>
                    <Panel className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-display text-lg font-bold">{hosted.name}</div>
                          <div className="text-xs text-zinc-500">Created by {hosted.creator.displayName}</div>
                        </div>
                        <Difficulty level={hosted.difficulty} />
                      </div>
                      <Button onClick={() => play(hosted, true)}><Play size={16} className="fill-current" /> Test-run it (free)</Button>
                    </Panel>

                    {/* NEAR Registry Section */}
                    <Panel className="flex flex-col gap-3 border border-acid-500/30">
                      <div className="flex items-center justify-between">
                        <Label>NEAR registry · TRI1</Label>
                        <span className="font-pixel text-[11px] text-acid-400">{NEAR_NETWORK_LABEL}</span>
                      </div>

                      {!NEAR_CONFIG.configured && (
                        <p className="text-xs text-zinc-400">Set VITE_NEAR_REGISTRY_ACCOUNT in .env to activate the testnet registry.</p>
                      )}

                      {NEAR_CONFIG.configured && !nearAccount && (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-zinc-400">Connect MyNearWallet to register this challenge on NEAR testnet.</p>
                          <Button variant="volt" onClick={() => void connectNear()} disabled={nearBusy}>
                            {nearBusy ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />} Connect MyNearWallet
                          </Button>
                        </div>
                      )}

                      {NEAR_CONFIG.configured && nearAccount && (
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between rounded-lg bg-ink-900 p-2 text-xs">
                            <span className="text-zinc-400">Connected:</span>
                            <span className="font-mono text-acid-300">{nearAccount}</span>
                            <button onClick={() => void disconnectNear()} className="text-zinc-500 hover:text-zinc-300" title="Disconnect">
                              <LogOut size={14} />
                            </button>
                          </div>

                          {latestNear && (
                            <div className="flex flex-col gap-2 rounded-xl bg-ink-900/60 p-3">
                              <div className="flex items-center justify-between">
                                <Label>Challenge #{latestNear.challengeId} registered</Label>
                                <a href={nearTxUrl(latestNear.txHash)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-acid-400 hover:underline">
                                  Receipt <ExternalLink size={12} />
                                </a>
                              </div>
                              <div className="break-all rounded-lg bg-ink-950 p-2 font-mono text-[11px] text-zinc-300">{latestNear.shareCode}</div>
                              <div className="grid grid-cols-2 gap-2">
                                <Button size="sm" onClick={() => void copy(latestNear.shareCode, 'TRI1 code')}>
                                  <Copy size={14} /> Copy code
                                </Button>
                                <Button size="sm" variant="volt" disabled={!nearLink} onClick={() => nearLink && void copy(nearLink, 'Challenge link')}>
                                  <Link2 size={14} /> Copy link
                                </Button>
                              </div>
                            </div>
                          )}

                          <Button
                            variant={latestNear ? 'ghost' : 'volt'}
                            disabled={nearBusy}
                            onClick={() => void registerNearChallenge()}
                          >
                            {nearBusy && <Loader2 size={16} className="animate-spin" />}
                            {nearPhase === 'wallet-approval' ? 'Confirm in MyNearWallet...' : nearPhase === 'pending-finality' ? 'Awaiting testnet finality...' : latestNear ? 'Re-register on NEAR' : 'Register challenge on NEAR'}
                          </Button>
                        </div>
                      )}

                      {nearError && <Notice tone="error">{nearError}</Notice>}
                    </Panel>
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === 'join' && (
          <>
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void lookup(input) }}>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Paste TRI1 code, share link, or challenge code"
                aria-label="Challenge code"
                className="h-12 min-w-0 flex-1 rounded-xl border border-ink-500 bg-ink-900 px-3 text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-volt-400"
              />
              <Button variant="volt" type="submit" disabled={checking}>
                {checking ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Find
              </Button>
            </form>

            {error && <Notice tone="error">{error}</Notice>}

            {joined && (
              <Panel className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-lg font-bold">{joined.dungeon.name}</div>
                    <div className="text-xs text-zinc-400">Created by {joined.dungeon.creator.displayName}</div>
                  </div>
                  {joined.verified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-acid-500/20 px-2 py-0.5 text-xs text-acid-300">
                      <BadgeCheck size={14} /> {joined.verified.chain.toUpperCase()} Verified
                    </span>
                  )}
                </div>

                <div className="flex justify-center">
                  <MiniDungeon dungeon={joined.dungeon} px={160} />
                </div>

                <Button variant="volt" size="lg" onClick={() => play(joined.dungeon, false)}>
                  <Play size={18} className="fill-current" /> Play this challenge
                </Button>
              </Panel>
            )}
          </>
        )}
      </div>
    </Screen>
  )
}
