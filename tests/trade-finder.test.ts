import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { League, Player } from '../lib/types';
import { findTrades, rankTrades } from '../lib/trade-finder';
import { applyTrade, optimalLineup } from '../lib/trades';

function player(id: number, ros: number, slot: number): Player {
  return {
    ...demoLeague.teams[0].players[0],
    id,
    name: `Player ${id}`,
    ros,
    slotId: 20,
    eligibleSlots: [slot],
  };
}
function fixture(): League {
  return {
    ...demoLeague,
    waiverWire: undefined,
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      {
        ...demoLeague.teams[0],
        id: 1,
        players: [player(1, 100, 2), player(2, 90, 2), player(3, 40, 4)],
      },
      {
        ...demoLeague.teams[1],
        id: 2,
        players: [player(4, 40, 2), player(5, 100, 4), player(6, 90, 4)],
      },
    ],
  };
}
const options = {
  maxPlayers: 1 as const,
  minimumGain: 1,
  ranking: 'mine' as const,
};
test('finder matches exhaustive swaps and counts starter gains rather than roster totals', async () => {
  const league = fixture();
  const result = await findTrades(league, 1, options);
  const expected: string[] = [];
  for (const send of league.teams[0].players)
    for (const receive of league.teams[1].players) {
      const trade = applyTrade(
        league.teams[0].players,
        league.teams[1].players,
        [send.id],
        [receive.id],
      );
      if (
        optimalLineup(trade.mine, league.slots).total > 140 &&
        optimalLineup(trade.theirs, league.slots).total > 140
      )
        expected.push(`${send.id}:${receive.id}`);
    }
  assert.deepEqual(
    result.candidates.map((t) => `${t.send[0].id}:${t.receive[0].id}`).sort(),
    expected.sort(),
  );
  assert.equal(result.checked, 9);
  const depthSwap = result.candidates.find(
    (t) => t.send[0].id === 2 && t.receive[0].id === 6,
  )!;
  assert.equal(depthSwap.mine.gain, 50);
  assert.equal(depthSwap.partner.gain, 50);
  assert.ok(depthSwap.mine.before.players.every((p) => p.id !== 2));
  assert.ok(depthSwap.mine.after.players.some((p) => p.id === 6));
});
test('two-for-two search is exhaustive, unique, ranked, limited, and preserves complete lineups', async () => {
  const league = fixture();
  const result = await findTrades(league, 1, {
    ...options,
    maxPlayers: 2,
    limit: 2,
    ranking: 'balanced',
  });
  assert.equal(result.checked, 18);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.matched > 2);
  assert.ok(
    rankTrades(result.candidates[0], result.candidates[1], 'balanced') <= 0,
  );
  const all = await findTrades(league, 1, {
    ...options,
    maxPlayers: 2,
    limit: 100,
  });
  assert.ok(all.candidates.some((t) => t.send.length === 2));
  assert.equal(
    new Set(
      all.candidates.map(
        (t) => `${t.send.map((p) => p.id)}:${t.receive.map((p) => p.id)}`,
      ),
    ).size,
    all.matched,
  );
  for (const t of all.candidates) {
    assert.ok(t.mine.after.complete && t.partner.after.complete);
    assert.equal(t.send.length, t.receive.length);
    assert.ok(t.mine.gain >= 1 && t.partner.gain >= 1);
  }
});
test('minimum gain, team scope, missing coverage, IR and cancellation are respected', async () => {
  const league = fixture();
  assert.equal(
    (await findTrades(league, 1, { ...options, minimumGain: 100 })).matched,
    0,
  );
  assert.equal(
    (await findTrades(league, 1, { ...options, partnerId: 1 })).checked,
    0,
  );
  league.teams[1].players[0].ros = null;
  const skipped = await findTrades(league, 1, options);
  assert.deepEqual(skipped.skipped, [league.teams[1].name]);
  assert.equal(skipped.checked, 0);
  await assert.rejects(findTrades(league, 2, options), /ROS projections/);
  const ir = fixture();
  ir.teams[0].players[1].slotId = 21;
  assert.ok(
    (await findTrades(ir, 1, options)).candidates.every((t) =>
      t.send.every((p) => p.id !== 2),
    ),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    findTrades(fixture(), 1, { ...options, signal: controller.signal }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    findTrades(fixture(), 1, { ...options, minimumGain: NaN }),
    /nonnegative/,
  );
});

test('kickers never enter either side of one-for-one or two-for-two trades but still fill lineup slots', async () => {
  const league = fixture();
  league.slots.push({ id: 17, label: 'K', count: 1 });
  for (const [i, team] of league.teams.entries()) {
    team.players.push({ ...player(100 + i, 80 + i * 20, 17), position: 'K' });
  }
  const result = await findTrades(league, 1, {
    ...options,
    maxPlayers: 2,
    limit: 100,
  });
  assert.equal(result.checked, 18);
  assert.ok(result.candidates.length > 0);
  for (const t of result.candidates) {
    assert.ok([...t.send, ...t.receive].every((p) => p.position !== 'K'));
    assert.ok(t.mine.before.players.some((p) => p.position === 'K'));
    assert.ok(t.mine.after.players.some((p) => p.id === 100));
    assert.ok(t.partner.after.players.some((p) => p.id === 101));
  }
});

test('D/ST never enters trade offers while its points remain in both team lineups', async () => {
  const league = fixture();
  league.slots.push({ id: 16, label: 'D/ST', count: 1 });
  for (const [i, team] of league.teams.entries()) {
    team.players.push({
      ...player(200 + i, 30 + i * 10, 16),
      position: 'D/ST',
    });
  }
  const result = await findTrades(league, 1, {
    ...options,
    maxPlayers: 2,
    limit: 100,
  });
  assert.equal(result.checked, 18);
  assert.ok(result.candidates.length > 0);
  for (const t of result.candidates) {
    assert.ok([...t.send, ...t.receive].every((p) => p.position !== 'D/ST'));
    assert.equal(t.mine.before.total, 170);
    assert.equal(t.partner.before.total, 180);
    assert.ok(t.mine.after.players.some((p) => p.id === 200));
    assert.ok(t.partner.after.players.some((p) => p.id === 201));
  }
});
