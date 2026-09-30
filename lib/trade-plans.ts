import { League, Player } from './types';
import { applyTrade, optimalLineup } from './trades';
import { horizonWeeks, playerWeek, TradeHorizon } from './weekly-trades';

export type RosterEvaluation = ReturnType<typeof optimalLineup>;
export type RosterMove = {
  roster: Player[];
  drop?: Player;
  pickup?: Player;
  openSpots: number;
  capacitySource: 'league' | 'snapshot';
};
export type TradePlan = { mine: RosterMove; partner: RosterMove };

// Use imported non-IR capacity, or the current roster count as a conservative fallback.
// Newly dropped players are not available for an immediate pickup by the other side.
export function planTrade(
  league: League,
  mine: Player[],
  partner: Player[],
  send: number[],
  receive: number[],
  options: {
    includePickup?: boolean;
    evaluate?: (players: Player[]) => RosterEvaluation;
    pickupCandidates?: Player[];
  } = {},
): TradePlan {
  const evaluate =
    options.evaluate ?? ((players) => optimalLineup(players, league.slots));
  const swapped = applyTrade(mine, partner, send, receive);
  const rostered = new Set(
    league.teams.flatMap((t) => t.players.map((p) => p.id)),
  );
  const available =
    options.pickupCandidates ??
    (league.waiverWire?.players ?? []).filter(
      (p) =>
        p.availability === 'FREEAGENT' &&
        !rostered.has(p.id) &&
        p.slotId !== 21,
    );
  const count = (players: Player[]) =>
    players.filter((p) => p.slotId !== 21).length;
  const choose = (
    original: Player[],
    roster: Player[],
    incoming: number[],
  ): RosterMove => {
    const importedCapacity = league.teams.find(
      (t) => t.players === original,
    )?.rosterCapacity;
    const capacity = importedCapacity ?? count(original);
    const capacitySource =
      importedCapacity === undefined
        ? ('snapshot' as const)
        : ('league' as const);
    const delta = count(roster) - count(original);
    const excess = count(roster) - capacity;
    // Finder supports at most two players on either side. Manual larger swaps
    // remain visible, but are not presented as actionable without a complete plan.
    if (excess > 1)
      throw new Error('Choose trades with at most one extra player per team.');
    let variants: RosterMove[] = [
      { roster, openSpots: Math.max(0, -excess), capacitySource },
    ];
    if (excess === 1) {
      variants = roster
        .filter((p) => p.slotId !== 21 && !incoming.includes(p.id))
        .map((drop) => ({
          roster: roster.filter((p) => p.id !== drop.id),
          drop,
          openSpots: 0,
          capacitySource,
        }));
      if (!variants.length)
        throw new Error('No eligible player can be dropped to make room.');
    } else if (delta === -1 && excess < 0 && options.includePickup) {
      variants.push(
        ...available.map((pickup) => ({
          roster: [...roster, { ...pickup, slotId: 20, slot: 'BN' }],
          pickup,
          openSpots: Math.max(0, -excess - 1),
          capacitySource,
        })),
      );
    }
    const scored = variants.map((move) => ({
      move,
      value: evaluate(move.roster),
    }));
    scored.sort(
      (a, b) =>
        Number(b.value.complete && b.value.missing === 0) -
          Number(a.value.complete && a.value.missing === 0) ||
        b.value.total - a.value.total ||
        // Preserve stronger depth for tied starting totals; don't add a player
        // solely to fill an empty bench spot when it has no lineup benefit.
        (a.move.pickup ? 1 : 0) - (b.move.pickup ? 1 : 0) ||
        (a.move.drop?.ros ?? 0) - (b.move.drop?.ros ?? 0) ||
        (a.move.drop?.id ?? a.move.pickup?.id ?? 0) -
          (b.move.drop?.id ?? b.move.pickup?.id ?? 0),
    );
    return scored[0].move;
  };
  return {
    mine: choose(mine, swapped.mine, receive),
    partner: choose(partner, swapped.theirs, send),
  };
}

// Retain the Pareto frontier for each starting-slot eligibility group. A pickup
// worse in every selected week can never improve a lineup more than its peer.
// This avoids evaluating thousands of dominated free agents for every package.
export function tradePickupCandidates(
  league: League,
  horizon: TradeHorizon,
): Player[] {
  const rostered = new Set(
    league.teams.flatMap((t) => t.players.map((p) => p.id)),
  );
  const startingSlots = new Set(league.slots.map((s) => s.id));
  const weeks = horizonWeeks(league, horizon);
  type Entry = { player: Player; scores: number[]; available: boolean[] };
  const groups = new Map<string, Entry[]>();
  for (const player of league.waiverWire?.players ?? []) {
    if (
      player.availability !== 'FREEAGENT' ||
      player.slotId === 21 ||
      rostered.has(player.id)
    )
      continue;
    const key = [
      ...new Set(player.eligibleSlots.filter((id) => startingSlots.has(id))),
    ]
      .sort((a, b) => a - b)
      .join(',');
    if (!key) continue;
    const values = weeks.map((week) => playerWeek(player, league, week));
    const points =
      horizon === 'ros' ? [player.ros] : values.map((v) => v.points);
    if (points.some((n) => n === null)) continue;
    const entry: Entry = {
      player,
      scores: points as number[],
      available: horizon === 'ros' ? [true] : values.map((v) => !v.unavailable),
    };
    const dominates = (a: Entry, b: Entry) =>
      a.scores.every(
        (n, i) => n >= b.scores[i] && (a.available[i] || !b.available[i]),
      );
    const previous = groups.get(key) ?? [];
    if (previous.some((p) => dominates(p, entry))) continue;
    groups.set(key, [...previous.filter((p) => !dominates(entry, p)), entry]);
  }
  return [...groups.values()].flat().map((entry) => entry.player);
}
