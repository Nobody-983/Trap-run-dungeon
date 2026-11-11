import assert from 'node:assert/strict'
import test from 'node:test'
import { PRACTICE_LEVELS } from '../src/game/levels.ts'
import { solve } from '../src/game/solver.ts'
import { validateRunSubmission } from '../src/services/validation/runValidator.ts'
import type { Dungeon } from '../src/game/types.ts'

const testDungeon: Dungeon = PRACTICE_LEVELS[0].dungeon // Level 1 "First Steps"

void test('runValidator: valid campaign run with solved actions succeeds with authoritative score', async () => {
  const solution = solve(testDungeon)
  assert.equal(solution.solvable, true)
  const actions = solution.path.join('')

  const result = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'alice.testnet',
    actions,
    clientElapsedMs: actions.length * 150, // 150ms per move
    attemptId: 'valid-attempt-1',
    clientScore: 999999, // Falsified client score - must be ignored!
  })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.moves, actions.length)
    assert.equal(result.livesLost, 0)
    assert.notEqual(result.authoritativeScore, 999999) // Proves client score was overridden!
    assert.ok(result.authoritativeScore >= 100)
    assert.ok(result.dungeonHash.length === 64)
  }
})

void test('runValidator: impossible superhuman speed is rejected', async () => {
  const solution = solve(testDungeon)
  const actions = solution.path.join('')

  const result = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'speedhacker.testnet',
    actions,
    clientElapsedMs: 10, // 10ms for 20 moves is physically impossible!
    attemptId: 'impossible-speed-attempt',
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.reason, /Impossible completion time/)
  }
})

void test('runValidator: action trace that never reaches exit is rejected', async () => {
  const result = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'lazy.testnet',
    actions: 'UUUU', // Moves 4 steps up, clear path but nowhere near exit
    clientElapsedMs: 1000,
    attemptId: 'short-attempt',
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.reason, /did not reach the dungeon exit/)
  }
})

void test('runValidator: blocked action into a wall is rejected', async () => {
  const result = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'bob.testnet',
    actions: 'R', // Moving right from (0,8) immediately hits wall '#' at (1,8)
    clientElapsedMs: 1000,
    attemptId: 'blocked-attempt',
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.reason, /illegal blocked move/)
  }
})

void test('runValidator: duplicate attempt submission is rejected by idempotency', async () => {
  const solution = solve(testDungeon)
  const actions = solution.path.join('')

  const first = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'idempotent.testnet',
    actions,
    clientElapsedMs: actions.length * 120,
    attemptId: 'unique-attempt-key-xyz',
  })
  assert.equal(first.ok, true)

  const duplicate = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'idempotent.testnet',
    actions,
    clientElapsedMs: actions.length * 120,
    attemptId: 'unique-attempt-key-xyz',
  })
  assert.equal(duplicate.ok, false)
  if (!duplicate.ok) {
    assert.match(duplicate.reason, /Duplicate submission rejected/)
  }
})

void test('runValidator: invalid player NEAR account ID is rejected', async () => {
  const solution = solve(testDungeon)
  const actions = solution.path.join('')

  const result = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'INVALID@ACCOUNT!',
    actions,
    clientElapsedMs: 3000,
    attemptId: 'bad-account-attempt',
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.reason, /Invalid NEAR account identifier/)
  }
})

void test('runValidator: malformed action characters are rejected', async () => {
  const result = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'charlie.testnet',
    actions: 'udlrzx', // 'z' and 'x' are not valid action characters
    clientElapsedMs: 3000,
    attemptId: 'malformed-chars-attempt',
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.reason, /invalid move characters/)
  }
})

void test('runValidator: fatal run where player steps on repeated spikes is rejected', async () => {
  // Level 2 "Spike Garden": Start at (0,8), moving right into (1,8) '^' is a spike
  const spikeDungeon = PRACTICE_LEVELS[1].dungeon
  const result = await validateRunSubmission({
    dungeon: spikeDungeon,
    playerNearAccount: 'reckless.testnet',
    // 3 spikes kill all 3 lives
    actions: 'RRR',
    clientElapsedMs: 3000,
    attemptId: 'fatal-spike-attempt',
  })

  assert.equal(result.ok, false)
})

void test('runValidator: attempting to submit negative or zero completion time is rejected', async () => {
  const solution = solve(testDungeon)
  const actions = solution.path.join('')

  const result = await validateRunSubmission({
    dungeon: testDungeon,
    playerNearAccount: 'timetraveler.testnet',
    actions,
    clientElapsedMs: -500,
    attemptId: 'negative-time-attempt',
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.reason, /Invalid elapsed time/)
  }
})

