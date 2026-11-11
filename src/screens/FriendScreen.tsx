import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Copy, ExternalLink, Hammer, Link2, Loader2, LogOut, Play, Search, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { usePublicClient } from 'wagmi'
import { inbox } from '@/app/inbox'
import { useNav } from '@/app/nav'
import { playRoute } from '@/app/routes'
import { AuthCard, shortAddress } from '@/components/AccountPanel'
import { PayStatus } from '@/components/PayStatus'
import { Button, Difficulty, Label, MiniDungeon, Notice, Panel, Screen } from '@/components/ui'
import { decodeCanonicalShareCode, encodeCanonicalShareCode } from '@/game/canonicalIdentity'
import { decodeChallengeId, decodeDungeon, encodeDungeon, extractCode, roomCodeFor } from '@/game/codec'
import { PRACTICE_LEVELS } from '@/game/levels'
import type { Dungeon } from '@/game/types'
import { validateDungeon } from '@/game/validate'
import { buildShareLink } from '@/lib/share'
import { profileStore, useProfile } from '@/progress/store'
import { services } from '@/services'
import { NEAR_CONFIG, NEAR_NETWORK_LABEL, nearTxUrl } from '@/services/chain/near'
import type { NearRegistryChallenge } from '@/services/chain/nearRegistry'
import { NETWORK_LABEL } from '@/web3/network'
import { ARC_CHAIN_ID, SHOP_ABI, SHOP_ADDRESS, dungeonHashOf, formatUsdcAmount } from '@/web3/shop'
import { usePurchase } from '@/web3/usePurchase'
import { useShopPrices } from '@/web3/useShopData'

type Tab = 'host' | 'join'
type NearPhase = 'idle' | 'connecting' | 'wallet-approval' | 'pending-finality' | 'success' | 'failure'

const DEMO: Dungeon = {
  ...PRACTICE_LEVELS[8].dungeon,
  id: 'f-demo-room',
  name: 'Demo Crossfire',
  source: 'friend',
  creator: { profileId: 'demo', displayName: 'NEON_WRAITH' },
}

interface Joined {
  dungeon: Dungeon
  verified: { chain: 'arc' | 'near'; id: string; creator: string } | null
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
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const prices = useShopPrices()
  const pay = usePurchase()
  const arcAddress = p.wallets.find((wallet) => wallet.chain === 'arc')?.accountId ?? null
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
  const [arcLink, setArcLink] = useState<string | null>(null)
  const [nearLink, setNearLink] = useState<string | null>(null)
  const [lastArcHash, setLastArcHash] = useState<string | null>(null)
  const [nearAccount, setNearAccount] = useState<string | null>(null)
  const [nearPhase, setNearPhase] = useState<NearPhase>('idle')
  const [nearError, setNearError] = useState<string | null>(null)
  const [nearTxHash, setNearTxHash] = useState<string | null>(null)
  const [nearHistory, setNearHistory] = useState<NearRegistryChallenge[]>([])

  const hosted = p.published[selected] ?? null
  const arcChallenges = useMemo(() => p.challenges.filter((entry) => hosted && entry.dungeonId === hosted.id), [p.challenges, hosted])
  const latestArc = arcChallenges[0] ?? null
  const arcCode = hosted && latestArc ? encodeDungeon(hosted, latestArc.challengeId) : null
  const nearChallenges = useMemo(() => p.nearChallenges.filter((entry) => hosted && entry.dungeonId === hosted.id), [p.nearChallenges, hosted])
  const latestNear = nearChallenges[0] ?? null
  const room = hosted ? roomCodeFor(hosted) : null

  useEffect(() => {
    let live = true
    setArcLink(null)
    if (arcCode) void buildShareLink(`/?c=${arcCode}`).then((link) => live && setArcLink(link))
    return () => {
      live = false
    }
  }, [arcCode])

  useEffect(() => {
    let live = true
    setNearLink(null)
    if (latestNear) void buildShareLink(`/?c=${latestNear.shareCode}`).then((link) => live && setNearLink(link))
    return () => {
      live = false
    }
  }, [latestNear])

  useEffect(() => {
    let live = true
    void services.near.wallet.restore().then((session) => {
      if (!live || !session) return
      setNearAccount(session.identity.accountId)
      void loadNearHistory(session.identity.accountId, live)
    })
    return () => {
      live = false
    }
    // restore only once; the screen owns subsequent connect/disconnect state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadNearHistory = async (accountId: string, live = true) => {
    try {
      const page = await services.near.registry.getChallengesByCreator(accountId, 0n, 10)
      if (live) setNearHistory(page)
    } catch {
      if (live) setNearHistory([])
    }
  }

  const connectNear = async () => {
    setNearPhase('connecting')
    setNearError(null)
    try {
      const session = await services.near.wallet.connect()
      setNearAccount(session.identity.accountId)
      setNearPhase('idle')
      await loadNearHistory(session.identity.accountId)
    } catch (cause) {
      setNearPhase('failure')
      setNearError(cause instanceof Error ? cause.message : 'Could not connect MyNearWallet')
    }
  }

  const disconnectNear = async () => {
    await services.near.wallet.disconnect()
    setNearAccount(null)
    setNearHistory([])
    setNearPhase('idle')
    setNearError(null)
  }

  const createArcChallenge = async () => {
    if (!hosted || !prices.data) return
    const result = await pay.run({
      kind: 'challenge',
      label: hosted.name,
      price: prices.data.challengeFee,
      call: { fn: 'createChallenge', hash: dungeonHashOf(hosted) },
    })
    if (!result || result.challengeId === null) return
    const id = Number(result.challengeId)
    profileStore.recordChallenge({ dungeonId: hosted.id, challengeId: id, txHash: result.hash, at: Date.now() })
    profileStore.saveRoom(roomCodeFor(hosted), encodeDungeon(hosted, id))
    setLastArcHash(result.hash)
    toast.success(`Arc challenge #${id} created`)
  }

  const registerNearChallenge = async () => {
    if (!hosted || !nearAccount) return
    setNearError(null)
    setNearTxHash(null)
    try {
      const registration = await services.near.registry.registerChallenge(hosted, {
        onPhase: (phase) => setNearPhase(phase),
      })
      const shareCode = encodeCanonicalShareCode({
        dungeon: hosted,
        challengeId: registration.challengeId,
        registry: { chain: 'near', network: 'testnet', registry: NEAR_CONFIG.registryAccountId },
      })
      profileStore.recordNearChallenge({
        dungeonId: hosted.id,
        challengeId: registration.challengeId.toString(),
        creator: registration.creator,
        txHash: registration.txHash,
        shareCode,
        at: Date.now(),
      })
      setNearTxHash(registration.txHash)
      setNearPhase('success')
      await loadNearHistory(registration.creator)
      toast.success(`NEAR challenge #${registration.challengeId} registered`)
    } catch (cause) {
      setNearPhase('failure')
      setNearError(cause instanceof Error ? cause.message : 'NEAR registration failed')
    }
  }

  const lookupNear = async (code: string) => {
    let decoded: ReturnType<typeof decodeCanonicalShareCode>
    try {
      decoded = decodeCanonicalShareCode(code)
    } catch {
      return setError('That NEAR challenge code is malformed or unsupported.')
    }
    if (
      decoded.registry.chain !== 'near' ||
      decoded.registry.network !== 'testnet' ||
      decoded.registry.registry !== NEAR_CONFIG.registryAccountId
    ) {
      return setError('This code belongs to a different network or registry. Only the configured NEAR testnet registry is accepted.')
    }
    if (decoded.challengeId === null) return setError('This TRI1 code contains a dungeon but no registered challenge ID.')
    const candidate: Dungeon = {
      ...decoded.dungeon,
      id: `near-${decoded.challengeId}`,
      name: `NEAR Challenge #${decoded.challengeId}`,
      creator: { profileId: 'near:pending', displayName: 'NEAR creator' },
      source: 'friend',
      difficulty: 3,
      createdAt: Date.now(),
    }
    const validation = validateDungeon(candidate)
    if (!validation.ok) return setError(`This dungeon is not valid: ${validation.errors[0]}`)
    setChecking(true)
    try {
      const challenge = await services.near.registry.getChallenge(decoded.challengeId)
      if (!challenge) return setError(`NEAR challenge #${decoded.challengeId} does not exist.`)
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

    let code = extractCode(text)
    if (!code) {
      const stored = p.rooms[text.toUpperCase()]
      if (stored) code = stored
      else if (/^[A-Za-z0-9]{6}$/.test(text)) return setError('That room code is not on this device. Ask your friend for the full code or link.')
    }
    const dungeon = code ? decodeDungeon(code) : null
    if (!code || !dungeon) return setError('That code could not be read. Check that you copied all of it.')
    const validation = validateDungeon(dungeon)
    if (!validation.ok) return setError(`This dungeon is not valid: ${validation.errors[0]}`)
    const full = { ...dungeon, par: validation.par ?? undefined }
    const id = decodeChallengeId(code)
    if (!id) return setError('This TR1 code is not an Arc challenge. Ask your friend to create the challenge in the app.')
    if (!SHOP_ADDRESS || !client) return setError('Arc challenges cannot be verified because the shop is not configured.')
    setChecking(true)
    try {
      const [creator, hash] = await Promise.all([
        client.readContract({ address: SHOP_ADDRESS, abi: SHOP_ABI, functionName: 'challengeCreator', args: [BigInt(id)] }),
        client.readContract({ address: SHOP_ADDRESS, abi: SHOP_ABI, functionName: 'challengeDungeon', args: [BigInt(id)] }),
      ])
      if (/^0x0+$/.test(creator) || hash.toLowerCase() !== dungeonHashOf(full).toLowerCase()) {
        setError('This Arc challenge could not be found onchain, or the dungeon was changed.')
      } else {
        setJoined({ dungeon: full, verified: { chain: 'arc', id: String(id), creator } })
      }
    } catch {
      setError(`Could not reach ${NETWORK_LABEL} to verify this challenge. Check your connection and try again.`)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (input && tab === 'join') void lookup(input)
    // Run once for a share link that arrived with a code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const play = (dungeon: Dungeon, own: boolean) => {
    go(playRoute({ ...dungeon, par: dungeon.par ?? validateDungeon(dungeon).par ?? undefined }, own ? 'test' : 'friend', { name: 'friend' }, null))
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

        <Notice>Arc/TR1 challenges and NEAR testnet/TRI1 challenges remain separate. Friends play either format without an onchain payment.</Notice>

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

                    <Panel className="flex flex-col gap-3">
                      <Label>Arc challenge · legacy TR1</Label>
                      {!arcAddress && <AuthCard reason="Arc challenge creation uses the existing USDC shop flow." />}
                      {arcCode && latestArc && (
                        <>
                          <div><Label>Challenge #{latestArc.challengeId} · room code</Label><div className="tabular font-pixel text-3xl tracking-[0.2em] text-acid-500">{room}</div></div>
                          <div className="break-all rounded-lg bg-ink-900 p-2 font-mono text-xs text-zinc-300">{arcCode}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button onClick={() => void copy(arcCode, 'Arc code')}><Copy size={15} /> Copy code</Button>
                            <Button variant="volt" disabled={!arcLink} onClick={() => arcLink && void copy(arcLink, 'Arc link')}><Link2 size={15} /> Copy link</Button>
                          </div>
                        </>
                      )}
                      <Button variant={latestArc ? 'ghost' : 'primary'} disabled={!arcAddress || !prices.data || pay.busy || !SHOP_ADDRESS} onClick={() => void createArcChallenge()}>
                        {pay.busy && <Loader2 size={16} className="animate-spin" />}
                        {prices.data ? `${latestArc ? 'New Arc challenge' : 'Create Arc challenge'} · ${formatUsdcAmount(prices.data.challengeFee)} USDC` : 'Create Arc challenge'}
                      </Button>
                      <PayStatus step={pay.step} error={pay.error} hash={lastArcHash} />
                    </Panel>

                    <Panel className="flex flex-col gap-3">
                      <div>
                        <Label>NEAR registry · TRI1</Label>
                        <p className="mt-1 text-sm text-zinc-400">Registers the exact canonical 32-byte dungeon hash on {NEAR_NETWORK_LABEL}. The contract measures storage and refunds the unused deposit buffer.</p>
                      </div>
                      {!NEAR_CONFIG.configured && <Notice tone="error">NEAR registration is disabled until VITE_NEAR_REGISTRY_ACCOUNT names a deployed testnet registry.</Notice>}
                      {nearAccount ? (
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-ink-900/60 px-3 py-2 text-sm">
                          <span><Wallet size={14} className="mr-1 inline text-acid-500" /> {nearAccount}</span>
                          <Button size="sm" onClick={() => void disconnectNear()} disabled={nearBusy}><LogOut size={14} /> Disconnect</Button>
                        </div>
                      ) : (
                        <Button variant="volt" onClick={() => void connectNear()} disabled={nearBusy || !NEAR_CONFIG.configured}>
                          {nearPhase === 'connecting' ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />} Connect MyNearWallet
                        </Button>
                      )}

                      {latestNear && (
                        <>
                          <Notice tone="ok">Registered as challenge #{latestNear.challengeId} by {latestNear.creator}.</Notice>
                          <div className="break-all rounded-lg bg-ink-900 p-2 font-mono text-xs text-zinc-300">{latestNear.shareCode}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button onClick={() => void copy(latestNear.shareCode, 'NEAR code')}><Copy size={15} /> Copy TRI1</Button>
                            <Button variant="volt" disabled={!nearLink} onClick={() => nearLink && void copy(nearLink, 'NEAR link')}><Link2 size={15} /> Copy link</Button>
                          </div>
                        </>
                      )}

                      <Button variant={latestNear ? 'ghost' : 'primary'} onClick={() => void registerNearChallenge()} disabled={!nearAccount || nearBusy}>
                        {nearBusy && nearPhase !== 'connecting' && <Loader2 size={16} className="animate-spin" />}
                        {nearPhase === 'wallet-approval' ? 'Approve in MyNearWallet' : nearPhase === 'pending-finality' ? 'Waiting for finality' : latestNear ? 'Register another NEAR challenge' : 'Register on NEAR testnet'}
                      </Button>
                      <p className="text-xs text-zinc-500">Attaches the configured storage buffer only; no token, NFT, XP or gameplay payment is created.</p>
                      {nearError && <Notice tone="error">{nearError}</Notice>}
                      {nearPhase === 'success' && nearTxHash && (
                        <a href={nearTxUrl(nearTxHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-acid-400">Final transaction receipt <ExternalLink size={13} /></a>
                      )}
                      {nearHistory.length > 0 && (
                        <div>
                          <Label>Your latest registry IDs</Label>
                          <div className="mt-1 text-sm text-zinc-400">{nearHistory.map((entry) => `#${entry.challenge_id}`).join(' · ')}</div>
                        </div>
                      )}
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
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste TR1/TRI1 code, link or room code" aria-label="Challenge code" className="h-12 min-w-0 flex-1 rounded-xl border border-ink-500 bg-ink-900 px-3 text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-volt-400" />
              <Button variant="volt" type="submit" disabled={checking}>{checking ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Find</Button>
            </form>
            {error && <Notice tone="error">{error}</Notice>}
            {joined && (
              <Panel className="flex items-center gap-4">
                <MiniDungeon dungeon={joined.dungeon} px={96} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-lg font-bold">{joined.dungeon.name}</div>
                  <div className="text-sm text-zinc-400">by {joined.dungeon.creator.displayName}</div>
                  {joined.verified ? (
                    <div className="mt-1 flex items-center gap-1 text-xs text-acid-300"><BadgeCheck size={13} /> {joined.verified.chain === 'near' ? 'NEAR testnet' : 'Arc'} challenge #{joined.verified.id} verified · {shortAddress(joined.verified.creator)}</div>
                  ) : <div className="mt-1 text-xs text-zinc-500">Local demo room</div>}
                  <div className="mt-1"><Difficulty level={joined.dungeon.difficulty} /></div>
                </div>
                <Button variant="primary" onClick={() => play(joined.dungeon, false)}><Play size={16} className="fill-current" /> Run</Button>
              </Panel>
            )}
            {!joined && !error && !checking && (
              <Panel className="flex flex-col items-center gap-3 py-8 text-center">
                <Users size={28} className="text-volt-400" />
                <p className="max-w-xs text-sm text-zinc-400">TR1 preserves the existing Arc flow. TRI1 recomputes and verifies the canonical SHA-256 hash against NEAR testnet.</p>
                <Button onClick={() => setJoined({ dungeon: { ...DEMO, par: validateDungeon(DEMO).par ?? undefined }, verified: null })}>Load a demo room</Button>
              </Panel>
            )}
          </>
        )}
      </div>
    </Screen>
  )
}
