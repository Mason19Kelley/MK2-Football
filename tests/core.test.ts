import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLeague, parseLeagueId, ESPNResponse } from '../lib/espn';
import { optimalLineup, applyTrade } from '../lib/trades';
import { applyProjections, parseProjectionCSV } from '../lib/projections';
import { demoLeague } from '../lib/demo';
import { Player } from '../lib/types';
const fixture: ESPNResponse = {
  id: 42,
  scoringPeriodId: 4,
  status: { finalScoringPeriod: 6 },
  settings: {
    name: 'Test league',
    rosterSettings: { lineupSlotCounts: { '0': 1, '23': 1, '20': 5 } },
    scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
  },
  members: [{ id: 'owner', displayName: 'Alex' }],
  teams: [
    {
      id: 1,
      name: 'Test team',
      owners: ['owner'],
      record: { overall: { wins: 2, losses: 1 } },
      roster: {
        entries: [
          {
            lineupSlotId: 0,
            playerPoolEntry: {
              player: {
                id: 10,
                fullName: 'Test QB',
                defaultPositionId: 1,
                proTeamId: 2,
                eligibleSlots: [0, 7, 20],
                stats: [
                  {
                    seasonId: 2026,
                    statSourceId: 1,
                    statSplitTypeId: 0,
                    scoringPeriodId: 0,
                    appliedTotal: 340,
                    appliedAverage: 20,
                  },
                  {
                    seasonId: 2026,
                    statSourceId: 1,
                    statSplitTypeId: 1,
                    scoringPeriodId: 4,
                    appliedTotal: 25,
                  },
                  {
                    seasonId: 2026,
                    statSourceId: 0,
                    statSplitTypeId: 0,
                    scoringPeriodId: 0,
                    appliedTotal: 70,
                  },
                  {
                    seasonId: 2025,
                    statSourceId: 1,
                    statSplitTypeId: 0,
                    scoringPeriodId: 0,
                    appliedTotal: 999,
                  },
                ],
              },
            },
          },
        ],
      },
    },
  ],
};
function player(id: number, ros: number | null, slots: number[]): Player {
  return {
    ...demoLeague.teams[0].players[0],
    id,
    ros,
    slotId: 20,
    eligibleSlots: slots,
  };
}
test('league ID parsing accepts ESPN links and rejects foreign hosts / nonnumeric IDs', () => {
  assert.equal(
    parseLeagueId(
      ' https://fantasy.espn.com/football/team?leagueId=42&teamId=1 ',
    ),
    '42',
  );
  assert.equal(parseLeagueId('00042'), '42');
  for (const input of [
    'https://evil.com/?leagueId=42',
    '0',
    'abc',
    'https://fantasy.espn.com.evil.com/?leagueId=42',
  ])
    assert.throws(() => parseLeagueId(input));
});
test('normalizes ESPN scoring, owner, record, actual points and labeled ROS estimate', () => {
  const l = normalizeLeague(fixture, 2026),
    p = l.teams[0].players[0];
  assert.equal(l.scoring, 'PPR');
  assert.equal(l.teams[0].owner, 'Alex');
  assert.equal(p.weekly, 25);
  assert.equal(p.actual, 70);
  assert.equal(p.ros, 60);
  assert.equal(p.projectionSource, 'estimate');
  assert.equal(l.slots.length, 2);
  assert.equal(l.warnings.length, 1);
});
test('uses complete weekly ROS forecasts and respects league end week', () => {
  const raw = structuredClone(fixture);
  const p = raw.teams![0].roster!.entries![0].playerPoolEntry!.player!;
  p.stats!.push(
    ...[5, 6, 7].map((w) => ({
      seasonId: 2026,
      statSourceId: 1,
      statSplitTypeId: 1,
      scoringPeriodId: w,
      appliedTotal: 10,
    })),
  );
  const result = normalizeLeague(raw, 2026).teams[0].players[0];
  assert.equal(result.ros, 45);
  assert.equal(result.projectionSource, 'weekly-sum');
});
test('missing projections remain null rather than zero', () => {
  const raw = structuredClone(fixture);
  raw.teams![0].roster!.entries![0].playerPoolEntry!.player!.stats = [];
  const p = normalizeLeague(raw, 2026).teams[0].players[0];
  assert.equal(p.weekly, null);
  assert.equal(p.ros, null);
  assert.equal(p.actual, null);
});
test('completed seasons have zero remaining points, and zero weekly projections are valid', () => {
  const raw = structuredClone(fixture);
  raw.scoringPeriodId = 7;
  assert.equal(normalizeLeague(raw, 2026).teams[0].players[0].ros, 0);
  raw.scoringPeriodId = 4;
  raw.teams![0].roster!.entries![0].playerPoolEntry!.player!.stats![1].appliedTotal = 0;
  assert.equal(normalizeLeague(raw, 2026).teams[0].players[0].weekly, 0);
});
test('optimizer solves flex allocation that greedy selection would miss', () => {
  const roster = [
    player(1, 100, [2, 23]),
    player(2, 90, [2]),
    player(3, 80, [23]),
  ];
  const result = optimalLineup(roster, [
    { id: 2, label: 'RB', count: 1 },
    { id: 23, label: 'FLEX', count: 1 },
  ]);
  assert.equal(result.total, 190);
  assert.equal(result.complete, true);
  assert.equal(new Set(result.players.map((p) => p.id)).size, 2);
});
test('optimizer excludes IR, reports missing coverage and incomplete lineups', () => {
  const roster = [player(1, null, [0]), { ...player(2, 150, [0]), slotId: 21 }];
  const result = optimalLineup(roster, [{ id: 0, label: 'QB', count: 1 }]);
  assert.equal(result.complete, false);
  assert.equal(result.filled, 0);
  assert.equal(result.missing, 1);
});
test('optimizer treats negative projections as valid when filling required slots', () => {
  const result = optimalLineup(
    [player(1, -2, [17])],
    [{ id: 17, label: 'K', count: 1 }],
  );
  assert.equal(result.total, -2);
  assert.equal(result.complete, true);
});
test('optimizer results agree with exhaustive search on varied rosters', () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let k = 0; k < 50; k++) {
    const roster = Array.from({ length: 6 }, (_, i) =>
      player(
        i,
        Math.floor(random() * 100),
        [0, 2, 23].filter(() => random() > 0.35),
      ),
    );
    const slots = [
      { id: 0, label: 'QB', count: 1 },
      { id: 2, label: 'RB', count: 1 },
      { id: 23, label: 'FLEX', count: 1 },
    ];
    let best = -Infinity;
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++)
        for (let c = 0; c < 6; c++) {
          if (a === b || a === c || b === c) continue;
          if (
            !roster[a].eligibleSlots.includes(0) ||
            !roster[b].eligibleSlots.includes(2) ||
            !roster[c].eligibleSlots.includes(23)
          )
            continue;
          best = Math.max(
            best,
            roster[a].ros! + roster[b].ros! + roster[c].ros!,
          );
        }
    const result = optimalLineup(roster, slots);
    if (best !== -Infinity) {
      assert.equal(result.complete, true);
      assert.equal(result.total, best);
    } else assert.equal(result.complete, false);
  }
});
test('trade swaps only selected players and validates ownership', () => {
  const mine = [player(1, 100, [0]), player(2, 90, [0])],
    theirs = [player(3, 110, [0])];
  const trade = applyTrade(mine, theirs, [1], [3]);
  assert.deepEqual(
    trade.mine.map((p) => p.id),
    [2, 3],
  );
  assert.deepEqual(
    trade.theirs.map((p) => p.id),
    [1],
  );
  assert.deepEqual(
    mine.map((p) => p.id),
    [1, 2],
  );
  assert.throws(() => applyTrade(mine, theirs, [99], [3]));
  assert.throws(() => applyTrade(mine, theirs, [1, 1], [3]));
});
test('projection CSV overrides are atomic, preserve weekly values, and reject bad rows', () => {
  const id = demoLeague.teams[0].players[0].id;
  const data = parseProjectionCSV(`player_id,ros_points\n${id},0`, demoLeague);
  const updated = applyProjections(demoLeague, data);
  assert.equal(updated.teams[0].players[0].ros, 0);
  assert.equal(updated.teams[0].players[0].projectionSource, 'custom');
  assert.equal(
    updated.teams[0].players[0].weekly,
    demoLeague.teams[0].players[0].weekly,
  );
  assert.notEqual(demoLeague.teams[0].players[0].ros, 0);
  for (const row of [
    `${id},`,
    `999999,100`,
    `${id},-2`,
    `${id},abc`,
    `${id},100\n${id},200`,
  ])
    assert.throws(() =>
      parseProjectionCSV(`player_id,ros_points\n${row}`, demoLeague),
    );
});
test('sample league assigns each player to exactly one team and has complete lineups', () => {
  const ids = demoLeague.teams.flatMap((t) => t.players.map((p) => p.id));
  assert.equal(ids.length, new Set(ids).size);
  for (const team of demoLeague.teams)
    assert.equal(optimalLineup(team.players, demoLeague.slots).complete, true);
});
