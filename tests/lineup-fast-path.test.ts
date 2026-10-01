import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { Player } from '../lib/types';
import { optimalLineup } from '../lib/trades';

test('ordinary position and FLEX lineups match exhaustive assignments, including ties, vacancies and negative points', () => {
  let seed = 29;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const slots = [
    { id: 2, label: 'RB', count: 2 },
    { id: 4, label: 'WR', count: 1 },
    { id: 23, label: 'FLEX', count: 1 },
  ];
  const expanded = [2, 2, 4, 23];
  for (let trial = 0; trial < 150; trial++) {
    const roster: Player[] = Array.from({ length: 7 }, (_, id) => {
      const position = random() < 0.5 ? 'RB' : 'WR';
      const score = Math.floor(random() * 12) - 5;
      return {
        ...demoLeague.teams[0].players[0],
        id,
        position,
        slotId: random() < 0.15 ? 21 : 20,
        eligibleSlots: random() < 0.1 ? [] : [position === 'RB' ? 2 : 4, 23],
        ros: random() < 0.1 ? null : score,
        weekly: score,
      };
    });
    for (const metric of ['ros', 'weekly'] as const) {
      let bestFilled = -1,
        bestTotal = -Infinity;
      const visit = (slot: number, used: Set<number>, total: number) => {
        if (slot === expanded.length) {
          if (
            used.size > bestFilled ||
            (used.size === bestFilled && total > bestTotal)
          ) {
            bestFilled = used.size;
            bestTotal = total;
          }
          return;
        }
        visit(slot + 1, used, total);
        for (const p of roster) {
          if (
            used.has(p.id) ||
            p.slotId === 21 ||
            p[metric] === null ||
            !p.eligibleSlots.includes(expanded[slot])
          )
            continue;
          used.add(p.id);
          visit(slot + 1, used, total + p[metric]!);
          used.delete(p.id);
        }
      };
      visit(0, new Set(), 0);
      const actual = optimalLineup(roster, slots, metric);
      assert.equal(actual.filled, bestFilled);
      assert.equal(actual.total, bestTotal);
      assert.equal(actual.complete, bestFilled === expanded.length);
      assert.equal(
        new Set(actual.players.map((p) => p.id)).size,
        actual.filled,
      );
      assert.equal(
        actual.missing,
        roster.filter((p) => p[metric] === null).length,
      );
    }
  }
});

test('equal forecasts retain the existing assignment order', () => {
  const roster = [3, 1, 2].map((id) => ({
    ...demoLeague.teams[0].players[0],
    id,
    position: 'RB' as const,
    slotId: 20,
    eligibleSlots: [2, 23],
    ros: 10,
  }));
  assert.deepEqual(
    optimalLineup(roster, [
      { id: 2, label: 'RB', count: 1 },
      { id: 23, label: 'FLEX', count: 1 },
    ]).players.map((p) => p.id),
    [3, 1],
  );
});
