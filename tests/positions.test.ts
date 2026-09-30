import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { normalizeLeague, ESPNResponse } from '../lib/espn';
import { normalizeWaiverPlayers } from '../lib/waivers';
import { League, removeDefensivePlayers } from '../lib/types';
import { optimalLineup } from '../lib/trades';

const entries = [
  { id: 1, defaultPositionId: 1, eligibleSlots: [0, 20] },
  { id: 2, defaultPositionId: 5, eligibleSlots: [17, 20] },
  { id: 3, defaultPositionId: 16, eligibleSlots: [16, 20] },
  { id: 4, defaultPositionId: 6, eligibleSlots: [8, 11, 15, 20] },
  { id: 5, defaultPositionId: 9, eligibleSlots: [10, 15, 20] },
  { id: 6, defaultPositionId: 12, eligibleSlots: [13, 14, 15, 20] },
];
test('ESPN roster and waiver imports omit defenses and defensive slots while retaining kickers', () => {
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
    ['QB', 'K'],
  );
  assert.deepEqual(
    league.slots.map((s) => s.id),
    [0, 17],
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
    ['QB', 'K'],
  );
});
test('old snapshots remove defensive roster and waiver players and slots without mutating the original', () => {
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
      players: i ? t.players : [...t.players, defense, idp],
    })),
    slots: [
      ...demoLeague.slots,
      { id: 16, label: 'D/ST', count: 1 },
      { id: 15, label: 'IDP', count: 1 },
    ],
    waiverWire: {
      ...demoLeague.waiverWire!,
      players: [
        ...demoLeague.waiverWire!.players,
        { ...defense, availability: 'WAIVERS', percentOwned: 10 },
      ],
    },
  } as unknown as League;
  const cleaned = removeDefensivePlayers(old);
  assert.equal(
    cleaned.teams[0].players.length,
    demoLeague.teams[0].players.length,
  );
  assert.equal(
    cleaned.waiverWire!.players.length,
    demoLeague.waiverWire!.players.length,
  );
  assert.deepEqual(cleaned.slots, demoLeague.slots);
  assert.equal(
    old.teams[0].players.length,
    cleaned.teams[0].players.length + 2,
  );
  assert.ok(optimalLineup(cleaned.teams[0].players, cleaned.slots).complete);
});
