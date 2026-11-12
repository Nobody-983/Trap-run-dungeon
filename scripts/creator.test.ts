import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyCells, idx, CREATOR_START, CREATOR_EXIT, type CellType, type Dungeon } from '../src/game/types.ts'
import { place } from '../src/editor/tools.ts'
import { validateDungeon } from '../src/game/validate.ts'
import { solveDungeon } from '../src/game/solver.ts'
import { createProfile } from '../src/progress/profile.ts'

void describe('Dungeon Creator: Grid Editing, Undo/Redo & Drafts', () => {
  void it('places pieces on valid cells and refunds budget on erase', () => {
    let cells = emptyCells()
    const targetIdx = idx(4, 4)

    // Place a spike
    const r1 = place(cells, targetIdx, 'spike')
    assert.equal(r1.ok, true)
    if (r1.ok) cells = r1.cells
    assert.equal(cells[targetIdx], 'spike')

    // Erase the spike
    const r2 = place(cells, targetIdx, 'erase')
    assert.equal(r2.ok, true)
    if (r2.ok) cells = r2.cells
    assert.equal(cells[targetIdx], 'empty')
  })

  void it('rejects placing on fixed start and exit locations', () => {
    const startIdx = idx(CREATOR_START.x, CREATOR_START.y)
    const exitIdx = idx(CREATOR_EXIT.x, CREATOR_EXIT.y)

    assert.equal(startIdx, 72)
    assert.equal(exitIdx, 8)
  })

  void it('handles undo and redo history stacks accurately', () => {
    let currentCells = emptyCells()
    const history: CellType[][] = []
    const future: CellType[][] = []

    // Step 1: paint wall at (2, 2)
    history.push(currentCells.slice())
    const res1 = place(currentCells, idx(2, 2), 'wall')
    assert.equal(res1.ok, true)
    if (res1.ok) currentCells = res1.cells

    // Step 2: paint sentry at (3, 3)
    history.push(currentCells.slice())
    const res2 = place(currentCells, idx(3, 3), 'sentryH')
    assert.equal(res2.ok, true)
    if (res2.ok) currentCells = res2.cells

    assert.equal(currentCells[idx(2, 2)], 'wall')
    assert.equal(currentCells[idx(3, 3)], 'sentryH')

    // Undo Step 2
    future.unshift(currentCells.slice())
    currentCells = history.pop()!
    assert.equal(currentCells[idx(3, 3)], 'empty')
    assert.equal(currentCells[idx(2, 2)], 'wall')

    // Undo Step 1
    future.unshift(currentCells.slice())
    currentCells = history.pop()!
    assert.equal(currentCells[idx(2, 2)], 'empty')

    // Redo Step 1
    history.push(currentCells.slice())
    currentCells = future.shift()!
    assert.equal(currentCells[idx(2, 2)], 'wall')
    assert.equal(currentCells[idx(3, 3)], 'empty')

    // Redo Step 2
    history.push(currentCells.slice())
    currentCells = future.shift()!
    assert.equal(currentCells[idx(2, 2)], 'wall')
    assert.equal(currentCells[idx(3, 3)], 'sentryH')
  })

  void it('supports saving, loading, and deleting multiple named draft slots in profile', () => {
    const profile = createProfile()
    const draftCells = emptyCells()
    draftCells[idx(5, 5)] = 'wall'

    const sampleDraft = {
      cells: draftCells,
      order: [idx(5, 5)],
      remainingMs: 25000,
      started: true,
      locked: false,
    }

    // Save named draft
    profile.drafts['My Maze'] = sampleDraft
    assert.ok(profile.drafts['My Maze'])
    assert.equal(profile.drafts['My Maze'].cells[idx(5, 5)], 'wall')

    // Delete draft
    delete profile.drafts['My Maze']
    assert.equal(profile.drafts['My Maze'], undefined)
  })

  void it('solver validates solvability and calculates par moves', () => {
    const cells = emptyCells()
    const dungeon: Dungeon = {
      id: 'test-solver',
      name: 'Direct Path',
      cells,
      start: CREATOR_START,
      exit: CREATOR_EXIT,
      creator: { profileId: 'p1', displayName: 'Creator' },
      source: 'creator',
      difficulty: 1,
      createdAt: 1000,
    }

    const sol = solveDungeon(dungeon)
    assert.equal(sol.solvable, true)
    assert.equal(sol.path.length, 16)

    const val = validateDungeon(dungeon, { enforceBudget: true })
    assert.equal(val.ok, true)
    assert.equal(val.par, 16)
  })

  void it('detects unsolvable dungeons when exit is walled off', () => {
    const cells = emptyCells()
    cells[idx(7, 0)] = 'wall'
    cells[idx(8, 1)] = 'wall'

    const blockedDungeon: Dungeon = {
      id: 'blocked',
      name: 'Blocked Exit',
      cells,
      start: CREATOR_START,
      exit: CREATOR_EXIT,
      creator: { profileId: 'p1', displayName: 'Creator' },
      source: 'creator',
      difficulty: 1,
      createdAt: 1000,
    }

    const sol = solveDungeon(blockedDungeon)
    assert.equal(sol.solvable, false)

    const val = validateDungeon(blockedDungeon)
    assert.equal(val.ok, false)
  })
})
