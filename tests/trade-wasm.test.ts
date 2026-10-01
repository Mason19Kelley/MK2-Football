import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { demoLeague } from '../lib/demo';
import { League, Player } from '../lib/types';
import { createWasmScorer, supportsWasmScoring } from '../lib/trade-wasm';
import {
  evaluateForecastRoster,
  defaultScenarioSettings,
} from '../lib/trade-evaluation';
import { applyTrade } from '../lib/trades';
import { findTrades } from '../lib/trade-finder';
const options = {
  horizon: 'remaining' as const,
  maxPlayers: 1 as const,
  minimumGain: 1,
  ranking: 'mine' as const,
  waiverBaseline: true,
};
const binary = async () =>
  new Uint8Array(
    await fs.readFile(
      new URL('../public/trade-scorer-v1.wasm', import.meta.url),
    ),
  );
function close(actual: unknown, expected: unknown): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual));
    assert.equal(actual.length, expected.length);
    expected.forEach((value, i) => close(actual[i], value));
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object');
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    for (const key of Object.keys(expected))
      close(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
      );
    return;
  }
  assert.deepEqual(actual, expected);
}
test('runtime WASM preserves full forecast metadata for weekly horizons and traded roster assignments', async () => {
  const league: League = {
    ...demoLeague,
    week: 4,
    finalWeek: 9,
    playoffStartWeek: 7,
    teams: demoLeague.teams.map((t) => ({
      ...t,
      players: t.players.map((p, i) => ({
        ...p,
        weeklyOverrides: i === 1 ? { 5: 0, 6: 7 } : undefined,
        byeWeek: i === 2 ? 5 : p.byeWeek,
        projectionSource: i === 3 ? 'custom' : p.projectionSource,
        slotId: i === 4 ? 21 : p.slotId,
        status: i === 5 ? 'OUT' : p.status,
      })),
    })),
  };
  const scorer = await createWasmScorer(league, options, await binary());
  assert.ok(scorer);
  try {
    const projectionCache = new Map(),
      replacementCache = new Map(),
      specialistCache = new Map();
    const expected = (
      roster: Player[],
      horizon: 'remaining' | 'next3' | 'playoffs',
    ) =>
      evaluateForecastRoster(league, roster, horizon, {
        projectionCache,
        replacementCache,
        specialistCache,
      });
    for (const team of league.teams) expected(team.players, 'remaining');
    const rosters = league.teams.map((t) => t.players);
    const mine = league.teams[0],
      partner = league.teams[1];
    for (const p of mine.players.filter((p) => p.slotId !== 21))
      for (const q of partner.players.filter((p) => p.slotId !== 21)) {
        const swapped = applyTrade(
          mine.players,
          partner.players,
          [p.id],
          [q.id],
        );
        rosters.push(swapped.mine, swapped.theirs);
      }
    for (const roster of rosters)
      for (const horizon of ['remaining', 'next3', 'playoffs'] as const)
        close(scorer.evaluate(roster, horizon), expected(roster, horizon));
  } finally {
    scorer.dispose();
  }
  assert.equal(
    scorer.evaluate(league.teams[0].players, 'remaining'),
    undefined,
  );
});
test('WASM search matches complete TypeScript offers, plans, baselines and gains', async () => {
  const player = (id: number, points: number, slot: number): Player => ({
    ...demoLeague.teams[0].players[0],
    id,
    name: String(id),
    position: slot === 2 ? 'RB' : 'WR',
    slotId: 20,
    eligibleSlots: [slot],
    ros: points * 3,
    weekly: points,
    weeklyProjections: { 1: points, 2: points, 3: points },
    byeWeek: 0,
    status: 'ACTIVE',
  });
  const league: League = {
    ...demoLeague,
    week: 1,
    finalWeek: 3,
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      {
        ...demoLeague.teams[0],
        players: [player(1, 20, 2), player(2, 19, 2), player(3, 5, 4)],
      },
      {
        ...demoLeague.teams[1],
        players: [player(4, 5, 2), player(5, 20, 4), player(6, 19, 4)],
      },
    ],
    waiverWire: undefined,
  };
  const engine = await createWasmScorer(league, options, await binary());
  assert.ok(engine);
  try {
    const expected = await findTrades(league, 1, options);
    assert.ok(expected.candidates.length > 0);
    close(await findTrades(league, 1, options, engine), expected);
    close(
      await findTrades(
        league,
        1,
        { ...options, maxPlayers: 2, unequal: true },
        engine,
      ),
      await findTrades(league, 1, { ...options, maxPlayers: 2, unequal: true }),
    );
  } finally {
    engine.dispose();
  }
});
test('unsupported scoring modes bypass WASM without fetching or instantiating it', async () => {
  for (const alternate of [
    { horizon: 'ros' as const },
    { waiverBaseline: false },
    { scenarios: defaultScenarioSettings },
    { partnerHorizon: 'next3' as const },
  ]) {
    assert.equal(
      supportsWasmScoring(demoLeague, { ...options, ...alternate }),
      false,
    );
    assert.equal(
      await createWasmScorer(
        demoLeague,
        { ...options, ...alternate },
        new Uint8Array([0]),
      ),
      undefined,
    );
  }
  const bounded = {
    ...demoLeague,
    teams: demoLeague.teams.map((t) => ({
      ...t,
      players: t.players.map((p) => ({
        ...p,
        projectionBounds: { ros: { lower: 0, upper: 1 } },
      })),
    })),
  };
  assert.equal(supportsWasmScoring(bounded, options), false);
  const customSlots = {
    ...demoLeague,
    slots: [{ id: 7, label: 'Superflex', count: 1 }],
  };
  assert.equal(supportsWasmScoring(customSlots, options), false);
});
