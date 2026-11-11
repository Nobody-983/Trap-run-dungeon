import { analyze, initialState, stepGame, type Analysis } from '../../game/engine'
import { computeScore } from '../../game/result'
import { START_LIVES } from '../../game/run'
import { canonicalDungeonHashHex } from '../../game/canonicalIdentity'
import { validateDungeon } from '../../game/validate'
import { recordVerifiedScore } from '../supabase/leaderboard'
import type { Action, Dungeon, RunState } from '../../game/types'

const COMBO_WINDOW = 8
const NEAR_MISS_BONUS_CAP = 6
const MIN_MS_PER_MOVE = 50
const MAX_ACTIONS_LENGTH = 1500

export interface RunSubmission {
  dungeon: Dungeon
  playerNearAccount: string
  actions: string
  clientElapsedMs: number
  challengeId?: string | null
  attemptId: string
  clientScore?: number
}

export interface ValidationSuccess {
  ok: true
  authoritativeScore: number
  authoritativeTimeMs: number
  moves: number
  livesLost: number
  comboBonus: number
  nearMisses: number
  dungeonHash: string
}

export interface ValidationFailure {
  ok: false
  reason: string
}

export type RunValidationResult = ValidationSuccess | ValidationFailure

// Idempotency cache preventing duplicate processing of the exact same attempt
const processedAttempts = new Set<string>()

export async function validateRunSubmission(submission: RunSubmission): Promise<RunValidationResult> {
  const { dungeon, playerNearAccount, actions, clientElapsedMs, attemptId, challengeId } = submission

  // 1. Validate player identity
  if (!playerNearAccount || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(playerNearAccount) || playerNearAccount.length < 2 || playerNearAccount.length > 64) {
    return { ok: false, reason: 'Invalid NEAR account identifier' }
  }

  // 2. Validate attempt idempotency
  const idempotencyKey = `${playerNearAccount}:${attemptId}`
  if (processedAttempts.has(idempotencyKey)) {
    return { ok: false, reason: 'Duplicate submission rejected: attempt already processed' }
  }

  // 3. Validate dungeon rules and reachability
  const validation = validateDungeon(dungeon)
  if (!validation.ok) {
    return { ok: false, reason: `Invalid dungeon rules: ${validation.errors.join('; ')}` }
  }
  const par = validation.par ?? 1

  // 4. Validate actions syntax
  if (!actions || typeof actions !== 'string') {
    return { ok: false, reason: 'Missing action trace' }
  }
  const normalizedActions = actions.toUpperCase()
  if (normalizedActions.length > MAX_ACTIONS_LENGTH) {
    return { ok: false, reason: `Action trace exceeds maximum length of ${MAX_ACTIONS_LENGTH}` }
  }
  if (!/^[UDLRW]+$/.test(normalizedActions)) {
    return { ok: false, reason: 'Malformed action trace: contains invalid move characters' }
  }

  // 5. Check physical timing plausibility
  if (typeof clientElapsedMs !== 'number' || !Number.isFinite(clientElapsedMs) || clientElapsedMs <= 0) {
    return { ok: false, reason: 'Invalid elapsed time' }
  }
  const minRequiredMs = normalizedActions.length * MIN_MS_PER_MOVE
  if (clientElapsedMs < minRequiredMs) {
    return {
      ok: false,
      reason: `Impossible completion time: ${Math.round(clientElapsedMs)}ms for ${normalizedActions.length} actions (minimum ${minRequiredMs}ms)`,
    }
  }

  // 6. Deterministic Replay Simulation using trusted engine
  const analysis: Analysis = analyze(dungeon)
  let state: RunState = initialState(dungeon)
  let lives = START_LIVES
  let livesLost = 0
  let moves = 0
  let combo = 0
  let comboBonus = 0
  let nearMisses = 0
  let nearMissBonuses = 0
  let lastComboTurn = -999
  let reachedExit = false

  for (let i = 0; i < normalizedActions.length; i++) {
    const action = normalizedActions[i] as Action
    const res = stepGame(dungeon, analysis, state, action, true)

    if (res.status === 'blocked') {
      return { ok: false, reason: `Action trace contains illegal blocked move at step ${i + 1} ('${action}')` }
    }

    moves++

    if (res.status === 'hit') {
      lives--
      livesLost++
      if (lives <= 0) {
        return { ok: false, reason: `Player ran out of lives at step ${i + 1}` }
      }
      // Respawn at start with fresh dungeon state per game rules
      state = initialState(dungeon)
      lastComboTurn = -999
      combo = 0
      continue
    }

    // Process event bonuses: keys, doors, levers, near-misses
    let turnCombo = false
    for (const e of res.events) {
      if (e.type === 'key' || e.type === 'door' || e.type === 'lever' || e.type === 'near') {
        if (e.type === 'near') {
          nearMisses++
          if (nearMissBonuses < NEAR_MISS_BONUS_CAP) {
            nearMissBonuses++
          }
        }
        turnCombo = true
      }
    }

    if (turnCombo) {
      if (moves - lastComboTurn <= COMBO_WINDOW) {
        combo++
      } else {
        combo = 1
      }
      lastComboTurn = moves
      comboBonus += combo * 10
    }

    state = res.state

    if (res.status === 'won' || (res.state.x === dungeon.exit.x && res.state.y === dungeon.exit.y)) {
      reachedExit = true
      break
    }
  }

  // 7. Verify Win Condition
  if (!reachedExit) {
    return { ok: false, reason: 'Action trace did not reach the dungeon exit' }
  }

  // 8. Authoritative Score Calculation
  const authoritativeTimeMs = Math.round(clientElapsedMs)
  const authoritativeScore = computeScore({
    outcome: 'win',
    timeMs: authoritativeTimeMs,
    moves,
    par,
    livesLost,
    comboBonus,
  })

  // 9. Compute Canonical Hash
  const dungeonHash = await canonicalDungeonHashHex(dungeon)

  // 10. Mark attempt as processed for idempotency
  processedAttempts.add(idempotencyKey)

  // 11. Transactionally record verified score in leaderboard
  try {
    await recordVerifiedScore({
      playerNearAccount,
      dungeonId: dungeonHash,
      challengeId: challengeId ?? null,
      attemptId,
      completionTimeMs: authoritativeTimeMs,
      moves,
      score: authoritativeScore,
    })
  } catch (err) {
    console.warn('[Validation] Warning: could not persist verified score to backend:', err)
  }

  return {
    ok: true,
    authoritativeScore,
    authoritativeTimeMs,
    moves,
    livesLost,
    comboBonus,
    nearMisses,
    dungeonHash,
  }
}
