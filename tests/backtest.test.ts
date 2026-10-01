import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBacktestWeek } from '../lib/espn';
import {
  compareBacktests,
  completedWeeks,
  BacktestData,
  BacktestStarter,
  runBacktest,
  simulateStarter,
} from '../lib/backtest';
import { defaultScenarioSettings, ScoreShape } from '../lib/trade-evaluation';
import { Position } from '../lib/types';

const settings = { ...defaultScenarioSettings, samples: 256 };
const lineup: [Position, number][] = [
  ['QB', 18],
  ['RB', 14],
  ['RB', 10],
  ['WR', 15],
  ['WR', 12],
  ['WR', 8],
  ['TE', 9],
  ['K', 8],
  ['D/ST', 6],
];
const nflTeams = ['KC', 'BUF', 'PHI', 'SF', 'DAL', 'MIA', 'DET', 'BAL'];

// League history whose actual scores are drawn from the model itself, with
// deviations from projection optionally stretched to mimic a too-narrow model.
function history(
  stretch = 1,
  teams = 10,
  weeks = 14,
  scoreShape: ScoreShape = 'gamma',
): BacktestData {
  const truth = { ...settings, samples: 8, seed: 99, scoreShape };
  const teamWeeks = [];
  for (let week = 1; week <= weeks; week++)
    for (let teamId = 1; teamId <= teams; teamId++)
      teamWeeks.push({
        week,
        teamId,
        starters: lineup.map(([position, projection], i): BacktestStarter => {
          const starter = {
            id: teamId * 100 + i,
            position,
            nflTeam: nflTeams[(teamId * 3 + i + week) % nflTeams.length],
            projection: projection * (0.8 + 0.05 * teamId),
            actual: 0,
          };
          const drawn = simulateStarter(starter, week, truth)[0];
          const actual =
            starter.projection + (drawn - starter.projection) * stretch;
          return {
            ...starter,
            actual: Math.max(position === 'D/ST' ? -5 : 0, actual),
          };
        }),
      });
  const matchups = [];
  for (let week = 1; week <= weeks; week++)
    for (let home = 1; home <= teams; home += 2)
      matchups.push({
        id: week * 100 + home,
        weeks: [week],
        homeId: home,
        awayId: home + 1,
      });
  return { teamWeeks, matchups };
}

test('backtest of scores drawn from the model itself is calibrated', () => {
  const report = runBacktest(history(), settings);
  assert.equal(report.teams.count, 140);
  assert.deepEqual(
    report.weeks,
    Array.from({ length: 14 }, (_, i) => i + 1),
  );
  assert.ok(Math.abs(report.teams.zSd - 1) < 0.15, `z SD ${report.teams.zSd}`);
  assert.ok(
    Math.abs(report.teams.zMean) < 0.25,
    `z mean ${report.teams.zMean}`,
  );
  assert.ok(
    Math.abs(report.teams.coverage80 - 0.8) < 0.08,
    `coverage ${report.teams.coverage80}`,
  );
  assert.equal(report.matchups.count, 70);
  assert.ok(report.matchups.brier >= 0 && report.matchups.brier <= 1);
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const)
    assert.ok(report.players[position]!.all.count > 0);
});

test('a too-narrow model is detected and a wider candidate passes the gate', () => {
  const data = history(2);
  const narrow = runBacktest(data, settings);
  assert.ok(narrow.teams.zSd > 1.3, `z SD ${narrow.teams.zSd}`);
  assert.ok(narrow.teams.coverage80 < 0.7);
  const wider = runBacktest(data, { ...settings, scoreCv: 2 });
  assert.ok(Math.abs(wider.teams.zSd - 1) < Math.abs(narrow.teams.zSd - 1));
  assert.equal(compareBacktests(narrow, wider).verdict, 'better');
  assert.equal(compareBacktests(wider, narrow).verdict, 'worse');
  assert.equal(compareBacktests(narrow, narrow).verdict, 'within-noise');
  const zSd = compareBacktests(narrow, wider).measures.zSd!;
  assert.ok(zSd.difference < 0 && zSd.interval[1] < 0);
});

test('with only a few weeks, small setting changes are within noise', () => {
  const few = history(1, 10, 3);
  const base = runBacktest(few, settings);
  const nudged = runBacktest(few, { ...settings, scoreCv: 1.1 });
  assert.equal(compareBacktests(base, nudged).verdict, 'within-noise');
  const [low, high] = base.teams.intervals.coverage80;
  assert.ok(low <= base.teams.coverage80 && base.teams.coverage80 <= high);
  const many = runBacktest(history(), settings).teams.intervals.zSd;
  const fewWidth = base.teams.intervals.zSd[1] - base.teams.intervals.zSd[0];
  assert.ok(fewWidth > (many[1] - many[0]) * 1.5);
  const [brierLow, brierHigh] = base.matchups.brierInterval;
  assert.ok(
    brierLow <= base.matchups.brier && base.matchups.brier <= brierHigh,
  );
  // Identical runs give identical intervals.
  assert.deepEqual(runBacktest(few, settings).teams, base.teams);
  assert.throws(() => compareBacktests(base, runBacktest(history(), settings)));
});

test('bench players calibrate positions without changing team totals', () => {
  const data = history(1, 4, 3);
  const withBench = {
    ...data,
    teamWeeks: data.teamWeeks.map((t) => ({
      ...t,
      bench: [
        {
          id: t.teamId * 100 + 50,
          position: 'WR' as const,
          nflTeam: 'KC',
          projection: 7,
          actual: 4,
        },
        // A bye-week player projected at zero is left out.
        {
          id: t.teamId * 100 + 51,
          position: 'RB' as const,
          nflTeam: 'KC',
          projection: 0,
          actual: 0,
        },
      ],
    })),
  };
  const plain = runBacktest(data, settings);
  const benched = runBacktest(withBench, settings);
  assert.deepEqual(benched.teams, plain.teams);
  assert.equal(benched.players.WR!.all.count, plain.players.WR!.all.count + 12);
  assert.equal(benched.players.WR!.bench.count, 12);
  assert.deepEqual(benched.players.WR!.starters, plain.players.WR!.starters);
  assert.equal(benched.players.RB!.all.count, plain.players.RB!.all.count);
  assert.equal(benched.players.RB!.bench.count, 0);
});

test('tail and zero-score diagnostics locate where misses fall', () => {
  const calibrated = runBacktest(history(), settings).players.WR!.all;
  assert.ok(Math.abs(calibrated.below10 - 0.1) < 0.05, `${calibrated.below10}`);
  assert.ok(Math.abs(calibrated.above90 - 0.1) < 0.05, `${calibrated.above90}`);
  // Gamma draws for 6–8 point players almost never reach zero.
  assert.ok(calibrated.zeroSimulated < 0.01);
  // Every fourth bench WR sits out and scores nothing.
  const data = history(1, 4, 3);
  const duds = runBacktest(
    {
      ...data,
      teamWeeks: data.teamWeeks.map((t, i) => ({
        ...t,
        bench: [
          {
            id: t.teamId * 100 + 50,
            position: 'WR' as const,
            nflTeam: 'KC',
            projection: 6,
            actual: i % 4 ? 6 : 0,
          },
        ],
      })),
    },
    settings,
  ).players.WR!.bench;
  assert.equal(duds.zeroActual, 0.25);
  assert.ok(duds.zeroSimulated < 0.01);
  assert.equal(duds.below10, 0.25);
  assert.equal(duds.above90, 0);
});

test('matchup probabilities beat a coin flip when one side is clearly stronger', () => {
  const starter = (id: number, projection: number, actual: number) => ({
    id,
    position: 'WR' as const,
    nflTeam: 'KC',
    projection,
    actual,
  });
  const report = runBacktest(
    {
      teamWeeks: [
        { week: 1, teamId: 1, starters: [starter(1, 30, 28)] },
        { week: 1, teamId: 2, starters: [starter(2, 5, 6)] },
        { week: 2, teamId: 1, starters: [starter(1, 30, 25)] },
        { week: 2, teamId: 2, starters: [starter(2, 5, 3)] },
      ],
      matchups: [
        { id: 1, weeks: [1, 2], homeId: 1, awayId: 2 },
        // Weeks outside the data are not scored.
        { id: 2, weeks: [3], homeId: 1, awayId: 2 },
      ],
    },
    settings,
  );
  assert.equal(report.matchups.count, 1);
  assert.ok(report.matchups.brier < 0.01);
  assert.ok(report.matchups.skill > 0.9);
});

test('box score import keeps starters and projected bench players and skips unprojected lineups', () => {
  const stats = (week: number, projection?: number, actual?: number) => [
    ...(projection === undefined
      ? []
      : [
          {
            seasonId: 2026,
            statSourceId: 1,
            statSplitTypeId: 1,
            scoringPeriodId: week,
            appliedTotal: projection,
          },
        ]),
    ...(actual === undefined
      ? []
      : [
          {
            seasonId: 2026,
            statSourceId: 0,
            statSplitTypeId: 1,
            scoringPeriodId: week,
            appliedTotal: actual,
          },
        ]),
    // Another week's line must be ignored.
    {
      seasonId: 2026,
      statSourceId: 0,
      statSplitTypeId: 1,
      scoringPeriodId: week + 1,
      appliedTotal: 99,
    },
  ];
  const entry = (
    id: number,
    lineupSlotId: number,
    defaultPositionId: number,
    projection?: number,
    actual?: number,
  ) => ({
    lineupSlotId,
    playerPoolEntry: {
      player: {
        id,
        defaultPositionId,
        proTeamId: 12,
        stats: stats(3, projection, actual),
      },
    },
  });
  const { teamWeeks, skipped } = parseBacktestWeek(
    {
      schedule: [
        {
          home: {
            teamId: 1,
            rosterForCurrentScoringPeriod: {
              entries: [
                entry(1, 0, 1, 20, 24.5),
                entry(2, 4, 3, 12),
                entry(3, 20, 3, 15, 30),
                // An unprojected bench player is dropped without voiding the week.
                entry(6, 20, 2, undefined, 8),
                entry(7, 21, 2, 10, 12),
                entry(4, 16, 16, 7, -2),
              ],
            },
          },
          away: {
            teamId: 2,
            rosterForCurrentScoringPeriod: {
              entries: [entry(5, 0, 1, undefined, 10)],
            },
          },
        },
        { home: { teamId: 3 }, away: { teamId: 4 } },
      ],
    },
    2026,
    3,
  );
  assert.equal(skipped, 1);
  assert.deepEqual(teamWeeks, [
    {
      week: 3,
      teamId: 1,
      starters: [
        { id: 1, position: 'QB', nflTeam: 'KC', projection: 20, actual: 24.5 },
        { id: 2, position: 'WR', nflTeam: 'KC', projection: 12, actual: 0 },
        { id: 4, position: 'D/ST', nflTeam: 'KC', projection: 7, actual: -2 },
      ],
      bench: [
        { id: 3, position: 'WR', nflTeam: 'KC', projection: 15, actual: 30 },
      ],
    },
  ]);
});

test('completed weeks run through the last decided matchup', () => {
  assert.deepEqual(completedWeeks({ week: 1, matchups: [] }), []);
  assert.deepEqual(completedWeeks({ week: 4 }), [1, 2, 3]);
  assert.deepEqual(
    completedWeeks({
      week: 18,
      matchups: [
        { id: 1, weeks: [16, 17], homeId: 1, awayId: 2, winnerId: 1 },
        { id: 2, weeks: [18], homeId: 1, awayId: 2 },
      ],
    }),
    Array.from({ length: 17 }, (_, i) => i + 1),
  );
});

test('the gate picks the weekly score shape that generated the data', () => {
  for (const [truth, wrong] of [
    ['gamma', 'lognormal'],
    ['lognormal', 'gamma'],
  ] as const) {
    // Low-projection bench players are where the two shapes differ most.
    const base = history(1, 10, 14, truth);
    const draw = { ...settings, samples: 8, seed: 99, scoreShape: truth };
    const data = {
      ...base,
      teamWeeks: base.teamWeeks.map((t) => ({
        ...t,
        bench: [3, 4, 5, 6].map((projection, i) => {
          const p = {
            id: t.teamId * 100 + 60 + i,
            position: i % 2 ? ('WR' as const) : ('RB' as const),
            nflTeam: nflTeams[(t.teamId + i) % nflTeams.length],
            projection,
            actual: 0,
          };
          return { ...p, actual: simulateStarter(p, t.week, draw)[0] };
        }),
      })),
    };
    const right = runBacktest(data, { ...settings, scoreShape: truth });
    const other = runBacktest(data, { ...settings, scoreShape: wrong });
    assert.ok(
      Math.abs(right.playerTails.below10 - 0.1) < 0.03,
      `${truth} below ${right.playerTails.below10}`,
    );
    const comparison = compareBacktests(other, right);
    assert.ok(comparison.measures.playerTails!.interval[1] < 0, truth);
    assert.equal(comparison.verdict, 'better', truth);
    assert.equal(compareBacktests(right, other).verdict, 'worse', truth);
  }
  // The lognormal's thin low tail shows as excess misses below the 10th.
  const gammaWorld = runBacktest(history(), {
    ...settings,
    scoreShape: 'lognormal',
  });
  assert.ok(gammaWorld.playerTails.below10 > 0.12);
});
