import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoLeague } from '../lib/demo';
import {
  forecastTradeSeasonOdds,
  createTradeSeasonForecaster,
  TradeSeasonOddsInput,
} from '../lib/trade-season-odds';
import { League } from '../lib/types';

function fixture(): TradeSeasonOddsInput {
  const league: League = {
    ...demoLeague,
    week: 1,
    finalWeek: 3,
    playoffStartWeek: 3,
    playoffTeamCount: 2,
    playoffRoundWeeks: 1,
    slots: [{ id: 0, label: 'QB', count: 1 }],
    teams: demoLeague.teams.slice(0, 4).map((team, i) => ({
      ...team,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      players: [
        {
          ...demoLeague.teams[0].players[0],
          id: i + 1,
          eligibleSlots: [0],
          weekly: 40 - i * 10,
          ros: (40 - i * 10) * 3,
          weeklyProjections: {},
          byeWeek: 0,
          status: 'ACTIVE',
          availabilityProbability: 1,
          scoreStdDev: 0,
          roleStdDev: 0,
        },
      ],
    })),
    matchups: [1, 2].flatMap((week) => [
      { id: week * 2, weeks: [week], homeId: 1, awayId: 3 },
      { id: week * 2 + 1, weeks: [week], homeId: 2, awayId: 4 },
    ]),
    waiverWire: undefined,
  };
  const move = (roster: (typeof league.teams)[number]['players']) => ({
    roster,
    openSpots: 0,
    capacitySource: 'league' as const,
  });
  return {
    league,
    myTeamId: 1,
    partnerId: 4,
    streaming: false,
    plan: {
      mine: move(league.teams[3].players),
      partner: move(league.teams[0].players),
    },
    scenarios: {
      samples: 8,
      seed: 1,
      availability: 1,
      scoreCv: 0,
      roleCv: 0,
      teamCorrelation: 0,
    },
  };
}

test('manual point trades show full-season playoff and title odds for both teams', () => {
  const input = fixture();
  const snapshot = JSON.stringify(input);
  const result = forecastTradeSeasonOdds(input);
  const [mine, partner] = result.teams;
  assert.equal(mine.before.playoffs, 1);
  assert.equal(mine.before.title, 1);
  assert.equal(mine.after.playoffs, 0);
  assert.equal(mine.after.title, 0);
  assert.equal(partner.before.playoffs, 0);
  assert.equal(partner.before.title, 0);
  assert.equal(partner.after.playoffs, 1);
  assert.equal(partner.after.title, 1);
  assert.deepEqual(result, forecastTradeSeasonOdds(input));
  assert.equal(JSON.stringify(input), snapshot);
});

test('odds include actual before and after roster plans, including no-trade pickups', () => {
  const input = fixture();
  input.baseline = { mine: input.plan.mine, partner: input.plan.partner };
  const result = forecastTradeSeasonOdds(input);
  result.teams.forEach((team) => assert.deepEqual(team.before, team.after));
  assert.match(result.description, /selected no-trade roster plans/);
});

test('missing schedules, unsupported brackets and missing forecasts do not invent odds', () => {
  const input = fixture();
  assert.throws(
    () =>
      forecastTradeSeasonOdds({
        ...input,
        league: { ...input.league, matchups: [] },
      }),
    /schedule/,
  );
  const unsupported = forecastTradeSeasonOdds({
    ...input,
    league: { ...input.league, playoffTeamCount: 3 },
  });
  assert.ok(
    unsupported.teams.every(
      (t) => t.before.playoffs !== undefined && t.before.title === undefined,
    ),
  );
  assert.match(unsupported.championshipError, /supported playoff bracket/);
  input.league.teams[1].players[0].ros = null;
  input.league.teams[1].players[0].weekly = null;
  assert.throws(() => forecastTradeSeasonOdds(input), /forecasts/);
});

test('trade metrics show full expected records and reuse the same season scenarios across results', () => {
  const input = fixture();
  input.league.teams[0].wins = 3;
  input.league.teams[0].losses = 2;
  const forecast = createTradeSeasonForecaster(input);
  const result = forecast(input);
  assert.deepEqual(result.teams[0].beforeRecord, {
    wins: 5,
    losses: 2,
    ties: 0,
  });
  assert.deepEqual(result.teams[0].afterRecord, {
    wins: 3,
    losses: 4,
    ties: 0,
  });
  assert.deepEqual(forecast(input), result);
  assert.deepEqual(result, forecastTradeSeasonOdds(input));
  const unchanged = forecast({ ...input, baseline: input.plan });
  assert.deepEqual(
    unchanged.teams[0].beforeRecord,
    unchanged.teams[0].afterRecord,
  );
});
