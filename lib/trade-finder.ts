import { League, Player } from './types';
import { optimalLineup } from './trades';

type Lineup = ReturnType<typeof optimalLineup>;
export type TradeCandidate = {
  partnerId: number;
  send: Player[];
  receive: Player[];
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
  const before = optimalLineup(mine.players, league.slots);
  if (!projected(before))
    throw new Error(
      'Your team needs ROS projections for every player and enough eligible players to fill every starting slot.',
    );
  const candidates: TradeCandidate[] = [],
    skipped: string[] = [];
  let checked = 0,
    matched = 0;
  const abort = () => options.signal?.throwIfAborted();
  abort();
  for (const partner of league.teams.filter(
    (t) =>
      t.id !== myTeamId &&
      (options.partnerId === undefined || t.id === options.partnerId),
  )) {
    const partnerBefore = optimalLineup(partner.players, league.slots);
    if (!projected(partnerBefore)) {
      skipped.push(partner.name);
      continue;
    }
    // Kickers and unavailable IR players never enter trade packages.
    const eligible = (players: Player[]) =>
      players.filter((p) => p.slotId !== 21 && p.position !== 'K');
    for (let size = 1; size <= options.maxPlayers; size++) {
      for (const send of packages(eligible(mine.players), size)) {
        const remainingMine = mine.players.filter(
          (p) => !send.some((s) => s.id === p.id),
        );
        for (const receive of packages(eligible(partner.players), size)) {
          abort();
          const after = optimalLineup(
            [...remainingMine, ...receive],
            league.slots,
          );
          checked++;
          // Only calculate the other side when our own lineup improves.
          if (
            projected(after) &&
            after.total - before.total > 0.05 &&
            after.total - before.total + 1e-8 >= options.minimumGain
          ) {
            const partnerAfter = optimalLineup(
              [
                ...partner.players.filter(
                  (p) => !receive.some((r) => r.id === p.id),
                ),
                ...send,
              ],
              league.slots,
            );
            if (projected(partnerAfter)) {
              const candidate: TradeCandidate = {
                partnerId: partner.id,
                send,
                receive,
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
          // Yield regularly to keep controls and cancellation responsive.
          if (checked % 50 === 0) {
            options.onProgress?.(checked);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      }
    }
  }
  abort();
  return { candidates, skipped, checked, matched };
}
