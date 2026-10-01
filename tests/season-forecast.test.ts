import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoLeague } from '../lib/demo';
import { forecastSeason } from '../lib/season-forecast';
import { normalizeLeague } from '../lib/espn';
import { League } from '../lib/types';

function fixture(): League {
  return {
    ...demoLeague,
    week: 2,
    finalWeek: 4,
    playoffStartWeek: 3,
    playoffTeamCount: 4,
    slots: [{ id: 0, label: 'QB', count: 1 }],
    teams: demoLeague.teams.slice(0, 4).map((t, i) => ({
      ...t,
      wins: i % 2,
      losses: 1 - (i % 2),
      ties: 0,
      players: [
        {
          ...demoLeague.teams[0].players[0],
          id: i + 1,
          weekly: 20 + i * 3,
          ros: 60 + i * 9,
          weeklyProjections: {},
          eligibleSlots: [0],
          byeWeek: 0,
          availabilityProbability: 1,
        },
      ],
    })),
    matchups: [
      { id: 1, weeks: [2], homeId: 1, awayId: 2 },
      { id: 2, weeks: [2], homeId: 3, awayId: 4 },
    ],
  };
}

test('season forecast conserves wins, losses and playoff probabilities and excludes playoff games from records', () => {
  const league = fixture();
  const result = forecastSeason(league);
  assert.deepEqual(result, forecastSeason(league));
  for (const team of result.teams) {
    assert.equal(team.wins + team.losses + team.ties, 2);
    assert.equal(team.playoffs, 1);
    assert.ok(team.championship! >= 0 && team.championship! <= 1);
  }
  assert.equal(
    result.teams.reduce((sum, t) => sum + t.championship!, 0),
    1,
  );
  assert.equal(
    result.teams.reduce((sum, t) => sum + t.wins, 0),
    4,
  );
  assert.equal(
    result.teams.reduce((sum, t) => sum + t.losses, 0),
    4,
  );
});

test('forecast rejects incomplete and partially completed schedules', () => {
  const league = fixture();
  assert.throws(
    () => forecastSeason({ ...league, matchups: league.matchups!.slice(0, 1) }),
    /incomplete/,
  );
  assert.throws(
    () =>
      forecastSeason({
        ...league,
        matchups: league.matchups!.map((m) => ({ ...m, weeks: [1, 2] })),
      }),
    /partial/,
  );
});

test('unsupported playoff settings preserve records while withholding odds', () => {
  const result = forecastSeason({ ...fixture(), playoffTeamCount: 3 });
  assert.ok(
    result.teams.every(
      (t) => t.playoffs === undefined && t.championship === undefined,
    ),
  );
  assert.match(result.description, /Playoff odds unavailable/);
});

test('tied simulations preserve ties rather than count them as wins or losses', () => {
  const league = fixture();
  league.teams.forEach((t) => {
    t.players[0].availabilityProbability = 0;
  });
  const result = forecastSeason(league);
  for (const [i, team] of result.teams.entries()) {
    assert.equal(team.wins, league.teams[i].wins);
    assert.equal(team.losses, league.teams[i].losses);
    assert.equal(team.ties, 1);
  }
});

test('ESPN normalization imports playoff qualification and round length settings', () => {
  const league = normalizeLeague(
    {
      id: 1,
      teams: [{ id: 1 }, { id: 2 }],
      settings: {
        scheduleSettings: {
          playoffTeamCount: 6,
          playoffMatchupPeriodLength: 2,
        },
      },
    },
    2026,
  );
  assert.equal(league.playoffTeamCount, 6);
  assert.equal(league.playoffRoundWeeks, 2);
});
