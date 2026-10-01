import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { restoreSourceProjections } from '../lib/projections';

test('old ROS and weekly uploads restore source values across rosters and waivers', () => {
  const cached = structuredClone(demoLeague);
  const player = cached.teams[0].players[0];
  player.ros = 999;
  player.projectionSource = 'custom';
  player.weekly = 0;
  player.weeklyOverrides = { [cached.week]: 0 };
  player.projectionBounds = { ros: { lower: 999, upper: 999 } };
  player.forecastProvenance = 'Manager CSV';
  player.availabilityProbability = 0;
  player.returnWeek = cached.finalWeek;
  player.scoreStdDev = 0;
  player.roleStdDev = 0;
  player.forecastUpdatedAt = '2026-01-01';
  player.slot = 'BN';
  const waiver = cached.waiverWire!.players[0];
  waiver.ros = 999;
  waiver.projectionSource = 'custom';
  const restored = restoreSourceProjections(cached, demoLeague);
  const result = restored.teams[0].players[0];
  const source = demoLeague.teams[0].players[0];
  assert.equal(result.ros, source.ros);
  assert.equal(result.weekly, source.weekly);
  assert.equal(result.projectionSource, source.projectionSource);
  assert.equal(result.slot, 'BN');
  for (const field of [
    'weeklyOverrides',
    'projectionBounds',
    'forecastProvenance',
    'forecastUpdatedAt',
    'availabilityProbability',
    'returnWeek',
    'scoreStdDev',
    'roleStdDev',
  ])
    assert.equal(field in result, false);
  assert.equal(
    restored.waiverWire!.players[0].ros,
    demoLeague.waiverWire!.players[0].ros,
  );
  assert.equal(
    restored.waiverWire!.players[0].availability,
    waiver.availability,
  );
  assert.equal(player.ros, 999);
  assert.deepEqual(restoreSourceProjections(restored, restored), restored);
});

test('unrecoverable uploaded values are unavailable until ESPN refreshes', () => {
  const cached = structuredClone(demoLeague);
  cached.teams[0].players[0].ros = 999;
  cached.teams[0].players[0].projectionSource = 'custom';
  for (const baseline of [
    undefined,
    cached,
    { ...demoLeague, id: 'other' },
    { ...demoLeague, season: 2000 },
  ]) {
    const player = restoreSourceProjections(cached, baseline).teams[0]
      .players[0];
    assert.equal(player.ros, null);
    assert.equal(player.projectionSource, 'unavailable');
  }
});

test('clean source snapshots retain ESPN values, including zero and missing forecasts', () => {
  const cached = structuredClone(demoLeague);
  cached.teams[0].players[0].weekly = 0;
  cached.teams[0].players[0].ros = null;
  assert.deepEqual(restoreSourceProjections(cached), cached);
});
