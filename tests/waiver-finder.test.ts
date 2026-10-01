import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import {
  League,
  Player,
  WaiverPlayer,
  normalizeFantasySeason,
} from '../lib/types';
import { findWaiverPickups } from '../lib/waiver-finder';
import { horizonWeeks, playerWeek } from '../lib/weekly-trades';
import { normalizePlayer, normalizeLeague } from '../lib/espn';

const player = (id: number, forecasts: Record<number, number>): Player => ({
  ...demoLeague.teams[0].players[0],
  id,
  name: `Player ${id}`,
  position: 'QB',
  eligibleSlots: [0, 20],
  slotId: 20,
  slot: 'BN',
  status: 'ACTIVE',
  byeWeek: 0,
  weekly: forecasts[16] ?? null,
  ros: Object.values(forecasts).reduce((a, b) => a + b, 0),
  weeklyProjections: forecasts,
  projectionSource: 'weekly-sum',
});
const waiver = (
  id: number,
  forecasts: Record<number, number>,
  availability: WaiverPlayer['availability'] = 'FREEAGENT',
): WaiverPlayer => ({
  ...player(id, forecasts),
  availability,
  percentOwned: 1,
});
const fixture = (): League => ({
  ...demoLeague,
  week: 16,
  finalWeek: 17,
  slots: [{ id: 0, label: 'QB', count: 1 }],
  teams: [
    {
      ...demoLeague.teams[0],
      players: [player(1, { 16: 20, 17: 0 }), player(2, { 16: 0, 17: 20 })],
      rosterCapacity: 2,
    },
  ],
  waiverWire: {
    syncedAt: '',
    truncated: false,
    players: [
      waiver(3, { 16: 30, 17: 30 }, 'WAIVERS'),
      waiver(4, { 16: 25, 17: 0 }),
      waiver(5, { 16: 0, 17: 0, 18: 1000 }),
    ],
  },
});
test('finder ranks all improving pickups including waiver claims using weekly bench depth', () => {
  const league = fixture();
  const result = findWaiverPickups(league, league.teams[0].id);
  assert.deepEqual(
    result.pickups.map((p) => p.add.id),
    [3, 4],
  );
  assert.deepEqual(
    result.pickups.map((p) => p.gain),
    [20, 5],
  );
  assert.equal(result.pickups[0].add.availability, 'WAIVERS');
  assert.equal(result.pickups[1].drops[0].id, 1);
  assert.equal(result.pickups[0].before, 40);
  assert.equal(league.teams[0].players.length, 2);
});
test('finder respects locks, acquisition limits, open spots, and position limits', () => {
  const league = fixture(),
    team = league.teams[0];
  team.rosterCapacity = 3;
  assert.equal(findWaiverPickups(league, team.id).pickups[0].drops.length, 0);
  league.positionLimits = { QB: 2 };
  assert.equal(findWaiverPickups(league, team.id).pickups[0].drops.length, 1);
  delete league.positionLimits;
  team.acquisitionsRemaining = 0;
  assert.equal(findWaiverPickups(league, team.id).pickups.length, 0);
  delete team.acquisitionsRemaining;
  team.rosterCapacity = 2;
  team.players = team.players.map((p) => ({ ...p, transactionLocked: true }));
  assert.equal(findWaiverPickups(league, team.id).pickups.length, 0);
});
test('finder suppresses recommendations with missing baseline or pickup projections', () => {
  const league = fixture(),
    team = league.teams[0];
  league.waiverWire!.players = [{ ...waiver(6, {}), ros: null }];
  assert.equal(findWaiverPickups(league, team.id).pickups.length, 0);
  team.players[0] = {
    ...team.players[0],
    ros: null,
    weekly: null,
    weeklyProjections: {},
  };
  assert.throws(() => findWaiverPickups(league, team.id), /Complete your team/);
});
test('week 18 is excluded from imported totals, horizons, and saved snapshots', () => {
  const stats = [16, 17, 18].map((w) => ({
    seasonId: 2026,
    statSourceId: 1,
    statSplitTypeId: 1,
    scoringPeriodId: w,
    appliedTotal: w === 18 ? 1000 : 10,
  }));
  const normalized = normalizePlayer(
    { id: 1, defaultPositionId: 1, stats },
    2026,
    16,
    18,
  );
  assert.equal(normalized.ros, 20);
  assert.deepEqual(normalized.weeklyProjections, { 16: 10, 17: 10 });
  assert.equal(
    normalizeLeague(
      { id: 1, teams: [{ id: 1 }], status: { finalScoringPeriod: 18 } },
      2026,
    ).finalWeek,
    17,
  );
  const league = fixture();
  league.finalWeek = 18;
  league.teams[0].players = [player(1, { 16: 10, 17: 10, 18: 1000 })];
  const migrated = normalizeFantasySeason(league);
  assert.equal(migrated.teams[0].players[0].ros, 20);
  assert.deepEqual(normalizeFantasySeason(migrated), migrated);
  assert.deepEqual(horizonWeeks(league, 'remaining'), [16, 17]);
  assert.equal(playerWeek(league.teams[0].players[0], league, 18).points, 0);
  assert.equal(
    normalizePlayer({ id: 1, defaultPositionId: 1, stats }, 2026, 18, 18).ros,
    0,
  );
  assert.equal(
    normalizeFantasySeason({ ...league, week: 18 }).teams[0].players[0].ros,
    0,
  );
});
