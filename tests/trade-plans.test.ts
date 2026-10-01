import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { League, Player } from '../lib/types';
import { planTrade } from '../lib/trade-plans';
import { findTrades } from '../lib/trade-finder';
import { optimalLineup } from '../lib/trades';

function p(id: number, ros: number, slot: number): Player {
  return {
    ...demoLeague.teams[0].players[0],
    id,
    name: `Player ${id}`,
    ros,
    position: slot === 2 ? 'RB' : 'WR',
    slotId: 20,
    eligibleSlots: [slot],
  };
}
function league(): League {
  return {
    ...demoLeague,
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      {
        ...demoLeague.teams[0],
        id: 1,
        players: [p(1, 100, 2), p(2, 90, 2), p(3, 40, 4)],
      },
      {
        ...demoLeague.teams[1],
        id: 2,
        players: [p(4, 40, 2), p(5, 100, 4), p(6, 30, 4)],
      },
    ],
    waiverWire: {
      syncedAt: '',
      truncated: false,
      players: [
        { ...p(7, 60, 4), availability: 'FREEAGENT', percentOwned: 1 },
        { ...p(8, 200, 4), availability: 'WAIVERS', percentOwned: 1 },
      ],
    },
  };
}
test('two-for-one plans enforce a drop and optionally fill the open spot with a free agent', () => {
  const l = league();
  const plan = planTrade(
    l,
    l.teams[0].players,
    l.teams[1].players,
    [2, 3],
    [5],
    { includePickup: true },
  );
  assert.deepEqual(
    plan.partner.drops?.map((p) => p.id),
    [4, 6],
  );
  assert.equal(plan.partner.pickup?.id, 7);
  assert.equal(plan.partner.roster.length, 3);
  assert.equal(plan.mine.openSpots, 1);
  // A bench pickup with no starting gain is not required.
  assert.equal(plan.mine.pickup, undefined);
  const reverse = planTrade(
    l,
    l.teams[0].players,
    l.teams[1].players,
    [1],
    [4, 5],
    { includePickup: true },
  );
  assert.equal(reverse.mine.drop?.id, 3);
  assert.equal(reverse.partner.pickup?.id, 7);
  assert.equal(reverse.partner.roster.length, 3);
  assert.equal(reverse.partner.openSpots, 0);
  assert.equal(l.teams[0].players.length, 3);
  assert.ok(!reverse.partner.roster.some((p) => p.id === 8));
});
test('unequal finder searches both directions and includes completed roster plans in mutual gains', async () => {
  const l = league();
  const result = await findTrades(l, 1, {
    maxPlayers: 2,
    unequal: true,
    includePickup: true,
    minimumGain: 1,
    ranking: 'mine',
  });
  assert.equal(result.checked, 18);
  assert.ok(result.candidates.length);
  assert.ok(
    result.candidates.some(
      (t) => t.send.length === 2 && t.receive.length === 1,
    ),
  );
  for (const t of result.candidates) {
    assert.ok(t.mine.gain > 0 && t.partner.gain > 0);
    assert.ok(t.plan.mine.roster.length <= l.teams[0].players.length);
    assert.ok(t.plan.partner.roster.length <= l.teams[1].players.length);
    assert.ok(t.mine.after.complete && t.partner.after.complete);
    assert.ok(t.plan.mine.drop || t.plan.partner.drop);
  }
});

test('imported empty roster spots avoid unnecessary drops in unequal trades', () => {
  const l = league();
  l.teams[1].rosterCapacity = 4;
  const plan = planTrade(
    l,
    l.teams[0].players,
    l.teams[1].players,
    [2, 3],
    [5],
  );
  assert.equal(plan.partner.drop, undefined);
  assert.equal(plan.partner.roster.length, 4);
  assert.equal(plan.partner.capacitySource, 'league');
  assert.equal(plan.mine.capacitySource, 'snapshot');
});

test('limited and Pareto results retain independently evaluated pickup-free gains', async () => {
  const l = league();
  for (const paretoOnly of [false, true]) {
    const options = {
      maxPlayers: 2 as const,
      allSizes: true,
      includePickup: true,
      minimumGain: 0,
      ranking: 'mine' as const,
      paretoOnly,
    };
    const exhaustive = await findTrades(l, 1, { ...options, limit: 100 });
    const limited = await findTrades(l, 1, { ...options, limit: 1 });
    assert.ok(exhaustive.matched > 1);
    assert.equal(limited.matched, exhaustive.matched);
    assert.deepEqual(limited.candidates, exhaustive.candidates.slice(0, 1));
    for (const candidate of exhaustive.candidates) {
      const noPickup = planTrade(
        l,
        l.teams[0].players,
        l.teams[1].players,
        candidate.send.map((p) => p.id),
        candidate.receive.map((p) => p.id),
        { includePickup: false },
      );
      assert.deepEqual(candidate.tradeOnly, {
        mine:
          optimalLineup(noPickup.mine.roster, l.slots).total -
          (candidate.mine.before.upperTotal ?? candidate.mine.before.total),
        partner:
          optimalLineup(noPickup.partner.roster, l.slots).total -
          (candidate.partner.before.upperTotal ??
            candidate.partner.before.total),
      });
    }
  }
});

test('finder skips packages without a valid drop instead of failing the entire search', async () => {
  const l = league();
  l.slots = [{ id: 2, label: 'RB', count: 1 }];
  l.teams[0].players = [p(1, 90, 2), p(2, 85, 2)];
  l.teams[1].players = [p(3, 100, 2)];
  const result = await findTrades(l, 1, {
    maxPlayers: 2,
    unequal: true,
    minimumGain: 0,
    ranking: 'mine',
  });
  assert.equal(result.checked, 1);
  assert.equal(result.unplannable, 1);
  assert.equal(result.matched, 0);
});
