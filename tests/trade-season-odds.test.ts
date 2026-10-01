import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoLeague } from '../lib/demo';
import {
  forecastTradeSeasonOdds,
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
  assert.throws(
    () =>
      forecastTradeSeasonOdds({
        ...input,
        league: { ...input.league, playoffTeamCount: 3 },
      }),
    /supported future playoff bracket/,
  );
  input.league.teams[1].players[0].ros = null;
  input.league.teams[1].players[0].weekly = null;
  assert.throws(() => forecastTradeSeasonOdds(input), /forecasts/);
});
