import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  FlaskConical,
  FolderOpen,
  Hammer,
  Loader2,
  Redo2,
  Save,
  Share2,
  Timer,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useNav } from '@/app/nav'
import { Bar, Button, Label, Notice, Panel, Screen } from '@/components/ui'
import { ToolIcon } from '@/editor/ToolIcon'
import { TOOLS, estimateDifficulty, place, toolCost, toolUsage, type Tool } from '@/editor/tools'
import { encodeCanonicalShareCode } from '@/game/canonicalIdentity'
import { encodeDungeon, layoutId, roomCodeFor } from '@/game/codec'
import { validateDungeon, type ValidationResult } from '@/game/validate'
import {
  BUDGET,
  CREATOR_EXIT,
  CREATOR_START,
  budgetSpent,
  emptyCells,
  idx,
  type CellType,
  type Dungeon,
} from '@/game/types'
import { sfx } from '@/lib/audio'
import { buildShareLink } from '@/lib/share'
import { profileStore, useProfile } from '@/progress/store'
import { DungeonCanvas } from '@/render/DungeonCanvas'
import { services } from '@/services'
import { NEAR_CONFIG } from '@/services/chain/near'
import type { NearTransactionPhase } from '@/services/chain/nearWallet'
import {
  verifyNearPublishingTransaction,
  syncVerifiedPublishingToSupabase,
} from '@/services/chain/nearTransactionVerifier'
import { addOrUpdateCommunityDungeon } from '@/services/community/catalog'
import { PlayScreen } from './PlayScreen'

const BUILD_MS = 30_000
const isFixed = (x: number, y: number) => (x === CREATOR_START.x && y === CREATOR_START.y) || (x === CREATOR_EXIT.x && y === CREATOR_EXIT.y)

export function EditorScreen() {
  const nav = useNav()
  const profile = useProfile()
  const timed = profile.settings.buildTimer
  const [draft] = useState(() => profile.draft)

  const [cells, setCells] = useState<CellType[]>(() => draft?.cells ?? emptyCells())
  const [history, setHistory] = useState<CellType[][]>([])
  const [future, setFuture] = useState<CellType[][]>([])

  const [started, setStarted] = useState(draft?.started ?? false)
  const [locked, setLocked] = useState(draft?.locked ?? false)
  const [remaining, setRemaining] = useState(draft?.remainingMs ?? BUILD_MS)
  const [tool, setTool] = useState<Tool>('wall')
  const [msg, setMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [cleared, setCleared] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(() => `Dungeon #${profile.published.length + 1}`)
  const [publishing, setPublishing] = useState(false)
  const [publishNearPhase, setPublishNearPhase] = useState<NearTransactionPhase | 'connecting' | 'idle'>('idle')

  // Drafts modal state
  const [draftModalOpen, setDraftModalOpen] = useState(false)
  const [saveDraftName, setSaveDraftName] = useState('')

  const nearAccount = profile.wallets.find((w) => w.chain === 'near')?.accountId ?? null
  const [val, setVal] = useState<{ for: CellType[]; result: ValidationResult } | null>(null)

  const cellsRef = useRef(cells)
  const orderRef = useRef<number[]>(draft?.order ?? [])
  const remRef = useRef(remaining)
  const stroke = useRef<Tool | null>(null)
  const skipSave = useRef(false)
  const flags = useRef({ started, locked })
  const [_pieces, setPieces] = useState(() => draft?.order.length ?? 0)

  useEffect(() => {
    flags.current = { started, locked }
    remRef.current = remaining
  })

  const editable = !(timed && locked) && !testing

  const dungeon = useMemo<Dungeon>(
    () => ({
      id: 'draft',
      name: 'Untitled',
      cells,
      start: CREATOR_START,
      exit: CREATOR_EXIT,
      creator: { profileId: profile.id, displayName: profile.displayName },
      source: 'creator',
      difficulty: 1,
      createdAt: 0,
    }),
    [cells, profile.id, profile.displayName],
  )

  // --- build clock ---
  useEffect(() => {
    if (!timed || !started || locked || testing) return
    let last = performance.now()
    const t = setInterval(() => {
      const now = performance.now()
      const left = Math.max(0, remRef.current - (now - last))
      last = now
      remRef.current = left
      setRemaining(left)
      if (left <= 0) {
        setLocked(true)
        sfx.play('lose')
      }
    }, 100)
    return () => clearInterval(t)
  }, [timed, started, locked, testing])

  // --- live validation ---
  useEffect(() => {
    const t = setTimeout(() => {
      setVal({ for: cells, result: validateDungeon(dungeon, { enforceBudget: true }) })
    }, 180)
    return () => clearTimeout(t)
  }, [cells, dungeon])

  // --- keep active draft so testing / leaving never loses work ---
  const saveActiveDraft = useCallback(() => {
    if (skipSave.current) return
    profileStore.saveDraft({
      cells: cellsRef.current,
      order: orderRef.current,
      remainingMs: remRef.current,
      started: flags.current.started,
      locked: flags.current.locked,
    })
  }, [])

  useEffect(() => {
    saveActiveDraft()
  }, [cells, started, locked, saveActiveDraft])
  useEffect(() => saveActiveDraft, [saveActiveDraft])

  const apply = useCallback(
    (x: number, y: number, t: Tool) => {
      if (!editable) return
      if (isFixed(x, y)) {
        setMsg('The entrance and exit are protected.')
        sfx.play('error')
        return
      }
      const i = idx(x, y)
      const r = place(cellsRef.current, i, t)
      if (!r.ok) {
        if (r.reason) {
          setMsg(r.reason)
          sfx.play('error')
        }
        return
      }

      // Record undo snapshot
      setHistory((prev) => [...prev.slice(-40), cellsRef.current.slice()])
      setFuture([])

      cellsRef.current = r.cells
      orderRef.current = t === 'erase' ? orderRef.current.filter((o) => o !== i) : [...orderRef.current.filter((o) => o !== i), i]
      setCells(r.cells)
      setPieces(orderRef.current.length)
      setStarted(true)
      setMsg(null)
      sfx.play(t === 'erase' ? 'erase' : 'place')
    },
    [editable],
  )

  const undo = useCallback(() => {
    if (!editable || history.length === 0) return
    const prevCells = history[history.length - 1]
    const nextHistory = history.slice(0, -1)
    setFuture((prev) => [cellsRef.current.slice(), ...prev.slice(0, 40)])
    setHistory(nextHistory)

    cellsRef.current = prevCells
    setCells(prevCells)
    setPieces(prevCells.filter((c) => c !== 'empty').length)
    sfx.play('erase')
  }, [editable, history])

  const redo = useCallback(() => {
    if (!editable || future.length === 0) return
    const nextCells = future[0]
    const nextFuture = future.slice(1)
    setHistory((prev) => [...prev.slice(-40), cellsRef.current.slice()])
    setFuture(nextFuture)

    cellsRef.current = nextCells
    setCells(nextCells)
    setPieces(nextCells.filter((c) => c !== 'empty').length)
    sfx.play('place')
  }, [editable, future])

  // Keyboard shortcuts (tools 1-9, E for erase, Undo/Redo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }

      const n = e.key === '0' || e.key.toLowerCase() === 'e' ? TOOLS.length : Number(e.key)
      if (n >= 1 && n <= TOOLS.length) setTool(TOOLS[n - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const resetBoard = (newCells: CellType[], order: number[]) => {
    setHistory((prev) => [...prev.slice(-40), cellsRef.current.slice()])
    setFuture([])
    cellsRef.current = newCells
    orderRef.current = order
    setCells(newCells)
    setPieces(order.length)
  }

  const clearAll = () => {
    resetBoard(emptyCells(), [])
    setStarted(false)
    setLocked(false)
    setRemaining(BUILD_MS)
    setCleared(null)
    setMsg(null)
    sfx.play('erase')
  }

  const autoRepair = () => {
    const next = cellsRef.current.slice()
    const order = orderRef.current.slice()
    while (order.length > 0) {
      const i = order.pop() as number
      next[i] = 'empty'
      if (validateDungeon({ ...dungeon, cells: next }, { enforceBudget: true }).ok) break
    }
    resetBoard(next, order)
    setMsg('Removed latest pieces until an escape route was found.')
    sfx.play('click')
  }

  const result = val && val.for === cells ? val.result : null
  const checking = !result
  const spent = budgetSpent(cells)
  const layoutKey = cells.join(',')
  const clearedByYou = cleared === layoutKey
  const seconds = (remaining / 1000).toFixed(1)
  const urgent = timed && started && !locked && remaining < 8000

  // Playtest transition
  const onTestFinish = useCallback((won: boolean) => {
    setTesting(false)
    if (won) {
      setCleared(cellsRef.current.join(','))
      sfx.play('win')
      toast.success('Dungeon cleared! Certified fair and ready to publish.')
    }
  }, [])
  const onTestExit = useCallback(() => setTesting(false), [])

  if (testing && result?.ok) {
    const testDungeon: Dungeon = {
      ...dungeon,
      name: 'Test Run',
      par: result.par ?? undefined,
      difficulty: estimateDifficulty(dungeon, result.par ?? 0),
    }
    return (
      <PlayScreen
        dungeon={testDungeon}
        mode="test"
        back={{ name: 'editor' }}
        next={null}
        tip="Test run: you must escape your own dungeon to certify it fair before publishing."
        onFinish={onTestFinish}
        onExit={onTestExit}
      />
    )
  }

  // Save named draft slot
  const handleSaveNamedDraft = () => {
    const slotName = saveDraftName.trim() || `Draft ${Object.keys(profile.drafts ?? {}).length + 1}`
    profileStore.saveNamedDraft(slotName, {
      cells: cellsRef.current,
      order: orderRef.current,
      remainingMs: remRef.current,
      started: flags.current.started,
      locked: flags.current.locked,
    })
    toast.success(`Saved draft "${slotName}"`)
    setSaveDraftName('')
    setDraftModalOpen(false)
  }

  // Load named draft slot
  const handleLoadNamedDraft = (nameKey: string) => {
    const loaded = profileStore.loadNamedDraft(nameKey)
    if (!loaded) return
    cellsRef.current = loaded.cells
    orderRef.current = loaded.order
    setCells(loaded.cells)
    setPieces(loaded.order.length)
    setRemaining(loaded.remainingMs)
    setStarted(loaded.started)
    setLocked(loaded.locked)
    setHistory([])
    setFuture([])
    setCleared(null)
    toast.success(`Loaded draft "${nameKey}"`)
    setDraftModalOpen(false)
  }

  // --- Publish off-chain (Free / Share code) ---
  const publishOffChain = async () => {
    if (!result?.ok || !clearedByYou) return
    setPublishing(true)

    const final: Dungeon = {
      ...dungeon,
      id: `c-${layoutId({ cells, start: CREATOR_START, exit: CREATOR_EXIT })}`,
      name: name.trim().slice(0, 24) || 'Untitled',
      par: result.par ?? undefined,
      difficulty: estimateDifficulty(dungeon, result.par ?? 0),
      createdAt: Date.now(),
    }

    const shareCode = encodeDungeon(final)
    profileStore.saveRoom(roomCodeFor(final), shareCode)
    const report = profileStore.publishDungeon(final)

    // Add to community catalog
    addOrUpdateCommunityDungeon({
      id: final.id,
      title: final.name,
      creator: profile.displayName,
      creatorType: 'guest',
      difficulty: final.difficulty,
      par: final.par ?? 20,
      plays: 0,
      clears: 0,
      shareCode,
      createdAt: final.createdAt,
      dungeon: final,
      verifiedOnChain: false,
    })

    skipSave.current = true
    profileStore.saveDraft(null)

    const link = await buildShareLink(`/?c=${shareCode}`)
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Share link copied to clipboard!')
    } catch {
      /* ignore */
    }

    setPublishing(false)
    sfx.play(report.levelAfter > report.levelBefore ? 'levelup' : 'win')
    toast.success(`Published "${final.name}" (+${report.xpGained} XP)`)
    nav.go({ name: 'friend' })
  }

  // --- Publish on-chain (Native NEAR Testnet with fee) ---
  const publishOnNear = async () => {
    if (!result?.ok || !clearedByYou) return
    setPublishing(true)
    setPublishNearPhase('connecting')

    try {
      if (!nearAccount) {
        toast.info('Connecting NEAR wallet...')
        const session = await services.near.wallet.connect()
        profileStore.switchTo(session.identity.accountId)
      }

      setPublishNearPhase('wallet-approval')

      const final: Dungeon = {
        ...dungeon,
        id: `c-${layoutId({ cells, start: CREATOR_START, exit: CREATOR_EXIT })}`,
        name: name.trim().slice(0, 24) || 'Untitled',
        par: result.par ?? undefined,
        difficulty: estimateDifficulty(dungeon, result.par ?? 0),
        createdAt: Date.now(),
      }

      // Attach native NEAR publishing deposit (0.05 NEAR)
      const registration = await services.near.registry.registerChallenge(final, {
        depositYocto: 50_000_000_000_000_000_000_000n, // 0.05 NEAR
        metadata: final.name,
        onPhase: (phase) => setPublishNearPhase(phase),
      })

      const shareCode = encodeCanonicalShareCode({
        dungeon: final,
        registry: { chain: 'near', network: 'testnet', registry: NEAR_CONFIG.registryAccountId },
        challengeId: registration.challengeId,
      })

      profileStore.recordNearChallenge({
        dungeonId: final.id,
        challengeId: registration.challengeId.toString(),
        creator: registration.creator,
        txHash: registration.txHash,
        shareCode,
        at: Date.now(),
      })

      // Independent verification of transaction outcome and event receipt
      const verification = await verifyNearPublishingTransaction({
        txHash: registration.txHash,
        creatorAccountId: registration.creator,
        expectedChallengeId: registration.challengeId.toString(),
        dungeon: final,
      })

      if (!verification.verified) {
        console.warn('[NEAR Publishing] Local verification warning:', verification.error)
      }

      // Reconcile and synchronize with Supabase backend (or buffer in pending sync queue)
      const syncResult = await syncVerifiedPublishingToSupabase({
        txHash: registration.txHash,
        creatorAccountId: registration.creator,
        challengeId: registration.challengeId.toString(),
        dungeon: final,
        shareCode,
        registeredAt: Date.now(),
      })

      // Add to verified community catalog
      addOrUpdateCommunityDungeon({
        id: final.id,
        title: final.name,
        creator: registration.creator,
        creatorType: 'near',
        difficulty: final.difficulty,
        par: final.par ?? 20,
        plays: 0,
        clears: 0,
        shareCode,
        createdAt: final.createdAt,
        dungeon: final,
        verifiedOnChain: true,
        nearChallengeId: registration.challengeId.toString(),
        nearTxHash: registration.txHash,
        origin: 'on-chain',
      })

      const report = profileStore.publishDungeon(final)
      skipSave.current = true
      profileStore.saveDraft(null)

      setPublishing(false)
      setPublishNearPhase('idle')
      sfx.play('win')
      if (syncResult.synced) {
        toast.success(`Published & Synced! Challenge #${registration.challengeId}${report.xpGained ? ` (+${report.xpGained} XP)` : ''}`)
      } else {
        toast.success(`Published on NEAR Testnet! Challenge #${registration.challengeId} (Local cache active)`)
      }
      nav.go({ name: 'friend' })
    } catch (err) {
      setPublishing(false)
      setPublishNearPhase('idle')
      const msg = err instanceof Error ? err.message : 'NEAR publishing failed'
      toast.error(msg)
      sfx.play('error')
    }
  }

  return (
    <Screen
      title="Dungeon Creator"
      wide
      onBack={() => nav.go({ name: 'modes' })}
      right={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setDraftModalOpen(true)}>
            <FolderOpen size={14} /> Drafts
          </Button>
          <Button size="sm" onClick={clearAll}>
            <Trash2 size={14} /> Clear
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,560px)_1fr]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Panel className="!p-3">
              <Label className="flex items-center gap-1">
                <Timer size={11} /> Build Clock
              </Label>
              <div
                className={`tabular font-pixel text-3xl ${
                  locked && timed ? 'text-blood-500' : urgent ? 'animate-glow text-ember-500' : 'text-zinc-50'
                }`}
              >
                {timed ? (locked ? 'TIME UP' : `${seconds}s`) : 'OFF'}
              </div>
              <div className="text-xs text-zinc-500">
                {!timed
                  ? 'Untimed in settings'
                  : started
                    ? locked
                      ? 'Board locked'
                      : 'Hurry!'
                    : 'Starts on your first piece'}
              </div>
            </Panel>
            <Panel className="!p-3">
              <Label>Budget</Label>
              <div className="tabular font-pixel text-3xl text-zinc-50">
                {BUDGET - spent}
                <span className="text-sm text-zinc-500"> / {BUDGET} left</span>
              </div>
              <div className="mt-1">
                <Bar ratio={spent / BUDGET} color={spent > BUDGET - 4 ? 'bg-ember-500' : 'bg-volt-500'} />
              </div>
            </Panel>
          </div>

          <DungeonCanvas
            dungeon={dungeon}
            skinId={profile.equipped.skin}
            trailId={profile.equipped.trail}
            reduceMotion={profile.settings.reducedMotion}
            dim={!editable}
            className="overflow-hidden rounded-xl shadow-volt"
            editor={{
              canEdit: (x, y) => !isFixed(x, y),
              hoverColor: TOOLS.find((t) => t.id === tool)?.color ?? '#9d4dff',
              locked: !editable,
              onDown: (x, y, button) => {
                stroke.current = button === 2 ? 'erase' : tool
                apply(x, y, stroke.current)
              },
              onMove: (x, y) => stroke.current && apply(x, y, stroke.current),
              onUp: () => {
                stroke.current = null
              },
            }}
          />

          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Left-click to paint. Right-click erases. Numbers 1-9 pick tools.</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={undo} disabled={!editable || history.length === 0} title="Undo (Ctrl+Z)">
                <Undo2 size={13} /> Undo
              </Button>
              <Button size="sm" variant="ghost" onClick={redo} disabled={!editable || future.length === 0} title="Redo (Ctrl+Y)">
                <Redo2 size={13} /> Redo
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {/* Tool palette */}
          <Panel>
            <Label className="mb-3">Pieces</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2 xl:grid-cols-5">
              {TOOLS.map((t, i) => {
                const u = toolUsage(cells, t.id)
                const full = u ? u.used >= u.cap && t.id !== 'erase' : false
                const broke = t.id !== 'erase' && spent + toolCost(t.id) > BUDGET
                return (
                  <button
                    key={t.id}
                    disabled={!editable}
                    onClick={() => {
                      setTool(t.id)
                      sfx.play('click')
                    }}
                    title={t.hint}
                    className={`relative flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-center transition active:scale-95 disabled:opacity-40 ${
                      tool === t.id
                        ? 'border-volt-400 bg-volt-500/15 shadow-volt'
                        : 'border-ink-500 bg-ink-900/60 hover:border-ink-400'
                    } ${(full || broke) && t.id !== 'erase' ? 'opacity-50' : ''}`}
                  >
                    <span className="absolute left-1.5 top-1 font-pixel text-[9px] text-zinc-500">
                      {i === TOOLS.length - 1 ? 'E' : i + 1}
                    </span>
                    <ToolIcon tool={t.id} />
                    <span className="text-[11px] font-semibold leading-tight text-zinc-200">{t.label}</span>
                    <span className="tabular font-pixel text-[9px] text-zinc-500">
                      {t.id === 'erase' ? 'refund' : `${toolCost(t.id)} pt${u ? ` · ${u.used}/${u.cap}` : ''}`}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-sm text-zinc-400">{TOOLS.find((t) => t.id === tool)?.hint}</p>
          </Panel>

          {/* Validation & Solver Feedback */}
          <div aria-live="polite" className="flex flex-col gap-2">
            {msg && <Notice tone="error">{msg}</Notice>}
            {checking ? (
              <Notice>
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Verifying escape route and trap logic...
                </span>
              </Notice>
            ) : result.ok ? (
              <Notice tone="ok">
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={16} /> Solvable. Shortest escape is {result.par} moves.
                  {clearedByYou ? (
                    <span className="font-semibold text-acid-400"> Certified fair (cleared by you).</span>
                  ) : (
                    <span className="text-zinc-400"> (Clear in Test Run to certify)</span>
                  )}
                </span>
              </Notice>
            ) : (
              <Notice tone="error">
                <span className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {result.errors.join(' ')}
                </span>
              </Notice>
            )}
          </div>

          {/* Publishing or Action Panel */}
          {naming && result?.ok ? (
            <Panel className="border-volt-500/40">
              <Label className="mb-2">Publish Your Dungeon</Label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 24))}
                maxLength={24}
                autoFocus
                placeholder="Give your creation a title..."
                className="mb-3 h-11 w-full rounded-xl border border-ink-500 bg-ink-900 px-3 text-zinc-50 outline-none focus:border-volt-400"
                aria-label="Dungeon title"
              />

              {!clearedByYou ? (
                <div className="mb-3 rounded-xl border border-ember-500/30 bg-ember-500/10 p-3 text-xs text-ember-300">
                  <p className="font-semibold">Test Run Required</p>
                  <p className="mt-1 text-zinc-400">
                    To prevent troll or impossible levels, you must escape your own dungeon once before it can be published.
                  </p>
                  <Button size="sm" variant="volt" className="mt-2 w-full" onClick={() => setTesting(true)}>
                    <FlaskConical size={14} /> Start Test Run Now
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* NEAR Testnet Publish */}
                  <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-display font-bold text-sm text-zinc-100">Publish to NEAR Testnet</span>
                      <span className="font-pixel text-[11px] text-volt-300">0.05 NEAR</span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-2">
                      Registers canonical hash on-chain, guarantees creator provenance, and lists on the community challenge registry.
                    </p>
                    <Button
                      variant="volt"
                      className="w-full"
                      onClick={() => void publishOnNear()}
                      disabled={publishing}
                    >
                      {publishing && publishNearPhase !== 'idle' ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          {publishNearPhase === 'wallet-approval' ? 'Confirm in Wallet...' : 'Awaiting Finality...'}
                        </>
                      ) : (
                        <>
                          <BadgeCheck size={16} /> Pay 0.05 NEAR & Publish On-Chain
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Free Share Code */}
                  <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-display font-bold text-sm text-zinc-200">Share Off-Chain (Free)</span>
                      <span className="font-pixel text-[11px] text-zinc-400">Free</span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-2">
                      Generates a challenge share link to send directly to friends without blockchain fees.
                    </p>
                    <Button
                      variant="ghost"
                      className="w-full border border-ink-600"
                      onClick={() => void publishOffChain()}
                      disabled={publishing}
                    >
                      <Share2 size={16} /> Generate Share Link
                    </Button>
                  </div>
                </div>
              )}

              <Button className="mt-3 w-full" variant="ghost" onClick={() => setNaming(false)} disabled={publishing}>
                Cancel
              </Button>
            </Panel>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="volt" disabled={!result?.ok} onClick={() => setTesting(true)}>
                <FlaskConical size={16} /> Test Run
              </Button>
              <Button
                variant="primary"
                disabled={!result?.ok}
                onClick={() => setNaming(true)}
                title={!clearedByYou ? 'Must clear dungeon in test run first' : 'Publish your dungeon'}
              >
                <Hammer size={16} /> Publish
              </Button>
              <Button onClick={undo} disabled={!editable || history.length === 0}>
                <Undo2 size={16} /> Undo
              </Button>
              <Button onClick={autoRepair} disabled={!result || result.ok || cells.every((c) => c === 'empty')}>
                <Wand2 size={16} /> Auto-Repair
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Drafts Manager Modal */}
      {draftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm">
          <Panel className="w-full max-w-md border-ink-500">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Saved Drafts</h3>
              <Button size="sm" variant="ghost" onClick={() => setDraftModalOpen(false)}>
                ✕
              </Button>
            </div>

            {/* Save current draft */}
            <div className="mb-4 flex gap-2">
              <input
                value={saveDraftName}
                onChange={(e) => setSaveDraftName(e.target.value)}
                placeholder="Name this draft..."
                className="h-10 flex-1 rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm text-zinc-100 outline-none focus:border-volt-400"
              />
              <Button size="sm" variant="volt" onClick={handleSaveNamedDraft}>
                <Save size={14} /> Save Slot
              </Button>
            </div>

            {/* Draft list */}
            <div className="flex max-h-60 flex-col gap-2 overflow-y-auto pr-1">
              {Object.keys(profile.drafts ?? {}).length === 0 ? (
                <p className="py-4 text-center text-xs text-zinc-500">No named drafts saved yet.</p>
              ) : (
                Object.entries(profile.drafts ?? {}).map(([key, d]) => (
                  <div key={key} className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900/60 p-2.5">
                    <div>
                      <div className="font-semibold text-sm text-zinc-200">{key}</div>
                      <div className="text-[11px] text-zinc-500">{d.cells.filter((c) => c !== 'empty').length} pieces placed</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => handleLoadNamedDraft(key)}>
                        Load
                      </Button>
                      <button
                        onClick={() => profileStore.deleteNamedDraft(key)}
                        className="rounded p-1 text-zinc-500 hover:text-blood-400"
                        title="Delete draft"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      )}
    </Screen>
  )
}
