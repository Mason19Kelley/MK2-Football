import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { League, Player } from '../lib/types';
import {
  TradeCandidate,
  TradeRanking,
  improvesBoth,
  rankTrades,
} from '../lib/trade-finder';
import {
  compareRosterMoves,
  NonImprovingTradeError,
  planTrade,
  TradePlan,
} from '../lib/trade-plans';
import {
  createScenarioCache,
  defaultScenarioSettings,
  evaluateForecastRoster,
} from '../lib/trade-evaluation';

test('point-plan shortlist and drop bounds match exhaustive plans across rankings, ties and unequal trades', () => {
  let seed = 37;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % 13;
  };
  for (let round = 0; round < 32; round++) {
    const player = (id: number, slot: number): Player => ({
      ...demoLeague.teams[0].players[0],
      id,
      name: String(id),
      position: slot === 2 ? 'RB' : 'WR',
      slotId: 20,
      eligibleSlots: [slot],
      ros: random(),
      transactionLocked: id === 5 && round % 3 === 0,
    });
    const league: League = {
      ...demoLeague,
      slots: [
        { id: 2, label: 'RB', count: 1 },
        { id: 4, label: 'WR', count: 1 },
      ],
      positionLimits: { RB: 4, WR: 4 },
      teams: [
        {
          ...demoLeague.teams[0],
          players: [
            player(1, 2),
            player(2, 2),
            player(3, 4),
            player(4, 4),
            player(5, 2),
          ],
        },
        {
          ...demoLeague.teams[1],
          players: [
            player(6, 4),
            player(7, 4),
            player(8, 2),
            player(9, 2),
            player(10, 4),
          ],
        },
      ],
      waiverWire: {
        syncedAt: '',
        truncated: false,
        players: Array.from({ length: 6 }, (_, i) => ({
          ...player(11 + i, i % 2 ? 2 : 4),
          availability: 'FREEAGENT' as const,
          percentOwned: 1,
        })),
      },
    };
    const cache = new WeakMap<
      Player[],
      ReturnType<typeof evaluateForecastRoster>
    >();
    const evaluate = (roster: Player[]) => {
      let value = cache.get(roster);
      if (!value)
        cache.set(
          roster,
          (value = evaluateForecastRoster(league, roster, 'ros')),
        );
      return value;
    };
    const mine = league.teams[0].players,
      partner = league.teams[1].players;
    const send = round % 2 ? [1, 3] : [1],
      receive = round % 3 ? [6] : [6, 8];
    const before = evaluate(mine),
      partnerBefore = evaluate(partner);
    const candidate = (plan: TradePlan): TradeCandidate => {
      const after = evaluate(plan.mine.roster),
        partnerAfter = evaluate(plan.partner.roster);
      return {
        partnerId: 2,
        send: mine.filter((p) => send.includes(p.id)),
        receive: partner.filter((p) => receive.includes(p.id)),
        plan,
        horizon: 'ros',
        tradeOnly: { mine: 0, partner: 0 },
        mine: { before, after, gain: after.total - before.total },
        partner: {
          before: partnerBefore,
          after: partnerAfter,
          gain: partnerAfter.total - partnerBefore.total,
        },
      };
    };
    const valid = (plan: TradePlan) => {
      const value = candidate(plan);
      return (
        value.mine.after.complete &&
        value.mine.after.missing === 0 &&
        value.partner.after.complete &&
        value.partner.after.missing === 0 &&
        improvesBoth(value, 0)
      );
    };
    for (const ranking of [
      'mine',
      'balanced',
      'combined',
      'bargaining',
      'downside',
    ] as TradeRanking[]) {
      let comparisons = 0;
      const comparePlans = (a: TradePlan, b: TradePlan) => {
        comparisons++;
        return (
          Number(valid(b)) - Number(valid(a)) ||
          rankTrades(candidate(a), candidate(b), ranking) ||
          compareRosterMoves(a.mine, b.mine, evaluate) ||
          compareRosterMoves(a.partner, b.partner, evaluate)
        );
      };
      const expected = planTrade(league, mine, partner, send, receive, {
        includePickup: true,
        evaluate,
        comparePlans,
      });
      comparisons = 0;
      const solve = () =>
        planTrade(league, mine, partner, send, receive, {
          includePickup: true,
          evaluate,
          comparePlans,
          pruneUnusedDrops: true,
          independentPoints: {
            mine: (value) =>
              value.complete &&
              value.missing === 0 &&
              value.total - before.total > 0.05,
            partner: (value) =>
              value.complete &&
              value.missing === 0 &&
              value.total - partnerBefore.total > 0.05,
          },
        });
      if (valid(expected))
        assert.deepEqual(solve(), expected, `round ${round}, ${ranking}`);
      else assert.throws(solve, NonImprovingTradeError);
      assert.ok(comparisons <= 3, 'at most four joint plans survive');
    }
  }
});

test('cached scenarios match uncached draws with shared NFL teams, specialist streaming and IR recovery', () => {
  const league: League = {
    ...demoLeague,
    week: 1,
    finalWeek: 4,
    teams: demoLeague.teams.slice(0, 2).map((team) => ({
      ...team,
      players: team.players.map((p, i) => ({
        ...p,
        nflTeam: i % 3 ? 'BUF' : 'FA',
        slotId: i === 1 ? 21 : p.slotId,
        returnWeek: i === 1 ? 2 : undefined,
        availabilityProbability: i === 2 ? 0 : i === 3 ? 1 : undefined,
        roleStdDev: i === 4 ? 0 : undefined,
        scoreStdDev: i === 5 ? 0 : undefined,
        weeklyOverrides: { 2: i % 2 ? 0 : 10, 3: i % 3 ? 7 : -2 },
      })),
    })),
  };
  const scenarios = { ...defaultScenarioSettings, samples: 8 };
  const scenarioCache = createScenarioCache(league, scenarios);
  const pickup = league.waiverWire!.players.find((p) => p.position === 'WR')!;
  for (const roster of [
    league.teams[0].players,
    league.teams[1].players,
    [...league.teams[0].players.slice(1), { ...pickup, slotId: 20 }],
    [...league.teams[0].players.slice(1), { ...pickup, slotId: 20 }],
  ])
    for (const horizon of ['remaining', 'next3'] as const) {
      assert.deepEqual(
        evaluateForecastRoster(league, roster, horizon, {
          scenarios,
          scenarioCache,
        }),
        evaluateForecastRoster(league, roster, horizon, { scenarios }),
      );
    }
});
