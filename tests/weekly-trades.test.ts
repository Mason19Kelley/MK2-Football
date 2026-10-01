import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { Player, League } from '../lib/types';
import { evaluateRoster, horizonWeeks, playerWeek } from '../lib/weekly-trades';
import { findTrades } from '../lib/trade-finder';
import { applyProjections } from '../lib/projections';
import { normalizeLeague, enrichByeWeeks, ESPNResponse } from '../lib/espn';
import { normalizeWaiverPlayers } from '../lib/waivers';
import { planTrade, tradePickupCandidates } from '../lib/trade-plans';

function p(id: number, forecasts: number[], slots = [0]): Player {
  return {
    ...demoLeague.teams[0].players[0],
    id,
    name: `Player ${id}`,
    slotId: 20,
    eligibleSlots: slots,
    status: 'ACTIVE',
    byeWeek: 0,
    weekly: forecasts[0],
    ros: forecasts.reduce((sum, n) => sum + n, 0),
    weeklyProjections: Object.fromEntries(forecasts.map((n, i) => [i + 1, n])),
    projectionSource: 'weekly-sum',
  };
}
function l(): League {
  return {
    ...demoLeague,
    week: 1,
    finalWeek: 4,
    playoffStartWeek: 3,
    slots: [{ id: 0, label: 'QB', count: 1 }],
    teams: [],
    waiverWire: undefined,
  };
}
test('weekly optimizer rotates starters around byes and beats a static season-total lineup', () => {
  const roster = [
    { ...p(1, [30, 0, 10, 10]), byeWeek: 2 },
    p(2, [20, 20, 20, 20]),
  ];
  const result = evaluateRoster(l(), roster, 'remaining');
  assert.equal(result.total, 90);
  assert.deepEqual(
    result.weeks.map((w) => w.players[0].id),
    [1, 2, 2, 2],
  );
  assert.equal(evaluateRoster(l(), roster, 'ros').total, 80);
  assert.equal(evaluateRoster(l(), roster, 'next3').total, 70);
  assert.equal(evaluateRoster(l(), roster, 'playoffs').total, 40);
  assert.ok(result.weeks.every((w) => w.estimated === 0));
});
test('weekly flex matching assigns each player once and chooses different starters each week', () => {
  const league = {
    ...l(),
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 23, label: 'FLEX', count: 1 },
    ],
  };
  const result = evaluateRoster(
    league,
    [
      p(1, [30, 1, 1, 1], [2, 23]),
      p(2, [10, 30, 10, 10], [2]),
      p(3, [20, 20, 20, 20], [23]),
    ],
    'next3',
  );
  assert.equal(result.total, 130);
  assert.ok(
    result.weeks.every((w) => new Set(w.players.map((p) => p.id)).size === 2),
  );
  assert.deepEqual(
    result.weeks.map((w) => w.players.map((p) => p.id).sort()),
    [
      [1, 3],
      [2, 3],
      [2, 3],
    ],
  );
});
test('current injury flags affect this week, IR stays excluded, and empty slots are visible at zero points', () => {
  const roster = [
    { ...p(1, [30, 30, 30, 30]), status: 'OUT' },
    { ...p(2, [50, 50, 50, 50]), slotId: 21 },
  ];
  const result = evaluateRoster(l(), roster, 'remaining');
  assert.equal(result.total, 90);
  assert.equal(result.complete, true);
  assert.equal(result.weeks[0].filled, 0);
  assert.equal(result.weeks[0].total, 0);
  assert.equal(result.weeks[1].players[0].id, 1);
  const bye = evaluateRoster(
    l(),
    [{ ...p(1, [30, 0, 30, 30]), byeWeek: 2 }],
    'remaining',
  );
  assert.equal(bye.weeks[1].filled, 0);
  assert.equal(bye.missing, 0);
});
test('fallback estimates preserve explicit zero forecasts and label missing bye information', () => {
  const player = {
    ...p(1, [0, 20, 20, 20]),
    weeklyProjections: { 1: 0 },
    ros: 60,
    projectionSource: 'estimate' as const,
    byeWeek: undefined,
  };
  assert.equal(playerWeek(player, l(), 1).points, 0);
  assert.equal(playerWeek(player, l(), 2).points, 20);
  assert.equal(playerWeek({ ...player, byeWeek: 2 }, l(), 2).unavailable, true);
  const result = evaluateRoster(l(), [player], 'remaining');
  assert.equal(result.total, 60);
  assert.equal(result.weeks[1].estimated, 1);
  assert.equal(result.weeks[1].unknownByes, 1);
  const missing = { ...player, weekly: null, ros: null, weeklyProjections: {} };
  assert.equal(evaluateRoster(l(), [missing], 'remaining').missing, 4);
});
test('ROS overrides influence weekly mode and remain estimates with a zero-point bye', () => {
  const league = {
    ...l(),
    teams: [
      {
        ...demoLeague.teams[0],
        id: 1,
        players: [{ ...p(1, [10, 0, 10, 10]), byeWeek: 2 }],
      },
    ],
  };
  const updated = applyProjections(league, new Map([[1, 90]]));
  const result = evaluateRoster(updated, updated.teams[0].players, 'remaining');
  assert.equal(result.total, 90);
  assert.equal(result.weeks[1].total, 0);
  assert.equal(result.weeks[0].estimated, 1);
  assert.equal(updated.teams[0].players[0].weekly, 10);
});
test('horizons respect season end and imported multi-week regular season periods', () => {
  assert.deepEqual(horizonWeeks({ ...l(), week: 4 }, 'next3'), [4]);
  assert.deepEqual(horizonWeeks({ ...l(), week: 5 }, 'remaining'), []);
  assert.equal(
    evaluateRoster({ ...l(), week: 5 }, [p(1, [10, 10, 10, 10])], 'remaining')
      .complete,
    false,
  );
  assert.throws(
    () => horizonWeeks({ ...l(), playoffStartWeek: undefined }, 'playoffs'),
    /playoff start/,
  );
  const raw: ESPNResponse = {
    id: 1,
    scoringPeriodId: 4,
    status: { finalScoringPeriod: 8 },
    teams: [{ id: 1 }],
    settings: {
      scheduleSettings: {
        matchupPeriodCount: 2,
        matchupPeriods: { '1': [1, 2], '2': [3, 4], '3': [5, 6], '4': [7, 8] },
      },
    },
  };
  assert.equal(normalizeLeague(raw, 2026).playoffStartWeek, 5);
});
test('ESPN normalization retains partial weekly forecasts for rosters and waiver players', () => {
  const raw = {
    id: 10,
    fullName: 'Test',
    defaultPositionId: 1,
    proTeamId: 2,
    eligibleSlots: [0],
    stats: [
      {
        seasonId: 2026,
        statSourceId: 1,
        statSplitTypeId: 0,
        scoringPeriodId: 0,
        appliedAverage: 20,
      },
      ...[4, 5].map((week) => ({
        seasonId: 2026,
        statSourceId: 1,
        statSplitTypeId: 1,
        scoringPeriodId: week,
        appliedTotal: week === 4 ? 0 : 25,
      })),
    ],
  };
  const league = normalizeLeague(
    {
      id: 1,
      scoringPeriodId: 4,
      status: { finalScoringPeriod: 6 },
      teams: [
        {
          id: 1,
          roster: {
            entries: [{ lineupSlotId: 0, playerPoolEntry: { player: raw } }],
          },
        },
      ],
    },
    2026,
  );
  assert.deepEqual(league.teams[0].players[0].weeklyProjections, {
    4: 0,
    5: 25,
  });
  const pool = normalizeWaiverPlayers(
    [{ id: 11, onTeamId: 0, status: 'FREEAGENT', player: { ...raw, id: 11 } }],
    league,
  );
  assert.deepEqual(pool[0].weeklyProjections, { 4: 0, 5: 25 });
});
test('bye schedule enrichment covers roster and free agents without changing forecasts', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ settings: { proTeams: [{ id: 2, byeWeek: 3 }] } }),
    );
  try {
    const player = p(1, [10, 10, 10, 10]);
    const league = {
      ...l(),
      teams: [{ ...demoLeague.teams[0], players: [player] }],
      waiverWire: {
        syncedAt: '',
        truncated: false,
        players: [
          {
            ...p(2, [5, 5, 5, 5]),
            availability: 'FREEAGENT' as const,
            percentOwned: 1,
          },
        ],
      },
    };
    await enrichByeWeeks(league);
    assert.equal(league.teams[0].players[0].byeWeek, 3);
    assert.equal(league.waiverWire.players[0].byeWeek, 3);
    assert.equal(league.teams[0].players[0].weeklyProjections![3], 10);
  } finally {
    globalThis.fetch = original;
  }
});
test('finder uses weekly gains, preserving trades rejected by a static lineup model', async () => {
  const league = {
    ...l(),
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      {
        ...demoLeague.teams[0],
        id: 1,
        players: [
          p(1, [20, 0, 20, 20], [2]),
          p(2, [10, 0, 10, 10], [2]),
          p(3, [20, 0, 20, 20], [4]),
        ],
      },
      {
        ...demoLeague.teams[1],
        id: 2,
        players: [
          p(4, [0, 20, 0, 0], [2]),
          p(5, [0, 20, 0, 0], [4]),
          p(6, [0, 10, 0, 0], [4]),
        ],
      },
    ],
  };
  const options = {
    maxPlayers: 1 as const,
    minimumGain: 1,
    ranking: 'mine' as const,
  };
  const result = await findTrades(league, 1, {
    ...options,
    horizon: 'remaining',
  });
  const candidate = result.candidates.find(
    (t) => t.send[0].id === 2 && t.receive[0].id === 6,
  );
  assert.ok(candidate);
  assert.equal(candidate.mine.gain, 10);
  assert.equal(candidate.partner.gain, 30);
  const legacy = await findTrades(league, 1, { ...options, horizon: 'ros' });
  assert.ok(
    !legacy.candidates.some((t) => t.send[0].id === 2 && t.receive[0].id === 6),
  );
});

test('pickup pruning preserves optimal choices, including players with different bye coverage', () => {
  const league = {
    ...l(),
    teams: [
      {
        ...demoLeague.teams[0],
        id: 1,
        players: [p(1, [15, 0, 15, 15]), p(2, [1, 1, 1, 1])],
      },
      {
        ...demoLeague.teams[1],
        id: 2,
        players: [p(3, [10, 10, 10, 10]), p(4, [1, 1, 1, 1])],
      },
    ],
    waiverWire: {
      syncedAt: '',
      truncated: false,
      players: [
        {
          ...p(10, [20, 0, 20, 20]),
          byeWeek: 2,
          availability: 'FREEAGENT' as const,
          percentOwned: 1,
        },
        {
          ...p(11, [10, 0, 10, 10]),
          byeWeek: 2,
          availability: 'FREEAGENT' as const,
          percentOwned: 1,
        },
        {
          ...p(12, [0, 25, 0, 0]),
          byeWeek: 1,
          availability: 'FREEAGENT' as const,
          percentOwned: 1,
        },
      ],
    },
  };
  const pruned = tradePickupCandidates(league, 'remaining');
  assert.deepEqual(
    pruned.map((p) => p.id),
    [10, 11, 12],
  );
  const evaluate = (roster: Player[]) =>
    evaluateRoster(league, roster, 'remaining');
  const exhaustive = planTrade(
    league,
    league.teams[0].players,
    league.teams[1].players,
    [1, 2],
    [3],
    { includePickup: true, evaluate },
  );
  const optimized = planTrade(
    league,
    league.teams[0].players,
    league.teams[1].players,
    [1, 2],
    [3],
    { includePickup: true, evaluate, pickupCandidates: pruned },
  );
  assert.equal(
    evaluate(exhaustive.mine.roster).total,
    evaluate(optimized.mine.roster).total,
  );
  assert.equal(exhaustive.mine.pickup?.id, optimized.mine.pickup?.id);
});

test('bye-week trade gains are measured against the best available free-agent replacement', async () => {
  const mine = [
    { ...p(1, [30, 0, 30, 30]), name: 'Lamar', byeWeek: 2 },
    { ...p(2, [10, 10, 10, 10], [4]), position: 'WR' as const },
    { ...p(3, [9, 9, 9, 9], [4]), position: 'WR' as const },
  ];
  const partner = [
    { ...p(4, [15, 15, 15, 15]), name: 'Darnold' },
    p(5, [25, 25, 25, 25]),
    { ...p(6, [2, 2, 2, 2], [4]), position: 'WR' as const },
  ];
  const league: League = {
    ...l(),
    slots: [
      { id: 0, label: 'QB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      { ...demoLeague.teams[0], id: 1, players: mine },
      { ...demoLeague.teams[1], id: 2, players: partner },
    ],
  };
  const options = {
    maxPlayers: 1 as const,
    horizon: 'remaining' as const,
    minimumGain: 0,
    ranking: 'mine' as const,
  };
  const target = (t: { send: Player[]; receive: Player[] }) =>
    t.send[0].id === 2 && t.receive[0].id === 4;
  assert.equal(
    (await findTrades(league, 1, options)).candidates.find(target)?.mine.gain,
    11,
  );
  const wire = (points: number) => ({
    ...p(10, [points, points, points, points]),
    name: 'Streamer',
    availability: 'FREEAGENT' as const,
    percentOwned: 1,
  });
  league.waiverWire = { syncedAt: '', truncated: false, players: [wire(10)] };
  const before = evaluateRoster(league, mine, 'remaining');
  assert.equal(before.weeks[1].total, 20);
  assert.equal(before.weeks[1].replacements[0].name, 'Streamer');
  assert.equal(before.weeks[0].replacements.length, 0);
  assert.equal(
    (await findTrades(league, 1, options)).candidates.find(target)?.mine.gain,
    1,
  );
  for (const score of [15, 20]) {
    league.waiverWire.players = [wire(score)];
    assert.ok(!(await findTrades(league, 1, options)).candidates.some(target));
  }
  // The imported snapshots stay unchanged; replacements are hypothetical.
  assert.equal(mine.length, 3);
  assert.equal(league.waiverWire.players[0].slotId, 20);
});

test('replacement pool excludes claimed, rostered, injured, bye and missing-forecast players', () => {
  const starter = { ...p(1, [0, 30, 30, 30]), byeWeek: 1 };
  const free = (id: number, score: number) => ({
    ...p(id, [score, score, score, score]),
    availability: 'FREEAGENT' as const,
    percentOwned: 1,
  });
  const league: League = {
    ...l(),
    teams: [{ ...demoLeague.teams[0], players: [starter, free(8, 100)] }],
    waiverWire: {
      syncedAt: '',
      truncated: false,
      players: [
        { ...free(2, 100), availability: 'WAIVERS' },
        { ...free(3, 100), byeWeek: 1 },
        { ...free(4, 100), status: 'OUT' },
        { ...free(5, 100), weekly: null, ros: null, weeklyProjections: {} },
        { ...free(6, 100), slotId: 21 },
        free(8, 100),
        free(9, 12),
        free(10, 15),
      ],
    },
  };
  const result = evaluateRoster(league, [starter], 'next3');
  assert.equal(result.weeks[0].total, 15);
  assert.deepEqual(
    result.weeks[0].replacements.map((p) => p.id),
    [10],
  );
  assert.equal(result.weeks[0].missing, 0);
  assert.equal(result.weeks[0].estimated, 0);
});

test('replacement matching fills repeated and flex slots once per player while keeping owned starters', () => {
  const roster = [
    { ...p(1, [0, 10, 10, 10], [0, 7]), byeWeek: 1 },
    p(2, [3, 3, 3, 3], [0, 7]),
  ];
  const league: League = {
    ...l(),
    slots: [
      { id: 0, label: 'QB', count: 2 },
      { id: 7, label: 'OP', count: 1 },
    ],
    waiverWire: {
      syncedAt: '',
      truncated: false,
      players: [
        {
          ...p(10, [20, 20, 20, 20], [0, 7]),
          availability: 'FREEAGENT',
          percentOwned: 1,
        },
        {
          ...p(11, [15, 15, 15, 15], [0, 7]),
          availability: 'FREEAGENT',
          percentOwned: 1,
        },
        {
          ...p(12, [12, 12, 12, 12], [0, 7]),
          availability: 'FREEAGENT',
          percentOwned: 1,
        },
      ],
    },
  };
  const week = evaluateRoster(league, roster, 'next3').weeks[0];
  assert.equal(week.total, 38);
  assert.equal(week.filled, 3);
  assert.deepEqual(
    week.players.map((p) => p.id),
    [2, 10, 11],
  );
  assert.equal(new Set(week.players.map((p) => p.id)).size, 3);
});

test('missing waiver pools retain zero-point gaps and ROS legacy totals remain unchanged', () => {
  const starter = { ...p(1, [0, 20, 20, 20]), byeWeek: 1 };
  assert.equal(evaluateRoster(l(), [starter], 'next3').weeks[0].total, 0);
  const league: League = {
    ...l(),
    waiverWire: {
      syncedAt: '',
      truncated: false,
      players: [
        {
          ...p(10, [15, 15, 15, 15]),
          availability: 'FREEAGENT',
          percentOwned: 1,
        },
      ],
    },
  };
  assert.equal(evaluateRoster(league, [starter], 'ros').total, 60);
});
