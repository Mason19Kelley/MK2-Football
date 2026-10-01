import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoLeague } from '../lib/demo';
import { League, Player, normalizeFantasySeason } from '../lib/types';
import {
  enrichLiveGames,
  normalizeLeague,
  normalizePlayer,
  refreshPlayerRos,
} from '../lib/espn';
import { evaluateRoster, playerWeek } from '../lib/weekly-trades';
import {
  evaluateForecastRoster,
  createScenarioCache,
  defaultScenarioSettings,
} from '../lib/trade-evaluation';
import {
  evaluateLeagueOutcomes,
  PlayoffScenario,
  playoffWeeks,
} from '../lib/trade-outcomes';
import { forecastSeason } from '../lib/season-forecast';
import { supportsWasmScoring } from '../lib/trade-wasm';

const scenarios = {
  ...defaultScenarioSettings,
  samples: 8,
  availability: 1,
  scoreCv: 0,
  roleCv: 0,
  teamCorrelation: 0,
};
function player(id: number, score: number): Player {
  return {
    ...demoLeague.teams[0].players[0],
    id,
    slotId: 20,
    eligibleSlots: [0],
    status: 'ACTIVE',
    byeWeek: 0,
    weekly: score,
    ros: score * 4,
    weeklyProjections: {},
    projectionSource: 'estimate',
    projectedPointsPerGame: score,
    scoreStdDev: 0,
    roleStdDev: 0,
    availabilityProbability: 1,
  };
}
function league(): League {
  return {
    ...demoLeague,
    week: 1,
    finalWeek: 4,
    playoffStartWeek: 3,
    playoffTeamCount: 2,
    playoffRoundWeeks: 1,
    slots: [{ id: 0, label: 'QB', count: 1 }],
    waiverWire: undefined,
    teams: demoLeague.teams.slice(0, 4).map((t, i) => ({
      ...t,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      players: [player(i + 1, 40 - i * 10)],
    })),
    matchups: [1, 2].flatMap((w) => [
      { id: w * 2, weeks: [w], homeId: 1, awayId: 4 },
      { id: w * 2 + 1, weeks: [w], homeId: 2, awayId: 3 },
    ]),
  };
}
function outcomes(
  l: League,
  bracket?: PlayoffScenario,
  objective: 'wins' | 'title' = 'title',
) {
  return evaluateLeagueOutcomes(
    l,
    new Map(
      l.teams.map((t) => [
        t.id,
        evaluateForecastRoster(l, t.players, 'remaining', { scenarios }),
      ]),
    ),
    'remaining',
    objective,
    bracket ?? {
      teams: l.playoffTeamCount!,
      startWeek: l.playoffStartWeek!,
      roundWeeks: l.playoffRoundWeeks!,
      reseed: false,
    },
  );
}
const rules = {
  seeding: 'TOTAL_POINTS_SCORED',
  matchupTie: 'NONE',
  playoffTie: 'HIGHER_SEED',
  divisionWinners: false,
  reseed: false,
};

test('final starters retain actual scores, negative points and exact slots while locked bench cannot enter', () => {
  const l = league();
  const starter = {
    ...player(1, 20),
    slotId: 0,
    currentGame: {
      week: 1,
      state: 'final' as const,
      remainingFraction: 0,
      actual: -4,
      lockedSlotId: 0,
    },
  };
  const bench = {
    ...player(2, 100),
    currentGame: {
      week: 1,
      state: 'final' as const,
      remainingFraction: 0,
      actual: 100,
      lockedSlotId: 20,
    },
  };
  const roster = [starter, bench, player(3, 50)];
  const deterministic = evaluateRoster(l, roster, 'remaining');
  assert.equal(deterministic.weeks[0].total, -4);
  assert.deepEqual(
    deterministic.weeks[0].players.map((p) => p.id),
    [1],
  );
  const uncertain = { ...scenarios, availability: 0.2, scoreCv: 2, roleCv: 1 };
  const plain = evaluateForecastRoster(l, roster, 'remaining', {
    scenarios: uncertain,
  });
  const cached = evaluateForecastRoster(l, roster, 'remaining', {
    scenarios: uncertain,
    scenarioCache: createScenarioCache(l, uncertain),
  });
  assert.deepEqual(plain, cached);
  assert.ok(plain.scenarioWeeks![1].every((n) => n === -4));
  assert.equal(
    supportsWasmScoring(
      { ...l, teams: [{ ...l.teams[0], players: roster }] },
      { horizon: 'remaining', maxPlayers: 1, minimumGain: 1, ranking: 'mine' },
    ),
    false,
  );
});

test('banking actual scores changes matchup and downstream odds and live production is only the remaining fraction', () => {
  const l = league();
  l.teams[0].players[0] = {
    ...player(1, 20),
    currentGame: {
      week: 1,
      state: 'in-progress',
      remainingFraction: 0.25,
      actual: 100,
      lockedSlotId: 0,
    },
  };
  assert.equal(playerWeek(l.teams[0].players[0], l, 1).points, 105);
  assert.ok(
    evaluateForecastRoster(l, l.teams[0].players, 'remaining', {
      scenarios,
    }).scenarioWeeks![1].every((n) => n === 105),
  );
  const high = forecastSeason(l);
  l.teams[0].players[0].currentGame!.actual = -100;
  const low = forecastSeason(l);
  assert.equal(high.matchups[0].homeWinChance, 1);
  assert.equal(low.matchups[0].homeWinChance, 0);
  assert.ok(high.teams[0].wins > low.teams[0].wins);
});

test('ESPN NFL clock imports kickoff locks, final zero actuals and transaction locks', async () => {
  const l = league();
  l.teams[0].players[0].weeklyActuals = { 1: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      week: { number: 1 },
      events: [
        {
          status: {
            type: { state: 'post', completed: true },
            period: 4,
            clock: 0,
          },
          competitions: [{ competitors: [{ team: { abbreviation: 'BUF' } }] }],
        },
      ],
    });
  try {
    await enrichLiveGames(l);
    assert.equal(l.teams[0].players[0].currentGame?.actual, 0);
    assert.equal(l.teams[0].players[0].currentGame?.remainingFraction, 0);
    assert.equal(l.teams[0].players[0].transactionLocked, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('ROS and weekly forecasts agree around byes and known matchup spikes do not reduce missing weeks', () => {
  const raw = {
    id: 99,
    defaultPositionId: 1,
    eligibleSlots: [0],
    byeWeek: 2,
    stats: [
      {
        seasonId: 2026,
        statSourceId: 1,
        statSplitTypeId: 0,
        scoringPeriodId: 0,
        appliedAverage: 20,
      },
      {
        seasonId: 2026,
        statSourceId: 1,
        statSplitTypeId: 1,
        scoringPeriodId: 1,
        appliedTotal: 50,
      },
    ],
  };
  const p = normalizePlayer(raw, 2026, 1, 4);
  const l = league();
  l.teams[0].players = [p];
  assert.equal(p.ros, 90);
  assert.equal(evaluateRoster(l, [p], 'remaining').total, p.ros);
  assert.equal(playerWeek(p, l, 3).points, 20);
  p.weeklyProjections![1] = 100;
  refreshPlayerRos(l);
  assert.equal(playerWeek(p, l, 3).points, 20);
  assert.equal(p.ros, 140);
  assert.deepEqual(
    normalizeFantasySeason(l),
    normalizeFantasySeason(normalizeFantasySeason(l)),
  );
});

test('import preserves division, seeding, tie rules, historical results and unequal round weeks', () => {
  const l = normalizeLeague(
    {
      id: 1,
      scoringPeriodId: 2,
      status: { finalScoringPeriod: 18 },
      teams: [{ id: 1, divisionId: 0, playoffSeed: 1 }],
      settings: {
        scheduleSettings: {
          matchupPeriodCount: 1,
          playoffTeamCount: 4,
          playoffSeedingRule: 'H2H_RECORD',
          divisions: [{ id: 0 }, { id: 1 }],
          matchupPeriods: { 1: [1, 2], 2: [15], 3: [16, 17, 18] },
        },
        scoringSettings: {
          matchupTieRule: 'NONE',
          playoffMatchupTieRule: 'HIGHER_SEED',
        },
      },
      schedule: [
        {
          id: 1,
          matchupPeriodId: 1,
          home: {
            teamId: 1,
            totalPoints: 100,
            pointsByScoringPeriod: { 1: 50 },
          },
          away: { teamId: 2, totalPoints: 90 },
          winner: 'HOME',
        },
      ],
    },
    2026,
  );
  assert.equal(l.finalWeek, 18);
  assert.equal(l.playoffRules?.seeding, 'H2H_RECORD');
  assert.equal(l.playoffRules?.divisionWinners, true);
  assert.deepEqual(l.playoffRounds, [[15], [16, 17, 18]]);
  assert.equal(l.teams[0].playoffSeed, 1);
  assert.equal(l.matchups![0].winnerId, 1);
  assert.equal(l.matchups![0].homeActuals![1], 50);
});

test('import treats ESPN NONE playoff tie rule as the higher-seed default', () => {
  const l = normalizeLeague(
    {
      id: 1,
      scoringPeriodId: 2,
      teams: [{ id: 1 }],
      settings: {
        scheduleSettings: { matchupPeriodCount: 1, playoffTeamCount: 4 },
        scoringSettings: {
          matchupTieRule: 'NONE',
          playoffMatchupTieRule: 'NONE',
        },
      },
    },
    2026,
  );
  assert.equal(l.playoffRules?.playoffTie, 'HIGHER_SEED');
});

test('division winners qualify ahead of stronger wildcards', () => {
  const l = league();
  l.playoffRules = { ...rules, divisionWinners: true };
  l.teams.forEach((t, i) => {
    t.divisionId = i < 2 ? 0 : 1;
  });
  const result = outcomes(l);
  assert.equal(result.get(1)?.playoffs, 1);
  assert.equal(result.get(3)?.playoffs, 1);
  assert.equal(result.get(2)?.playoffs, 0);
});

test('imported head-to-head priority beats points-for among teams with equal records', () => {
  const l = league();
  l.week = 2;
  l.playoffRules = { ...rules, seeding: 'H2H_RECORD' };
  l.matchups = [
    {
      id: 1,
      weeks: [1],
      homeId: 1,
      awayId: 2,
      homePoints: 20,
      awayPoints: 10,
      winnerId: 1,
    },
    {
      id: 2,
      weeks: [1],
      homeId: 3,
      awayId: 4,
      homePoints: 1000,
      awayPoints: 5,
      winnerId: 3,
    },
    ...l.matchups!.filter((m) => m.weeks[0] === 2),
  ];
  l.teams.forEach((t, i) => {
    t.wins = [1, 0, 1, 0][i];
    t.losses = 1 - t.wins;
    t.pointsFor = [20, 10, 1000, 5][i];
  });
  assert.equal(outcomes(l).get(2)?.playoffs, 1);
  l.playoffRules.seeding = 'TOTAL_POINTS_SCORED';
  assert.equal(outcomes(l).get(3)?.playoffs, 1);
});

test('unequal playoff rounds use week 18 scores and conserve title probabilities', () => {
  const l = league();
  l.week = 14;
  l.finalWeek = 18;
  l.playoffStartWeek = 15;
  l.playoffTeamCount = 4;
  l.playoffRounds = [[15], [16, 17, 18]];
  l.matchups = [
    { id: 1, weeks: [14], homeId: 1, awayId: 4 },
    { id: 2, weeks: [14], homeId: 2, awayId: 3 },
  ];
  l.teams[0].players[0].weeklyProjections = {
    14: 40,
    15: 40,
    16: 0,
    17: 0,
    18: 100,
  };
  const result = outcomes(l);
  assert.equal(result.get(1)?.title, 1);
  assert.equal(
    [...result.values()].reduce((sum, r) => sum + r.title!, 0),
    1,
  );
  l.teams[0].players[0].weeklyProjections![18] = 0;
  assert.equal(outcomes(l).get(2)?.title, 1);
});

test('already-started playoff brackets retain eliminated teams and imported current pairings', () => {
  const l = league();
  l.week = 4;
  l.playoffTeamCount = 4;
  l.playoffRounds = [[3], [4]];
  l.playoffRules = rules;
  l.teams.forEach((t) => {
    t.playoffSeed = t.id;
  });
  l.matchups = [
    { id: 1, weeks: [3], homeId: 1, awayId: 4, playoff: true, winnerId: 4 },
    { id: 2, weeks: [3], homeId: 2, awayId: 3, playoff: true, winnerId: 2 },
    { id: 3, weeks: [4], homeId: 4, awayId: 2, playoff: true },
  ];
  const result = forecastSeason(l);
  assert.ok(result.teams.every((t) => t.playoffs === 1));
  assert.equal(result.teams[1].championship, 1);
  assert.equal(result.teams[0].championship, 0);
  assert.equal(result.teams[2].championship, 0);
});

test('partly completed multi-week matchups retain prior-week actual totals in odds and display', () => {
  const l = league();
  l.week = 2;
  l.matchups = [
    {
      id: 1,
      weeks: [1, 2],
      homeId: 1,
      awayId: 4,
      homeActuals: { 1: -1000 },
      awayActuals: { 1: 0 },
    },
    {
      id: 2,
      weeks: [1, 2],
      homeId: 2,
      awayId: 3,
      homeActuals: { 1: 0 },
      awayActuals: { 1: 0 },
    },
  ];
  const result = forecastSeason(l);
  assert.equal(result.matchups.length, 2);
  assert.equal(result.matchups[0].homePoints, -960);
  assert.equal(result.matchups[0].homeWinChance, 0);
  assert.equal(result.teams[0].losses, 1);
});

test('six-team current brackets preserve bye branches regardless of imported matchup ordering', () => {
  const l = league();
  l.week = 3;
  l.finalWeek = 5;
  l.playoffStartWeek = 3;
  l.playoffTeamCount = 6;
  l.playoffRounds = [[3], [4], [5]];
  l.teams = demoLeague.teams.slice(0, 6).map((t, i) => ({
    ...t,
    id: i + 1,
    playoffSeed: i + 1,
    players: [player(i + 1, [40, 30, 20, 10, 5, 6][i])],
  }));
  l.teams[0].players[0].weeklyProjections = { 3: 40, 4: 50, 5: 50 };
  l.teams[1].players[0].weeklyProjections = { 3: 30, 4: 40, 5: 100 };
  l.matchups = [
    { id: 1, weeks: [3], homeId: 3, awayId: 6, playoff: true },
    { id: 2, weeks: [3], homeId: 4, awayId: 5, playoff: true },
  ];
  assert.equal(outcomes(l).get(2)?.title, 1);
  l.matchups.reverse();
  assert.equal(outcomes(l).get(2)?.title, 1);
});

test('unknown qualification rules preserve regular-season records and explain withheld odds', () => {
  const l = league();
  l.playoffRules = { ...rules, seeding: 'UNKNOWN_RULE' };
  const result = forecastSeason(l);
  assert.equal(result.teams[0].wins, 2);
  assert.ok(
    result.teams.every(
      (t) => t.playoffs === undefined && t.championship === undefined,
    ),
  );
  assert.match(
    result.description,
    /Unsupported playoff seeding rule: UNKNOWN_RULE/,
  );
});

test('explicit scenario calendar changes take precedence over imported round weeks', () => {
  const l = league();
  l.playoffRounds = [[3], [4]];
  l.playoffTeamCount = 4;
  assert.deepEqual(
    playoffWeeks(l, { teams: 4, startWeek: 2, roundWeeks: 1, reseed: true }),
    [[2], [3]],
  );
});
