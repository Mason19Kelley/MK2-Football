import { League, Player, Team } from './types';
import { applyTrade, optimalLineup } from './trades';
import { horizonWeeks, playerWeek, TradeHorizon } from './weekly-trades';

export type RosterEvaluation = ReturnType<typeof optimalLineup> & {
  upperTotal?: number;
  usedPlayerIds?: number[];
};
export type RosterMove = {
  roster: Player[];
  drop?: Player;
  drops?: Player[];
  pickup?: Player;
  openSpots: number;
  capacitySource: 'league' | 'snapshot';
};
export type TradePlan = { mine: RosterMove; partner: RosterMove };
export class NonImprovingTradeError extends Error {
  constructor() {
    super('No mutually improving roster plan.');
  }
}
export type MoveOptions = {
  includePickup?: boolean;
  evaluate?: (players: Player[]) => RosterEvaluation;
  evaluatePartner?: (players: Player[]) => RosterEvaluation;
  pickupCandidates?: Player[];
  signal?: AbortSignal;
  preserveVariants?: boolean;
  pruneUnusedDrops?: boolean;
};

export function compareRosterMoves(
  a: RosterMove,
  b: RosterMove,
  evaluate: (players: Player[]) => RosterEvaluation,
  upper = false,
) {
  const av = evaluate(a.roster),
    bv = evaluate(b.roster);
  return (
    Number(bv.complete && bv.missing === 0) -
      Number(av.complete && av.missing === 0) ||
    (upper ? (bv.upperTotal ?? bv.total) : bv.total) -
      (upper ? (av.upperTotal ?? av.total) : av.total) ||
    Number(Boolean(a.pickup)) - Number(Boolean(b.pickup)) ||
    (a.drops ?? []).reduce((s, p) => s + (p.ros ?? 0), 0) -
      (b.drops ?? []).reduce((s, p) => s + (p.ros ?? 0), 0) ||
    (a.pickup?.id ?? a.drop?.id ?? 0) - (b.pickup?.id ?? b.drop?.id ?? 0)
  );
}

// Enumerate at most one immediate acquisition, plus required capacity drops.
// Incoming players are protected. Imported locks/limits apply when present.
export function rosterMoveCandidates(
  league: League,
  team: Team,
  roster: Player[],
  incoming: number[] = [],
  options: MoveOptions = {},
): RosterMove[] {
  const count = (players: Player[]) =>
    players.filter((p) => p.slotId !== 21).length;
  const capacity = team.rosterCapacity ?? count(team.players);
  const excess = count(roster) - capacity;
  if (excess > 1)
    throw new Error('Choose trades with at most one extra player per team.');
  const rostered = new Set(
    league.teams.flatMap((t) => t.players.map((p) => p.id)),
  );
  const available =
    options.pickupCandidates ?? league.waiverWire?.players ?? [];
  const droppable = roster.filter(
    (p) => p.slotId !== 21 && !incoming.includes(p.id) && !p.transactionLocked,
  );
  const legal = (players: Player[]) =>
    count(players) <= capacity &&
    Object.entries(league.positionLimits ?? {}).every(
      ([position, limit]) =>
        players.filter((p) => p.slotId !== 21 && p.position === position)
          .length <= limit!,
    );
  const variants: RosterMove[] = [];
  const evaluate: (players: Player[]) => RosterEvaluation =
    options.evaluate ??
    ((players: Player[]) => optimalLineup(players, league.slots));
  function add(pickup?: Player) {
    options.signal?.throwIfAborted();
    const added = pickup ? [...roster, pickup] : roster;
    const positionExcess =
      pickup && legal(roster)
        ? Object.entries(league.positionLimits ?? {}).reduce(
            (sum, [position, limit]) =>
              sum +
              Math.max(
                0,
                added.filter((p) => p.slotId !== 21 && p.position === position)
                  .length - limit!,
              ),
            0,
          )
        : 0;
    const required = Math.max(
      0,
      excess + Number(Boolean(pickup)),
      positionExcess,
    );
    const drops: Player[][] =
      required === 0
        ? [[]]
        : required === 1
          ? droppable.map((p) => [p])
          : droppable.flatMap((p, i) =>
              droppable.slice(i + 1).map((q) => [p, q]),
            );
    let retainedDrops = drops;
    if (required > 0 && options.pruneUnusedDrops && !options.preserveVariants) {
      const unrestricted = pickup
        ? [...roster, { ...pickup, slotId: 20, slot: 'BN' }]
        : roster;
      const value = evaluate(unrestricted);
      if (value.complete && value.missing === 0 && value.usedPlayerIds) {
        const used = new Set(value.usedPlayerIds);
        const equivalent = drops.filter(
          (removed) =>
            removed.every((p) => !used.has(p.id)) &&
            legal(
              unrestricted.filter((p) => !removed.some((q) => q.id === p.id)),
            ),
        );
        // Removing players unused in every evaluated week attains the full
        // roster's upper bound. Keep the strongest depth on exact ties.
        if (equivalent.length) {
          const depth = (removed: Player[]) =>
            removed.reduce((sum, p) => sum + (p.ros ?? 0), 0);
          const best = equivalent.sort((a, b) => depth(a) - depth(b))[0];
          retainedDrops = [
            best,
            ...drops.filter(
              (removed) =>
                removed !== best &&
                (depth(removed) < depth(best) ||
                  (!pickup &&
                    depth(removed) === depth(best) &&
                    removed[0].id < best[0].id)),
            ),
          ];
        }
      }
    }
    for (const removed of retainedDrops) {
      const next = roster.filter((p) => !removed.some((q) => q.id === p.id));
      if (pickup) next.push({ ...pickup, slotId: 20, slot: 'BN' });
      if (legal(next))
        variants.push({
          roster: next,
          drop: removed[0],
          drops: removed,
          pickup,
          openSpots: capacity - count(next),
          capacitySource:
            team.rosterCapacity === undefined ? 'snapshot' : 'league',
        });
    }
  }
  add();
  if (options.includePickup && team.acquisitionsRemaining !== 0) {
    const seen = new Set<number>();
    for (const p of available) {
      if (
        seen.has(p.id) ||
        rostered.has(p.id) ||
        roster.some((q) => q.id === p.id) ||
        p.slotId === 21 ||
        p.transactionLocked
      )
        continue;
      if (
        !league.waiverWire?.players.some(
          (q) => q.id === p.id && q.availability === 'FREEAGENT',
        )
      )
        continue;
      seen.add(p.id);
      add(p);
    }
  }
  if (!variants.length)
    throw new Error(
      'No eligible player can be dropped to make room or meet roster limits.',
    );
  if (options.preserveVariants) return variants;
  // A drop variant with the same acquisition can be discarded after exact evaluation.
  // Keep the upper-bound optimum separately when bounded forecasts are in use.
  const groups = new Map<number, RosterMove[]>();
  for (const move of variants) {
    const key = move.pickup?.id ?? 0;
    const previous = groups.get(key) ?? [];
    const pool = [...previous, move];
    const lower = [...pool].sort((a, b) =>
      compareRosterMoves(a, b, evaluate),
    )[0];
    const upper = [...pool].sort((a, b) =>
      compareRosterMoves(a, b, evaluate, true),
    )[0];
    groups.set(key, lower === upper ? [lower] : [lower, upper]);
  }
  return [...groups.values()].flat();
}

export function bestNoTradeMove(
  league: League,
  team: Team,
  options: MoveOptions = {},
) {
  const evaluate: (players: Player[]) => RosterEvaluation =
    options.evaluate ?? ((players) => optimalLineup(players, league.slots));
  const moves = rosterMoveCandidates(league, team, team.players, [], options);
  const move = [...moves].sort((a, b) => compareRosterMoves(a, b, evaluate))[0];
  const upper = Math.max(
    ...moves.map(
      (m) => evaluate(m.roster).upperTotal ?? evaluate(m.roster).total,
    ),
  );
  return {
    move,
    evaluation: {
      ...evaluate(move.roster),
      // Dropping an unbounded unknown cannot prove that the no-trade optimum
      // was weak. Require bounds until the original lineup is evaluable too.
      missing: Math.max(
        evaluate(move.roster).missing,
        evaluate(team.players).missing,
      ),
      upperTotal: upper,
    },
  };
}

export function planTrade(
  league: League,
  mine: Player[],
  partner: Player[],
  send: number[],
  receive: number[],
  options: MoveOptions & {
    comparePlans?: (a: TradePlan, b: TradePlan) => number;
    // Use only for independent point gains ranked monotonically after both
    // teams pass their gain thresholds. Scenario/outcome rankings retain all plans.
    independentPoints?: {
      mine: (value: RosterEvaluation) => boolean;
      partner: (value: RosterEvaluation) => boolean;
    };
  } = {},
): TradePlan {
  if (league.tradesLocked)
    throw new Error('Trades are locked for this league.');
  if (
    [
      ...mine.filter((p) => send.includes(p.id)),
      ...partner.filter((p) => receive.includes(p.id)),
    ].some((p) => p.transactionLocked)
  )
    throw new Error('A selected player is transaction locked.');
  const evaluate =
    options.evaluate ?? ((players) => optimalLineup(players, league.slots));
  const swapped = applyTrade(mine, partner, send, receive);
  const team = (players: Player[]) =>
    league.teams.find((t) => t.players === players) ?? {
      ...league.teams[0],
      players,
      rosterCapacity: undefined,
    };
  let myMoves = rosterMoveCandidates(
    league,
    team(mine),
    swapped.mine,
    receive,
    options,
  );
  const evaluatePartner = options.evaluatePartner ?? evaluate;
  let theirMoves = rosterMoveCandidates(
    league,
    team(partner),
    swapped.theirs,
    send,
    { ...options, evaluate: evaluatePartner },
  );
  // Preserve the distinction between an illegal joint transaction and a legal
  // transaction that cannot improve both teams, including forced pickups.
  const firstPickup = myMoves[0].pickup?.id;
  if (
    firstPickup !== undefined &&
    myMoves.every((m) => m.pickup?.id === firstPickup) &&
    theirMoves.every((m) => m.pickup?.id === firstPickup)
  )
    throw new Error(
      'No eligible player can be dropped to produce a joint roster plan.',
    );
  if (options.independentPoints) {
    const shortlist = (
      moves: RosterMove[],
      score: (players: Player[]) => RosterEvaluation,
      accepts: (value: RosterEvaluation) => boolean,
    ) => {
      const bestByPickup = new Map<number | undefined, RosterMove>();
      for (const move of moves) {
        if (!accepts(score(move.roster))) continue;
        const key = move.pickup?.id;
        const previous = bestByPickup.get(key);
        if (!previous || compareRosterMoves(move, previous, score) < 0)
          bestByPickup.set(key, move);
      }
      // Only one acquisition can conflict. The best move and the best move
      // with a different pickup suffice for a monotone two-team point ranking.
      const selected = new Set(
        [...bestByPickup.values()]
          .sort((a, b) => compareRosterMoves(a, b, score))
          .slice(0, 2),
      );
      // Keep enumeration order for exact comparator ties.
      return moves.filter((m) => selected.has(m));
    };
    myMoves = shortlist(myMoves, evaluate, options.independentPoints.mine);
    theirMoves = shortlist(
      theirMoves,
      evaluatePartner,
      options.independentPoints.partner,
    );
    if (!myMoves.length || !theirMoves.length)
      throw new NonImprovingTradeError();
  }
  const compare =
    options.comparePlans ??
    ((a, b) => {
      const valid = (p: TradePlan) =>
        [evaluate(p.mine.roster), evaluatePartner(p.partner.roster)].every(
          (v) => v.complete && v.missing === 0,
        );
      return (
        Number(valid(b)) - Number(valid(a)) ||
        evaluate(b.mine.roster).total +
          evaluatePartner(b.partner.roster).total -
          evaluate(a.mine.roster).total -
          evaluatePartner(a.partner.roster).total ||
        compareRosterMoves(a.mine, b.mine, evaluate) ||
        compareRosterMoves(a.partner, b.partner, evaluatePartner)
      );
    });
  let best: TradePlan | undefined;
  for (const myMove of myMoves)
    for (const theirMove of theirMoves) {
      options.signal?.throwIfAborted();
      if (myMove.pickup && myMove.pickup.id === theirMove.pickup?.id) continue;
      const plan = { mine: myMove, partner: theirMove };
      if (!best || compare(plan, best) < 0) best = plan;
    }
  if (!best && options.independentPoints) throw new NonImprovingTradeError();
  if (!best)
    throw new Error(
      'No eligible player can be dropped to produce a joint roster plan.',
    );
  return best;
}

// Keep two dominating peers: the other team may acquire the strongest one.
// Bounded or stochastic forecasts disable this deterministic pruning.
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
      player.transactionLocked ||
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
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const dominates = (a: Entry, b: Entry) =>
    a.scores.every(
      (n, i) => n >= b.scores[i] && (a.available[i] || !b.available[i]),
    ) &&
    (a.scores.some((n, i) => n > b.scores[i]) || a.player.id < b.player.id);
  return [...groups.values()]
    .flatMap((group) =>
      group.filter((entry) => {
        let dominators = 0;
        for (const peer of group) {
          if (dominates(peer, entry) && ++dominators === 2) return false;
        }
        return true;
      }),
    )
    .map((e) => e.player);
}
