import { League, Player } from './types';
import {
  evaluateRoster,
  TradeEvaluation,
  TradeHorizon,
  playerWeek,
} from './weekly-trades';
import { planTrade, TradePlan, tradePickupCandidates } from './trade-plans';

type Lineup = TradeEvaluation;
export type TradeCandidate = {
  partnerId: number;
  send: Player[];
  receive: Player[];
  plan: TradePlan;
  horizon: TradeHorizon;
  tradeOnly: { mine: number; partner: number };
  mine: { before: Lineup; after: Lineup; gain: number };
  partner: { before: Lineup; after: Lineup; gain: number };
};
export type TradeRanking = 'mine' | 'balanced' | 'combined';
export function rankTrades(
  a: TradeCandidate,
  b: TradeCandidate,
  ranking: TradeRanking,
) {
  const score = (t: TradeCandidate) =>
    ranking === 'mine'
      ? t.mine.gain
      : ranking === 'balanced'
        ? Math.min(t.mine.gain, t.partner.gain)
        : t.mine.gain + t.partner.gain;
  return (
    score(b) - score(a) ||
    b.mine.gain - a.mine.gain ||
    a.partnerId - b.partnerId
  );
}

// Keep objective policy separate from candidate generation, so a future
// acceptance model can score these same two independently optimized impacts.
export function improvesBoth(t: TradeCandidate, minimumGain: number) {
  return (
    t.mine.gain > 0.05 &&
    t.partner.gain > 0.05 &&
    t.mine.gain + 1e-8 >= minimumGain &&
    t.partner.gain + 1e-8 >= minimumGain
  );
}
function packages(players: Player[], size: number): Player[][] {
  if (size === 1) return players.map((p) => [p]);
  return players.flatMap((p, i) => players.slice(i + 1).map((q) => [p, q]));
}
function projected(lineup: Lineup) {
  return lineup.complete && lineup.missing === 0;
}
export async function findTrades(
  league: League,
  myTeamId: number,
  options: {
    partnerId?: number;
    maxPlayers: 1 | 2;
    unequal?: boolean;
    includePickup?: boolean;
    horizon?: TradeHorizon;
    minimumGain: number;
    ranking: TradeRanking;
    limit?: number;
    signal?: AbortSignal;
    onProgress?: (checked: number) => void;
  },
) {
  const mine = league.teams.find((t) => t.id === myTeamId);
  if (!mine) throw new Error('Choose a team in this league.');
  if (!Number.isFinite(options.minimumGain) || options.minimumGain < 0)
    throw new Error('Minimum gain must be a nonnegative number.');
  if (![1, 2].includes(options.maxPlayers))
    throw new Error('Unsupported trade size.');
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Invalid result limit.');
  const horizon = options.horizon ?? 'ros';
  if (!['ros', 'remaining', 'next3', 'playoffs'].includes(horizon))
    throw new Error('Unsupported trade horizon.');
  const cache = new Map<string, TradeEvaluation>();
  const projectionCache = new Map<
    number,
    Map<number, ReturnType<typeof playerWeek>>
  >();
  const evaluate = (roster: Player[]) => {
    const key = roster
      .map((p) => p.id)
      .sort((a, b) => a - b)
      .join(',');
    const previous = cache.get(key);
    if (previous) return previous;
    const value = evaluateRoster(league, roster, horizon, projectionCache);
    // Bound memory for large leagues; cached roster values are only an optimization.
    if (cache.size >= 10000) cache.clear();
    cache.set(key, value);
    return value;
  };
  const pickupCandidates = options.includePickup
    ? tradePickupCandidates(league, horizon)
    : [];
  const before = evaluate(mine.players);
  if (!projected(before))
    throw new Error(
      'Your team needs projections for every eligible player and enough players to fill the starting slots. Check the selected weeks and ROS projections.',
    );
  const candidates: TradeCandidate[] = [],
    skipped: string[] = [];
  let checked = 0,
    matched = 0,
    unplannable = 0;
  let yieldedAt = Date.now();
  const abort = () => options.signal?.throwIfAborted();
  abort();
  for (const partner of league.teams.filter(
    (t) =>
      t.id !== myTeamId &&
      (options.partnerId === undefined || t.id === options.partnerId),
  )) {
    const partnerBefore = evaluate(partner.players);
    if (!projected(partnerBefore)) {
      skipped.push(partner.name);
      continue;
    }
    // Defenses, kickers and unavailable IR players never enter trade packages.
    const eligible = (players: Player[]) =>
      players.filter(
        (p) => p.slotId !== 21 && p.position !== 'K' && p.position !== 'D/ST',
      );
    const sizes = options.unequal
      ? [
          [2, 1],
          [1, 2],
        ]
      : options.maxPlayers === 2
        ? [
            [1, 1],
            [2, 2],
          ]
        : [[1, 1]];
    for (const [sendSize, receiveSize] of sizes) {
      for (const send of packages(eligible(mine.players), sendSize)) {
        for (const receive of packages(
          eligible(partner.players),
          receiveSize,
        )) {
          abort();
          checked++;
          let plan: TradePlan | null = null;
          try {
            plan = planTrade(
              league,
              mine.players,
              partner.players,
              send.map((p) => p.id),
              receive.map((p) => p.id),
              {
                includePickup: options.includePickup,
                evaluate,
                pickupCandidates,
              },
            );
          } catch (err) {
            if (
              !(err instanceof Error) ||
              !/No eligible player can be dropped|at most one extra player/.test(
                err.message,
              )
            )
              throw err;
            unplannable++;
          }
          if (plan) {
            const after = evaluate(plan.mine.roster);
            // Only calculate the other side when our own lineup improves.
            if (
              projected(after) &&
              after.total - before.total > 0.05 &&
              after.total - before.total + 1e-8 >= options.minimumGain
            ) {
              const partnerAfter = evaluate(plan.partner.roster);
              if (projected(partnerAfter)) {
                const candidate: TradeCandidate = {
                  partnerId: partner.id,
                  send,
                  receive,
                  plan,
                  horizon,
                  tradeOnly: {
                    mine:
                      evaluate(
                        plan.mine.roster.filter(
                          (p) => p.id !== plan.mine.pickup?.id,
                        ),
                      ).total - before.total,
                    partner:
                      evaluate(
                        plan.partner.roster.filter(
                          (p) => p.id !== plan.partner.pickup?.id,
                        ),
                      ).total - partnerBefore.total,
                  },
                  mine: { before, after, gain: after.total - before.total },
                  partner: {
                    before: partnerBefore,
                    after: partnerAfter,
                    gain: partnerAfter.total - partnerBefore.total,
                  },
                };
                if (improvesBoth(candidate, options.minimumGain)) {
                  matched++;
                  candidates.push(candidate);
                  candidates.sort((a, b) => rankTrades(a, b, options.ranking));
                  if (candidates.length > limit) candidates.pop();
                }
              }
            }
          }
          // Yield regularly to keep controls and cancellation responsive.
          if (checked % 50 === 0 || Date.now() - yieldedAt >= 25) {
            options.onProgress?.(checked);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            yieldedAt = Date.now();
          }
        }
      }
    }
  }
  abort();
  return { candidates, skipped, checked, matched, unplannable };
}
