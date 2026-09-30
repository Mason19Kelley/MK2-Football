import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWaiverPlayers,
  compareWaiverMove,
  fetchWaiverWire,
  RawWaiverEntry,
} from '../lib/waivers';
import { demoLeague } from '../lib/demo';
import { parseProjectionCSV, applyProjections } from '../lib/projections';
const wire = demoLeague.waiverWire!;
test('available player normalization excludes owned, unknown status, and duplicate players', () => {
  const entry: RawWaiverEntry = {
    id: 9999,
    onTeamId: 0,
    status: 'FREEAGENT',
    player: {
      id: 9999,
      fullName: 'Available RB',
      defaultPositionId: 2,
      eligibleSlots: [2, 23, 20],
      ownership: { percentOwned: 23.5 },
      stats: [
        {
          seasonId: 2026,
          statSourceId: 1,
          statSplitTypeId: 0,
          scoringPeriodId: 0,
          appliedAverage: 10,
          appliedTotal: 170,
        },
        {
          seasonId: 2026,
          statSourceId: 1,
          statSplitTypeId: 1,
          scoringPeriodId: 4,
          appliedTotal: 12,
        },
      ],
    },
  };
  const result = normalizeWaiverPlayers(
    [
      entry,
      entry,
      { ...entry, id: 3, onTeamId: 1, player: { ...entry.player!, id: 3 } },
      {
        ...entry,
        id: 4,
        status: 'UNKNOWN',
        player: { ...entry.player!, id: 4 },
      },
      {
        ...entry,
        player: { ...entry.player!, id: demoLeague.teams[0].players[0].id },
      },
    ],
    demoLeague,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].weekly, 12);
  assert.equal(result[0].ros, 140);
  assert.equal(result[0].projectionSource, 'estimate');
  assert.equal(result[0].availability, 'FREEAGENT');
  assert.equal(result[0].percentOwned, 23.5);
});
test('pickup compares selected points and independently optimizes full starting lineup', () => {
  const mine = demoLeague.teams[0];
  const drop = mine.players.find((p) => p.name === 'James Conner')!,
    add = wire.players.find((p) => p.name === 'Rico Dowdle')!;
  const result = compareWaiverMove(
    mine.players,
    add,
    drop,
    demoLeague.slots,
    'ros',
  );
  assert.equal(result.complete, true);
  assert.ok(Math.abs(result.delta! - 18.8) < 0.001);
  assert.equal(mine.players.includes(drop), true);
  const weekly = compareWaiverMove(
    mine.players,
    add,
    drop,
    demoLeague.slots,
    'weekly',
  );
  assert.ok(Math.abs(weekly.delta! - 1.5) < 0.001);
  assert.throws(() =>
    compareWaiverMove(
      mine.players,
      add,
      { ...drop, id: 999 },
      demoLeague.slots,
      'ros',
    ),
  );
});
test('missing player values or unfillable starting slots suppress lineup recommendations', () => {
  const mine = demoLeague.teams[0],
    add = wire.players[0],
    qb = mine.players.find((p) => p.position === 'QB')!;
  const unavailable = compareWaiverMove(
    mine.players,
    { ...add, ros: null },
    qb,
    demoLeague.slots,
    'ros',
  );
  assert.equal(unavailable.delta, null);
  const missingQB = compareWaiverMove(
    mine.players,
    wire.players.find((p) => p.position === 'WR')!,
    qb,
    demoLeague.slots,
    'ros',
  );
  assert.equal(missingQB.complete, false);
  assert.equal(missingQB.delta, null);
});
test('custom projection uploads support waiver players without changing availability or weekly data', () => {
  const add = wire.players[0];
  const updated = applyProjections(
    demoLeague,
    parseProjectionCSV(`player_id,ros_points\n${add.id},300`, demoLeague),
  );
  assert.equal(updated.waiverWire!.players[0].ros, 300);
  assert.equal(updated.waiverWire!.players[0].projectionSource, 'custom');
  assert.equal(updated.waiverWire!.players[0].availability, add.availability);
  assert.equal(updated.waiverWire!.players[0].weekly, add.weekly);
  assert.notEqual(wire.players[0].ros, 300);
});
test('waiver fetch paginates available active players with league scoring and per-request credentials', async () => {
  const originalFetch = globalThis.fetch;
  const offsets: number[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.getAll('view').join(','), 'kona_player_info');
    assert.equal(url.searchParams.get('scoringPeriodId'), '4');
    const headers = init!.headers as Record<string, string>;
    assert.equal(headers.Cookie, 'espn_s2=test; SWID=test');
    const filter = JSON.parse(headers['x-fantasy-filter']).players;
    assert.deepEqual(filter.filterStatus.value, ['FREEAGENT', 'WAIVERS']);
    assert.equal(filter.filterActive.value, true);
    offsets.push(filter.offset);
    return Response.json({
      players: Array.from(
        { length: filter.offset === 0 ? 500 : 1 },
        (_, i) => ({
          id: 100000 + filter.offset + i,
          onTeamId: 0,
          status: 'WAIVERS',
          player: {
            id: 100000 + filter.offset + i,
            fullName: 'Waiver player',
            defaultPositionId: 3,
            eligibleSlots: [4, 23, 20],
          },
        }),
      ),
    });
  };
  try {
    const result = await fetchWaiverWire(
      new URL(
        'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/42?view=mRoster',
      ),
      { Cookie: 'espn_s2=test; SWID=test' },
      demoLeague,
    );
    assert.deepEqual(offsets, [0, 500]);
    assert.equal(result.players.length, 501);
    assert.equal(result.truncated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('sample waiver pool has no league-owned players', () => {
  const ids = new Set(
    demoLeague.teams.flatMap((t) => t.players.map((p) => p.id)),
  );
  assert.ok(wire.players.every((p) => !ids.has(p.id)));
  assert.equal(
    new Set(wire.players.map((p) => p.id)).size,
    wire.players.length,
  );
});
