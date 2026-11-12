import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getCommunityCatalog,
  addOrUpdateCommunityDungeon,
  recordCommunityDungeonRun,
  searchAndFilterCommunityDungeons,
  type CommunityDungeon,
} from '../src/services/community/catalog.ts'
import { emptyCells, CREATOR_START, CREATOR_EXIT, type Dungeon } from '../src/game/types.ts'

void describe('Community Dungeons & Catalog', () => {
  void it('loads built-in community dungeons when storage is empty', () => {
    if (typeof localStorage !== 'undefined') localStorage.clear()
    const catalog = getCommunityCatalog()
    assert.ok(catalog.length >= 3)
    assert.ok(catalog[0].title)
    assert.ok(catalog[0].creator)
  })

  void it('filters community dungeons by query search and difficulty rating', () => {
    const sampleCatalog: CommunityDungeon[] = [
      {
        id: 'comm-1',
        title: 'Spike Gauntlet',
        creator: 'trap_master.testnet',
        creatorType: 'near',
        difficulty: 2,
        par: 15,
        plays: 10,
        clears: 5,
        shareCode: 'TRI1.spike-code',
        createdAt: 1000,
        dungeon: {
          id: 'comm-1',
          name: 'Spike Gauntlet',
          cells: emptyCells(),
          start: CREATOR_START,
          exit: CREATOR_EXIT,
          creator: { profileId: 'p1', displayName: 'trap_master.testnet' },
          source: 'creator',
          difficulty: 2,
          createdAt: 1000,
        },
      },
      {
        id: 'comm-2',
        title: 'The Labyrinth',
        creator: 'shadow_runner',
        creatorType: 'guest',
        difficulty: 4,
        par: 28,
        plays: 25,
        clears: 8,
        shareCode: 'TRI1.labyrinth-code',
        createdAt: 2000,
        dungeon: {
          id: 'comm-2',
          name: 'The Labyrinth',
          cells: emptyCells(),
          start: CREATOR_START,
          exit: CREATOR_EXIT,
          creator: { profileId: 'p2', displayName: 'shadow_runner' },
          source: 'creator',
          difficulty: 4,
          createdAt: 2000,
        },
      },
    ]

    // Search by title
    const searchSpike = searchAndFilterCommunityDungeons(sampleCatalog, 'Spike', 'all')
    assert.equal(searchSpike.length, 1)
    assert.equal(searchSpike[0].title, 'Spike Gauntlet')

    // Search by creator
    const searchCreator = searchAndFilterCommunityDungeons(sampleCatalog, 'shadow', 'all')
    assert.equal(searchCreator.length, 1)
    assert.equal(searchCreator[0].creator, 'shadow_runner')

    // Filter by difficulty D4
    const filterD4 = searchAndFilterCommunityDungeons(sampleCatalog, '', 4)
    assert.equal(filterD4.length, 1)
    assert.equal(filterD4[0].difficulty, 4)

    // Filter by non-existent difficulty
    const filterD5 = searchAndFilterCommunityDungeons(sampleCatalog, '', 5)
    assert.equal(filterD5.length, 0)
  })

  void it('updates plays and clears count on run recording', () => {
    const dungeon: Dungeon = {
      id: 'dungeon-run-test',
      name: 'Run Test',
      cells: emptyCells(),
      start: CREATOR_START,
      exit: CREATOR_EXIT,
      creator: { profileId: 'p1', displayName: 'Test' },
      source: 'creator',
      difficulty: 1,
      createdAt: 1000,
    }

    addOrUpdateCommunityDungeon({
      id: dungeon.id,
      title: dungeon.name,
      creator: 'Test',
      creatorType: 'guest',
      difficulty: 1,
      par: 16,
      plays: 0,
      clears: 0,
      shareCode: 'TRI1.test',
      createdAt: 1000,
      dungeon,
    })

    recordCommunityDungeonRun(dungeon.id, false) // 1 play, 0 clears
    let catalog = getCommunityCatalog()
    let item = catalog.find((e) => e.id === dungeon.id)
    assert.equal(item?.plays, 1)
    assert.equal(item?.clears, 0)

    recordCommunityDungeonRun(dungeon.id, true) // 2 plays, 1 clear
    catalog = getCommunityCatalog()
    item = catalog.find((e) => e.id === dungeon.id)
    assert.equal(item?.plays, 2)
    assert.equal(item?.clears, 1)
  })
})
