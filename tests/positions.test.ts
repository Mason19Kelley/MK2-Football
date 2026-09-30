import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague, restoreDemoDefenses } from '../lib/demo';
import { normalizeLeague, ESPNResponse } from '../lib/espn';
import { normalizeWaiverPlayers } from '../lib/waivers';
import { League, removeIDPPlayers } from '../lib/types';
import { optimalLineup } from '../lib/trades';

const entries = [
  { id: 1, defaultPositionId: 1, eligibleSlots: [0, 20] },
  { id: 2, defaultPositionId: 5, eligibleSlots: [17, 20] },
  { id: 3, defaultPositionId: 16, eligibleSlots: [16, 20] },
  { id: 4, defaultPositionId: 6, eligibleSlots: [8, 11, 15, 20] },
  { id: 5, defaultPositionId: 9, eligibleSlots: [10, 15, 20] },
  { id: 6, defaultPositionId: 12, eligibleSlots: [13, 14, 15, 20] },
];
test('ESPN roster and waiver imports omit IDP players and slots while retaining D/ST and kickers', () => {
  const raw: ESPNResponse = {
    id: 1,
    settings: {
      rosterSettings: {
        lineupSlotCounts: {
          0: 1,
          8: 1,
          10: 1,
          13: 1,
          15: 1,
          16: 1,
          17: 1,
          20: 5,
          24: 1,
        },
      },
    },
    teams: [
      {
        id: 1,
        roster: {
          entries: entries.map((player) => ({
            lineupSlotId: 20,
            playerPoolEntry: { player },
          })),
        },
      },
    ],
  };
  const league = normalizeLeague(raw, 2026);
  assert.deepEqual(
    league.teams[0].players.map((p) => p.position),
    ['QB', 'K', 'D/ST'],
  );
  assert.deepEqual(
    league.slots.map((s) => s.id),
    [0, 16, 17],
  );
  const waivers = normalizeWaiverPlayers(
    entries.map((player) => ({
      id: player.id,
      onTeamId: 0,
      status: 'FREEAGENT',
      player,
    })),
    { ...league, teams: [] },
  );
  assert.deepEqual(
    waivers.map((p) => p.position),
    ['QB', 'K', 'D/ST'],
  );
});
test('old snapshots retain D/ST projections while removing IDP players and slots', () => {
  const defense = {
    ...demoLeague.teams[0].players[0],
    id: 999,
    name: 'Old defense',
    position: 'D/ST',
    slotId: 16,
    eligibleSlots: [16, 20],
  };
  const idp = {
    ...defense,
    id: 998,
    position: 'IDP',
    slotId: 20,
    eligibleSlots: [15, 20],
  };
  const old = {
    ...demoLeague,
    teams: demoLeague.teams.map((t, i) => ({
      ...t,
      players: i
        ? t.players
        : [...t.players.filter((p) => p.position !== 'D/ST'), defense, idp],
    })),
    slots: [...demoLeague.slots, { id: 15, label: 'IDP', count: 1 }],
    waiverWire: {
      ...demoLeague.waiverWire!,
      players: [
        ...demoLeague.waiverWire!.players,
        { ...defense, availability: 'WAIVERS', percentOwned: 10 },
      ],
    },
  } as unknown as League;
  const cleaned = removeIDPPlayers(old);
  assert.equal(
    cleaned.teams[0].players.length,
    demoLeague.teams[0].players.length,
  );
  assert.equal(
    cleaned.waiverWire!.players.length,
    demoLeague.waiverWire!.players.length + 1,
  );
  assert.deepEqual(cleaned.slots, demoLeague.slots);
  assert.ok(
    cleaned.teams[0].players.some((p) => p.id === 999 && p.position === 'D/ST'),
  );
  assert.ok(
    cleaned.teams[0].players
      .find((p) => p.id === 999)!
      .eligibleSlots.includes(16),
  );
  assert.equal(
    old.teams[0].players.length,
    cleaned.teams[0].players.length + 1,
  );
  assert.ok(optimalLineup(cleaned.teams[0].players, cleaned.slots).complete);
});

test('saved sample leagues recover missing defenses without replacing custom projections', () => {
  const saved: League = {
    ...demoLeague,
    teams: demoLeague.teams.map((t) => ({
      ...t,
      players: t.players
        .filter((p) => p.position !== 'D/ST')
        .map((p) => ({ ...p, ros: 777 })),
    })),
    slots: demoLeague.slots.filter((s) => s.id !== 16),
  };
  const restored = restoreDemoDefenses(saved);
  assert.ok(restored.slots.some((s) => s.id === 16));
  assert.ok(
    restored.teams.every((t) => t.players.some((p) => p.position === 'D/ST')),
  );
  assert.equal(
    restored.teams[0].players.find((p) => p.position === 'QB')!.ros,
    777,
  );
  assert.equal(
    restoreDemoDefenses({ ...saved, source: 'espn' }).teams,
    saved.teams,
  );
});
