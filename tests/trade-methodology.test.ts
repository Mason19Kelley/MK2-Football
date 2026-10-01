import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { League, Player, Team } from '../lib/types';
import {
  bestNoTradeMove,
  planTrade,
  tradePickupCandidates,
} from '../lib/trade-plans';
import {
  dominatesTrade,
  findTrades,
  outcomeSamples,
  rankTrades,
  TradeCandidate,
} from '../lib/trade-finder';
import {
  evaluateForecastRoster,
  defaultScenarioSettings,
  scoreDraw,
  scoreStdDev,
  summarizeGains,
} from '../lib/trade-evaluation';
import {
  evaluateLeagueOutcomes,
  validateOutcomeSchedule,
} from '../lib/trade-outcomes';
import { evaluateRoster } from '../lib/weekly-trades';
import { optimalLineup } from '../lib/trades';
import { normalizeLeague } from '../lib/espn';

function player(id: number, values: number[], slot = 0): Player {
  return {
    ...demoLeague.teams[0].players[0],
    id,
    name: `P${id}`,
    position: slot === 2 ? 'RB' : slot === 4 ? 'WR' : 'QB',
    nflTeam: `NFL${id}`,
    slotId: 20,
    slot: 'BN',
    status: 'ACTIVE',
    eligibleSlots: [slot],
    weekly: values[0],
    ros: values.reduce((s, n) => s + n, 0),
    weeklyProjections: Object.fromEntries(values.map((n, i) => [i + 1, n])),
    projectionSource: 'weekly-sum',
    byeWeek: 0,
  };
}
function team(id: number, players: Player[]): Team {
  return {
    ...demoLeague.teams[0],
    id,
    name: `Team${id}`,
    players,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
  };
}
function fixture(): League {
  return {
    ...demoLeague,
    week: 1,
    finalWeek: 1,
    playoffStartWeek: undefined,
    waiverWire: undefined,
    matchups: undefined,
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      team(1, [player(1, [20], 2), player(2, [19], 2), player(3, [5], 4)]),
      team(2, [player(4, [5], 2), player(5, [20], 4), player(6, [19], 4)]),
    ],
  };
}
const options = {
  maxPlayers: 1 as const,
  minimumGain: 0,
  ranking: 'mine' as const,
  horizon: 'remaining' as const,
  limit: 100,
};
const scenarios = {
  ...defaultScenarioSettings,
  samples: 256,
  availability: 1,
  scoreCv: 0,
  roleCv: 0,
};

test('waiver-dominated +14/+14 trade is rejected against symmetric legal no-trade policies', async () => {
  const league = fixture();
  league.waiverWire = {
    syncedAt: '',
    truncated: false,
    players: [
      { ...player(7, [20], 4), availability: 'FREEAGENT', percentOwned: 1 },
      { ...player(8, [20], 2), availability: 'FREEAGENT', percentOwned: 1 },
    ],
  };
  const old = await findTrades(league, 1, {
    ...options,
    waiverBaseline: false,
  });
  assert.equal(
    old.candidates.find((t) => t.send[0].id === 2 && t.receive[0].id === 6)
      ?.mine.gain,
    14,
  );
  const improved = await findTrades(league, 1, options);
  assert.equal(improved.baselineTotal, 40);
  assert.equal(improved.matched, 0);
  assert.equal(league.teams[0].players.length, 3);
});

test('one-acquisition baseline agrees with independent exhaustive add/drop enumeration', () => {
  const league = fixture();
  league.waiverWire = {
    syncedAt: '',
    truncated: false,
    players: [
      { ...player(7, [18], 4), availability: 'FREEAGENT', percentOwned: 1 },
      { ...player(8, [30], 2), availability: 'FREEAGENT', percentOwned: 1 },
    ],
  };
  const roster = league.teams[0].players;
  const variants = [
    roster,
    ...league.waiverWire.players.flatMap((p) =>
      roster.map((drop) => [...roster.filter((q) => q.id !== drop.id), p]),
    ),
  ];
  const best = Math.max(
    ...variants.map((r) => optimalLineup(r, league.slots).total),
  );
  const planned = bestNoTradeMove(league, league.teams[0], {
    includePickup: true,
    evaluate: (r) => evaluateForecastRoster(league, r, 'remaining'),
  });
  assert.equal(planned.evaluation.total, best);
});

test('joint plans cannot give one free agent to both teams and retain a second-best peer', () => {
  const league = fixture();
  league.slots = [{ id: 0, label: 'QB', count: 1 }];
  league.teams = [
    team(1, [player(1, [10]), player(2, [1])]),
    team(2, [player(3, [10]), player(4, [1])]),
  ];
  league.waiverWire = {
    syncedAt: '',
    truncated: false,
    players: [
      { ...player(5, [30]), availability: 'FREEAGENT', percentOwned: 1 },
      { ...player(6, [20]), availability: 'FREEAGENT', percentOwned: 1 },
      { ...player(7, [15]), availability: 'FREEAGENT', percentOwned: 1 },
    ],
  };
  const pool = tradePickupCandidates(league, 'remaining');
  assert.deepEqual(
    pool.map((p) => p.id),
    [5, 6],
  );
  const plan = planTrade(
    league,
    league.teams[0].players,
    league.teams[1].players,
    [2],
    [4],
    { includePickup: true, pickupCandidates: pool },
  );
  assert.notEqual(plan.mine.pickup?.id, plan.partner.pickup?.id);
  assert.equal(
    optimalLineup(plan.mine.roster, league.slots).total +
      optimalLineup(plan.partner.roster, league.slots).total,
    50,
  );
});

test('locks, acquisition budgets, positional limits and roster capacity constrain plans', () => {
  const league = fixture();
  league.teams[0].acquisitionsRemaining = 0;
  league.waiverWire = {
    syncedAt: '',
    truncated: false,
    players: [
      { ...player(7, [100], 4), availability: 'FREEAGENT', percentOwned: 1 },
    ],
  };
  assert.equal(
    bestNoTradeMove(league, league.teams[0], { includePickup: true }).move
      .pickup,
    undefined,
  );
  league.teams[0].players[1].transactionLocked = true;
  assert.throws(
    () =>
      planTrade(
        league,
        league.teams[0].players,
        league.teams[1].players,
        [2],
        [6],
      ),
    /locked/,
  );
  league.tradesLocked = true;
  assert.throws(
    () =>
      planTrade(
        league,
        league.teams[0].players,
        league.teams[1].players,
        [1],
        [5],
      ),
    /locked/,
  );
  league.tradesLocked = false;
  league.positionLimits = { WR: 1 };
  assert.throws(
    () => bestNoTradeMove(league, league.teams[1], { includePickup: true }),
    /roster limits/,
  );
});

test('all-size search enumerates exactly the union of four package modes', async () => {
  const league = fixture();
  const combined = await findTrades(league, 1, { ...options, allSizes: true });
  const equal = await findTrades(league, 1, { ...options, maxPlayers: 2 });
  const unequal = await findTrades(league, 1, {
    ...options,
    maxPlayers: 2,
    unequal: true,
  });
  assert.equal(combined.checked, 36);
  assert.equal(combined.checked, equal.checked + unequal.checked);
  const key = (t: TradeCandidate) =>
    `${t.send.map((p) => p.id)}:${t.receive.map((p) => p.id)}`;
  assert.deepEqual(
    combined.candidates.map(key).sort(),
    [...equal.candidates, ...unequal.candidates].map(key).sort(),
  );
});

test('Pareto output matches an exhaustive within-partner dominance filter', async () => {
  const all = await findTrades(fixture(), 1, { ...options, allSizes: true });
  const frontier = await findTrades(fixture(), 1, {
    ...options,
    allSizes: true,
    paretoOnly: true,
  });
  const expected = all.candidates.filter(
    (t) => !all.candidates.some((other) => dominatesTrade(other, t)),
  );
  assert.equal(frontier.frontierCount, expected.length);
  assert.ok(
    frontier.candidates.every(
      (t) => !all.candidates.some((other) => dominatesTrade(other, t)),
    ),
  );
  const a = {
    ...all.candidates[0],
    mine: { ...all.candidates[0].mine, gain: 10 },
    partner: { ...all.candidates[0].partner, gain: 5 },
  };
  const b = {
    ...a,
    mine: { ...a.mine, gain: 7 },
    partner: { ...a.partner, gain: 7 },
  };
  assert.ok(rankTrades(a, b, 'bargaining') < 0);
});

test('bounded irrelevant bench forecasts permit stable trades; wide bounds suppress them', async () => {
  const league = fixture();
  const unknown = {
    ...player(9, [0], 4),
    weekly: null,
    ros: null,
    weeklyProjections: {},
    projectionBounds: { weekly: { 1: { lower: 0, upper: 1 } } },
  };
  league.teams[0].players.push(unknown);
  const narrow = await findTrades(league, 1, options);
  assert.ok(narrow.candidates.length > 0);
  unknown.projectionBounds.weekly[1].upper = 1000;
  assert.equal((await findTrades(league, 1, options)).matched, 0);
  delete (unknown as Player).projectionBounds;
  await assert.rejects(findTrades(league, 1, options), /bounds/);
});

test('ROS bounds preserve known weekly forecasts and unbounded unknowns cannot be hidden by dropping them', async () => {
  const league = fixture();
  league.finalWeek = 2;
  const unknown = {
    ...player(9, [0, 0], 4),
    weekly: 10,
    ros: null,
    weeklyProjections: { 1: 10 },
    projectionBounds: { ros: { lower: 20, upper: 30 } },
  };
  const result = evaluateForecastRoster(
    { ...league, slots: [{ id: 4, label: 'WR', count: 1 }] },
    [unknown],
    'remaining',
  );
  assert.equal(result.weeks[0].total, 10);
  assert.equal(result.total, 20);
  assert.equal(result.upperTotal, 30);
  const unbounded = {
    ...player(10, [0, 0], 4),
    weekly: null,
    ros: null,
    weeklyProjections: {},
  };
  league.teams[0].players.push(unbounded);
  league.waiverWire = {
    syncedAt: '',
    truncated: false,
    players: [
      { ...player(7, [30, 30], 4), availability: 'FREEAGENT', percentOwned: 1 },
    ],
  };
  await assert.rejects(findTrades(league, 1, options), /bounds/);
});

test('scenario lineup choices cannot exploit realized scoring noise', () => {
  const league = { ...fixture(), slots: [{ id: 0, label: 'QB', count: 1 }] };
  const starter = { ...player(1, [20]), scoreStdDev: 100 };
  const bench = { ...player(2, [19]), scoreStdDev: 100 };
  const settings = { ...scenarios, scoreCv: 1 };
  const solo = evaluateForecastRoster(league, [starter], 'remaining', {
    scenarios: settings,
  });
  const depth = evaluateForecastRoster(league, [starter, bench], 'remaining', {
    scenarios: settings,
  });
  assert.deepEqual(depth.scenarioTotals, solo.scenarioTotals);
});

test('availability scenarios value injury insurance and explicit IR return weeks', () => {
  const league = {
    ...fixture(),
    finalWeek: 2,
    slots: [{ id: 0, label: 'QB', count: 1 }],
  };
  const starter = { ...player(1, [20, 20]), availabilityProbability: 0.5 };
  const backup = { ...player(2, [19, 19]), availabilityProbability: 1 };
  const solo = evaluateForecastRoster(league, [starter], 'remaining', {
    scenarios,
  });
  const depth = evaluateForecastRoster(league, [starter, backup], 'remaining', {
    scenarios,
  });
  assert.ok(depth.total > solo.total + 10);
  const ir = {
    ...player(3, [30, 30]),
    slotId: 21,
    returnWeek: 2,
    availabilityProbability: 1,
  };
  const recovered = evaluateForecastRoster(
    league,
    [player(4, [10, 10]), ir],
    'remaining',
    { scenarios },
  );
  assert.equal(recovered.scenarioWeeks?.[1][0], 10);
  assert.equal(recovered.scenarioWeeks?.[2][0], 30);
});

test('common scenario draws are reproducible and paired identical rosters have zero uncertainty', () => {
  const league = { ...fixture(), slots: [{ id: 0, label: 'QB', count: 1 }] };
  const roster = [player(1, [20])];
  const settings = { ...defaultScenarioSettings, samples: 64 };
  const a = evaluateForecastRoster(league, roster, 'remaining', {
    scenarios: settings,
  });
  const b = evaluateForecastRoster(league, roster, 'remaining', {
    scenarios: settings,
  });
  assert.deepEqual(a.scenarioTotals, b.scenarioTotals);
  assert.deepEqual(summarizeGains(a.scenarioTotals!, b.scenarioTotals!), {
    mean: 0,
    p10: 0,
    probabilityImproves: 0,
    standardError: 0,
    samples: 64,
  });
});

test('winning a close matchup beats adding more points to a comfortable win', () => {
  const league = {
    ...fixture(),
    finalWeek: 2,
    slots: [{ id: 0, label: 'QB', count: 1 }],
    teams: [team(1, [player(1, [100, 100])]), team(2, [player(2, [80, 101])])],
    matchups: [
      { id: 1, weeks: [1], homeId: 1, awayId: 2 },
      { id: 2, weeks: [2], homeId: 1, awayId: 2 },
    ],
  };
  const evaluate = (values: number[]) =>
    new Map([
      [
        1,
        evaluateForecastRoster(league, [player(1, values)], 'remaining', {
          scenarios,
        }),
      ],
      [
        2,
        evaluateForecastRoster(league, league.teams[1].players, 'remaining', {
          scenarios,
        }),
      ],
    ]);
  const base = evaluateLeagueOutcomes(
    league,
    evaluate([100, 100]),
    'remaining',
    'wins',
  ).get(1)!;
  const morePoints = evaluateLeagueOutcomes(
    league,
    evaluate([110, 100]),
    'remaining',
    'wins',
  ).get(1)!;
  const closeWin = evaluateLeagueOutcomes(
    league,
    evaluate([100, 103]),
    'remaining',
    'wins',
  ).get(1)!;
  assert.equal(base.wins, 1);
  assert.equal(morePoints.wins, 1);
  assert.equal(closeWin.wins, 2);
});

test('season scenarios support top-seed byes, score ties, multi-week rounds and reseeding', () => {
  const league = {
    ...fixture(),
    finalWeek: 7,
    slots: [{ id: 0, label: 'QB', count: 1 }],
    teams: Array.from({ length: 6 }, (_, i) =>
      team(i + 1, [
        player(i + 1, [
          60 - i * 10,
          60 - i * 10,
          60 - i * 10,
          60 - i * 10,
          60 - i * 10,
          60 - i * 10,
          60 - i * 10,
        ]),
      ]),
    ),
    matchups: [
      { id: 1, weeks: [1], homeId: 1, awayId: 6 },
      { id: 2, weeks: [1], homeId: 2, awayId: 5 },
      { id: 3, weeks: [1], homeId: 3, awayId: 4 },
    ],
  };
  const evaluations = new Map(
    league.teams.map((t) => [
      t.id,
      evaluateForecastRoster(league, t.players, 'remaining', { scenarios }),
    ]),
  );
  for (const reseed of [false, true]) {
    const results = evaluateLeagueOutcomes(
      league,
      evaluations,
      'remaining',
      'title',
      { teams: 6, startWeek: 2, roundWeeks: 2, reseed },
    );
    assert.equal(results.get(1)?.title, 1);
    assert.equal(
      [...results.values()].reduce((s, r) => s + r.title!, 0),
      1,
    );
    assert.ok([...results.values()].every((r) => r.playoffs === 1));
  }
  // All teams tied: seed ordering is stable; higher seed wins equal playoff scores.
  const tied = new Map(
    league.teams.map((t) => [
      t.id,
      evaluateForecastRoster(
        league,
        [player(t.id, Array(7).fill(10))],
        'remaining',
        { scenarios },
      ),
    ]),
  );
  assert.ok(
    evaluateLeagueOutcomes(league, tied, 'remaining', 'title', {
      teams: 4,
      startWeek: 2,
      roundWeeks: 2,
      reseed: false,
    }).get(1)!.title! > 0,
  );
});

test('outcome objectives reject missing, overlapping or partial matchup coverage', () => {
  const league = fixture();
  assert.throws(
    () => validateOutcomeSchedule(league, 'remaining', 'wins'),
    /Sync/,
  );
  league.matchups = [{ id: 1, weeks: [1, 2], homeId: 1, awayId: 2 }];
  assert.throws(
    () => validateOutcomeSchedule(league, 'remaining', 'wins'),
    /partial/,
  );
  league.matchups = [
    { id: 1, weeks: [1], homeId: 1, awayId: 2 },
    { id: 2, weeks: [1], homeId: 1, awayId: 2 },
  ];
  assert.throws(
    () => validateOutcomeSchedule(league, 'remaining', 'wins'),
    /overlapping/,
  );
});

test('ESPN schedule normalization preserves whole multi-week periods', () => {
  const league = normalizeLeague(
    {
      id: 1,
      scoringPeriodId: 1,
      status: { finalScoringPeriod: 4 },
      teams: [{ id: 1 }, { id: 2 }],
      settings: {
        scheduleSettings: {
          matchupPeriodCount: 1,
          matchupPeriods: { '1': [1, 2], '2': [3, 4] },
        },
      },
      schedule: [
        { id: 7, matchupPeriodId: 1, home: { teamId: 1 }, away: { teamId: 2 } },
      ],
    },
    2026,
  );
  assert.deepEqual(league.matchups, [
    { id: 7, weeks: [1, 2], homeId: 1, awayId: 2 },
  ]);
  assert.equal(league.playoffStartWeek, 3);
});

test('win-ranked finder evaluates both changed rosters and manual review preserves scenario results', async () => {
  const league = fixture();
  league.teams.push(
    team(3, [player(7, [20], 2), player(8, [10], 4)]),
    team(4, [player(9, [10], 2), player(10, [20], 4)]),
  );
  league.matchups = [
    { id: 1, weeks: [1], homeId: 1, awayId: 3 },
    { id: 2, weeks: [1], homeId: 2, awayId: 4 },
  ];
  const settings = { ...scenarios, samples: 8 };
  const result = await findTrades(league, 1, {
    ...options,
    partnerId: 2,
    objective: 'wins',
    scenarios: settings,
  });
  const candidate = result.candidates.find(
    (t) => t.send[0].id === 2 && t.receive[0].id === 6,
  )!;
  assert.equal(candidate.mine.utilityGain, 1);
  assert.equal(candidate.partner.utilityGain, 1);
  const review = await findTrades(league, 1, {
    ...options,
    partnerId: 2,
    objective: 'wins',
    scenarios: settings,
    selectedPackage: { send: [2], receive: [6] },
    includeNonImproving: true,
  });
  assert.equal(review.candidates[0].mine.gain, candidate.mine.gain);
  assert.deepEqual(
    review.candidates[0].mine.uncertainty,
    candidate.mine.uncertainty,
  );
});

test('outcome objectives re-rank a points shortlist and agree with the exhaustive search', async () => {
  const league = fixture();
  league.teams.push(
    team(3, [player(7, [20], 2), player(8, [10], 4)]),
    team(4, [player(9, [10], 2), player(10, [20], 4)]),
  );
  league.matchups = [
    { id: 1, weeks: [1], homeId: 1, awayId: 3 },
    { id: 2, weeks: [1], homeId: 2, awayId: 4 },
  ];
  const settings = { ...scenarios, samples: 8 };
  const search = { ...options, partnerId: 2, objective: 'wins' as const };
  const shortlisted = await findTrades(league, 1, {
    ...search,
    scenarios: settings,
  });
  const exhaustive = await findTrades(league, 1, {
    ...search,
    scenarios: settings,
    exhaustiveOutcomes: true,
  });
  const key = (t: TradeCandidate) =>
    `${t.send.map((p) => p.id)}>${t.receive.map((p) => p.id)}`;
  assert.deepEqual(
    shortlisted.candidates.map(key),
    exhaustive.candidates.map(key),
  );
  assert.ok(shortlisted.candidates.length > 0);
  for (const [i, t] of shortlisted.candidates.entries()) {
    assert.equal(t.scenarios?.samples, outcomeSamples);
    assert.equal(t.objective, 'wins');
    assert.ok(t.mine.gain > 0 && t.partner.gain > 0);
    assert.equal(t.mine.utilityGain, exhaustive.candidates[i].mine.utilityGain);
    assert.equal(t.mine.uncertainty?.samples, outcomeSamples);
  }
  assert.match(shortlisted.warnings[0], /top \d+ trades by projected points/);
  const one = await findTrades(league, 1, {
    ...search,
    scenarios: settings,
    shortlist: 1,
  });
  assert.ok(one.candidates.length <= 1);
});

test('championship utility captures damage from strengthening a direct rival despite a points increase', () => {
  const league = {
    ...fixture(),
    finalWeek: 2,
    slots: [{ id: 0, label: 'QB', count: 1 }],
    teams: [team(1, [player(1, [20, 20])]), team(2, [player(2, [15, 15])])],
    matchups: [{ id: 1, weeks: [1], homeId: 1, awayId: 2 }],
  };
  const before = new Map(
    league.teams.map((t) => [
      t.id,
      evaluateForecastRoster(league, t.players, 'remaining', { scenarios }),
    ]),
  );
  const after = new Map([
    [
      1,
      evaluateForecastRoster(league, [player(1, [23, 23])], 'remaining', {
        scenarios,
      }),
    ],
    [
      2,
      evaluateForecastRoster(league, [player(2, [25, 25])], 'remaining', {
        scenarios,
      }),
    ],
  ]);
  const rules = {
    teams: 2 as const,
    startWeek: 2,
    roundWeeks: 1,
    reseed: false,
  };
  assert.equal(
    evaluateLeagueOutcomes(league, before, 'remaining', 'title', rules).get(1)
      ?.title,
    1,
  );
  assert.equal(
    evaluateLeagueOutcomes(league, after, 'remaining', 'title', rules).get(1)
      ?.title,
    0,
  );
});

test('partner-specific horizons use independent lineup utility and survive review', async () => {
  const league = fixture();
  league.finalWeek = 4;
  league.playoffStartWeek = 4;
  for (const t of league.teams)
    for (const p of t.players) {
      p.weeklyProjections = {
        1: p.weekly!,
        2: p.weekly!,
        3: p.weekly!,
        4: p.weekly!,
      };
      p.ros = p.weekly! * 4;
    }
  const result = await findTrades(league, 1, {
    ...options,
    partnerHorizon: 'playoffs',
  });
  const trade = result.candidates.find(
    (t) => t.send[0].id === 2 && t.receive[0].id === 6,
  )!;
  assert.equal(trade.mine.gain, 56);
  assert.equal(trade.partner.gain, 14);
  const reviewed = await findTrades(league, 1, {
    ...options,
    partnerHorizon: 'playoffs',
    selectedPackage: { send: [2], receive: [6] },
    includeNonImproving: true,
  });
  assert.equal(reviewed.candidates[0].partner.gain, 14);
});

test('drop pruning preserves exact projected optima and depth while evaluating fewer variants', () => {
  const league = fixture();
  league.teams[0].players.push(
    player(20, [1], 2),
    player(21, [2], 4),
    player(22, [0], 4),
  );
  league.waiverWire = {
    syncedAt: '',
    truncated: false,
    players: [
      { ...player(7, [25], 4), availability: 'FREEAGENT', percentOwned: 1 },
    ],
  };
  const solve = (pruneUnusedDrops: boolean) => {
    let evaluated = 0;
    const evaluate = (roster: Player[]) => {
      evaluated++;
      return evaluateForecastRoster(league, roster, 'remaining');
    };
    const result = bestNoTradeMove(league, league.teams[0], {
      includePickup: true,
      evaluate,
      pruneUnusedDrops,
    });
    return { result, evaluated };
  };
  const exhaustive = solve(false),
    pruned = solve(true);
  assert.equal(
    pruned.result.evaluation.total,
    exhaustive.result.evaluation.total,
  );
  assert.equal(pruned.result.move.drop?.id, exhaustive.result.move.drop?.id);
  assert.ok(pruned.evaluated < exhaustive.evaluated);
});

test('manual evaluation with a 4000-player wire finishes a single package and reports baseline progress', async () => {
  const league = structuredClone(demoLeague);
  const prototype = league.waiverWire!.players.find(
    (p) => p.position === 'WR',
  )!;
  const weeks = Array.from(
    { length: league.finalWeek - league.week + 1 },
    (_, i) => league.week + i,
  );
  league.waiverWire!.players = Array.from({ length: 4000 }, (_, i) => ({
    ...prototype,
    id: 100000 + i,
    byeWeek: 0,
    status: 'ACTIVE',
    weekly: 18 - i / 1000,
    ros: (18 - i / 1000) * weeks.length,
    weeklyProjections: Object.fromEntries(weeks.map((w) => [w, 18 - i / 1000])),
    projectionSource: 'weekly-sum',
  }));
  const phases: string[] = [];
  const result = await findTrades(league, league.teams[0].id, {
    maxPlayers: 1,
    partnerId: league.teams[1].id,
    minimumGain: 0,
    ranking: 'mine',
    horizon: 'remaining',
    includeNonImproving: true,
    selectedPackage: {
      send: [league.teams[0].players[0].id],
      receive: [league.teams[1].players[0].id],
    },
    onProgress: (_count, p) => {
      if (p) phases.push(p.phase);
    },
  });
  assert.equal(result.checked, 1);
  assert.equal(result.candidates.length, 1);
  assert.ok(phases.includes('preparing'));
  assert.ok(phases.includes('searching'));
});

test('weekly scoring spread is position-specific and wider for low forecasts', () => {
  const cv = (pos: Parameters<typeof scoreStdDev>[0], points: number) =>
    scoreStdDev(pos, points, 1) / points;
  assert.ok(Math.abs(cv('QB', 18) - 0.4) < 0.02);
  assert.ok(Math.abs(cv('RB', 13) - 0.55) < 0.02);
  assert.ok(Math.abs(cv('WR', 13) - 0.6) < 0.02);
  assert.ok(Math.abs(cv('TE', 9) - 0.65) < 0.02);
  assert.ok(Math.abs(cv('K', 8) - 0.5) < 0.02);
  assert.ok(Math.abs(cv('D/ST', 7) - 0.8) < 0.02);
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as const) {
    assert.ok(cv(pos, 5) >= 0.8 && cv(pos, 5) <= 1);
  }
  assert.equal(scoreStdDev('WR', 13, 0), 0);
});

test('weekly score shapes keep the forecast mean and spread without impossible weeks', () => {
  const draws = 20000;
  // Evenly spaced normal quantiles via a stable inverse-CDF approximation.
  const zs = Array.from({ length: draws }, (_, i) => {
    const u = (i + 0.5) / draws;
    const t = Math.sqrt(-2 * Math.log(Math.min(u, 1 - u)));
    return (
      Math.sign(u - 0.5) *
      (t -
        (2.515517 + 0.802853 * t + 0.010328 * t * t) /
          (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t))
    );
  });
  const low10: Record<string, number> = {};
  for (const shape of ['gamma', 'lognormal'] as const)
    for (const [pos, mean] of [
      ['WR', 13],
      ['RB', 4],
      ['WR', 1],
      ['D/ST', 6],
    ] as const) {
      const sd = scoreStdDev(pos, mean, 1);
      const scores = zs.map((z) => scoreDraw(shape, pos, mean, sd, z));
      const avg = scores.reduce((s, n) => s + n, 0) / draws;
      const spread = Math.sqrt(
        scores.reduce((s, n) => s + (n - avg) ** 2, 0) / draws,
      );
      const label = `${shape} ${pos} ${mean}`;
      assert.ok(Math.abs(avg - mean) / mean < 0.02, `${label} mean ${avg}`);
      // A 1-point WR has CV near 3, where the gamma transform runs ~6% wide.
      assert.ok(Math.abs(spread - sd) / sd < 0.08, `${label} sd ${spread}`);
      assert.ok(Math.min(...scores) >= (pos === 'D/ST' ? -5 : 0));
      // Right-skewed: the median sits below the mean.
      const sorted = [...scores].sort((a, b) => a - b);
      assert.ok(sorted[draws / 2] < mean, label);
      low10[label] = sorted[draws / 10];
    }
  // The gamma's low tail is heavier, matching league backtests.
  assert.ok(low10['gamma WR 13'] < low10['lognormal WR 13'] - 0.5);
  // Very low projections put real probability on a zero week.
  const tiny = zs.map((z) =>
    scoreDraw('gamma', 'WR', 1, scoreStdDev('WR', 1, 1), z),
  );
  assert.ok(tiny.filter((n) => n === 0).length / draws > 0.3);
  assert.equal(scoreDraw('gamma', 'WR', 10, 0, 2), 10);
  assert.equal(scoreDraw('lognormal', 'WR', 10, 0, 2), 10);
});
