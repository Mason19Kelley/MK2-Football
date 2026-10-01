import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBacktestWeek } from '../lib/espn';
import {
  backtestImproves,
  completedWeeks,
  BacktestData,
  BacktestStarter,
  runBacktest,
  simulateStarter,
} from '../lib/backtest';
import { defaultScenarioSettings } from '../lib/trade-evaluation';
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
function history(stretch = 1, teams = 10, weeks = 14): BacktestData {
  const truth = { ...settings, samples: 8, seed: 99 };
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
    assert.ok(report.players[position]!.count > 0);
});

test('a too-narrow model is detected and a wider candidate passes the gate', () => {
  const data = history(2);
  const narrow = runBacktest(data, settings);
  assert.ok(narrow.teams.zSd > 1.3, `z SD ${narrow.teams.zSd}`);
  assert.ok(narrow.teams.coverage80 < 0.7);
  const wider = runBacktest(data, { ...settings, scoreCv: 2 });
  assert.ok(Math.abs(wider.teams.zSd - 1) < Math.abs(narrow.teams.zSd - 1));
  assert.equal(backtestImproves(narrow, wider), true);
  assert.equal(backtestImproves(wider, narrow), false);
  assert.equal(backtestImproves(narrow, narrow), false);
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

test('box score import keeps starters with their week projection and skips unprojected lineups', () => {
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
