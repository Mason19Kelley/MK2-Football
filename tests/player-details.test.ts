import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayer, enrichRosterStats, RawPlayer } from '../lib/espn';
import { normalizeWaiverPlayers } from '../lib/waivers';
import { demoLeague } from '../lib/demo';

const raw: RawPlayer = {
  id: 99,
  fullName: 'Test player',
  defaultPositionId: 1,
  ownership: { percentOwned: 95.4, percentStarted: 70.2 },
  stats: [
    ...[1, 4, 18].map((week) => ({
      seasonId: 2026,
      statSourceId: 1,
      statSplitTypeId: 1,
      scoringPeriodId: week,
      appliedTotal: week === 1 ? 0 : 20,
    })),
    {
      seasonId: 2026,
      statSourceId: 0,
      statSplitTypeId: 1,
      scoringPeriodId: 1,
      appliedTotal: 0,
    },
    {
      seasonId: 2025,
      statSourceId: 1,
      statSplitTypeId: 1,
      scoringPeriodId: 2,
      appliedTotal: 99,
    },
    {
      seasonId: 2026,
      statSourceId: 1,
      statSplitTypeId: 1,
      scoringPeriodId: 3,
      appliedTotal: NaN,
    },
  ],
};
test('player details retain full-season projections and actual zeros for rosters and waivers', () => {
  const player = normalizePlayer(raw, 2026, 4, 17);
  assert.deepEqual(player.weeklyProjections, { 1: 0, 4: 20 });
  assert.deepEqual(player.weeklyActuals, { 1: 0 });
  assert.equal(player.percentOwned, 95.4);
  assert.equal(player.percentStarted, 70.2);
  assert.equal(player.ros, null);
  const [waiver] = normalizeWaiverPlayers(
    [{ id: 99, onTeamId: 0, status: 'FREEAGENT', player: raw }],
    { ...demoLeague, season: 2026, week: 4, finalWeek: 17 },
  );
  assert.deepEqual(waiver.weeklyProjections, player.weeklyProjections);
});
test('full-season enrichment requests league scoring and preserves existing weekly values', async () => {
  const original = globalThis.fetch;
  const player = {
    ...normalizePlayer(raw, 2026, 4, 17),
    weeklyProjections: { 2: 15 },
    weekly: 15,
  };
  const league = {
    ...demoLeague,
    season: 2026,
    week: 4,
    teams: [{ ...demoLeague.teams[0], players: [player] }],
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('view'), 'kona_playercard');
    assert.equal(url.pathname.endsWith('/leagues/42'), true);
    const headers = options!.headers as Record<string, string>;
    assert.equal(headers.Cookie, 'test-cookie');
    const filter = JSON.parse(headers['x-fantasy-filter']).players;
    assert.deepEqual(filter.filterIds.value, [99]);
    assert.deepEqual(
      filter.filterStatsForScoringPeriodIds.value,
      Array.from({ length: 18 }, (_, week) => week),
    );
    assert.deepEqual(filter.filterStatsForSourceIds.value, [0, 1]);
    return Response.json({ players: [{ player: raw }] });
  };
  try {
    await enrichRosterStats(
      new URL(
        'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/42?view=mRoster',
      ),
      { Cookie: 'test-cookie' },
      league,
    );
    assert.deepEqual(player.weeklyProjections, { 1: 0, 2: 15, 4: 20 });
    assert.deepEqual(player.weeklyActuals, { 1: 0 });
    assert.equal(player.weekly, 20);
  } finally {
    globalThis.fetch = original;
  }
});
