import { League, Player, Team } from './types';
import { applyTrade, optimalLineup } from './trades';
import {
  horizonWeeks,
  playerWeek,
  TradeEvaluation,
  TradeHorizon,
} from './weekly-trades';

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
// Variants are generated per acquisition so callers can bound or skip pickups.
function moveSource(
  league: League,
  team: Team,
  roster: Player[],
  incoming: number[],
  options: MoveOptions,
) {
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
  const evaluate: (players: Player[]) => RosterEvaluation =
    options.evaluate ??
    ((players: Player[]) => optimalLineup(players, league.slots));
  function variantsFor(pickup?: Player) {
    options.signal?.throwIfAborted();
    const variants: RosterMove[] = [];
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
    return variants;
  }
  function pickups() {
    const result: Player[] = [];
    if (!options.includePickup || team.acquisitionsRemaining === 0)
      return result;
    const freeAgents = new Set(
      (league.waiverWire?.players ?? [])
        .filter((q) => q.availability === 'FREEAGENT')
        .map((q) => q.id),
    );
    const owned = new Set(roster.map((q) => q.id));
    const seen = new Set<number>();
    for (const p of available) {
      if (
        seen.has(p.id) ||
        rostered.has(p.id) ||
        owned.has(p.id) ||
        p.slotId === 21 ||
        p.transactionLocked ||
        !freeAgents.has(p.id)
      )
        continue;
      seen.add(p.id);
      result.push(p);
    }
    return result;
  }
  return { variantsFor, pickups, evaluate };
}

// A drop variant with the same acquisition can be discarded after exact evaluation.
// Keep the upper-bound optimum separately when bounded forecasts are in use.
// Callers pass the variants of a single acquisition.
function bestVariants(
  variants: RosterMove[],
  evaluate: (players: Player[]) => RosterEvaluation,
) {
  let group: RosterMove[] = [];
  for (const move of variants) {
    const pool = [...group, move];
    const lower = [...pool].sort((a, b) =>
      compareRosterMoves(a, b, evaluate),
    )[0];
    const upper = [...pool].sort((a, b) =>
      compareRosterMoves(a, b, evaluate, true),
    )[0];
    group = lower === upper ? [lower] : [lower, upper];
  }
  return group;
}

export function rosterMoveCandidates(
  league: League,
  team: Team,
  roster: Player[],
  incoming: number[] = [],
  options: MoveOptions = {},
): RosterMove[] {
  const source = moveSource(league, team, roster, incoming, options);
  const groups = [source.variantsFor()];
  for (const p of source.pickups()) groups.push(source.variantsFor(p));
  if (!groups.some((g) => g.length))
    throw new Error(
      'No eligible player can be dropped to make room or meet roster limits.',
    );
  if (options.preserveVariants) return groups.flat();
  return groups.flatMap((g) => bestVariants(g, source.evaluate));
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
    // Acceptance must be monotone in total for complete, fully projected rosters.
    independentPoints?: {
      mine: (value: RosterEvaluation) => boolean;
      partner: (value: RosterEvaluation) => boolean;
      // Optional upper bounds on the total gained by adding one pickup to an
      // evaluated roster. Lets the shortlist skip acquisitions that cannot qualify.
      pickupGain?: {
        mine: PickupGainBound;
        partner: PickupGainBound;
      };
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
  const evaluatePartner = options.evaluatePartner ?? evaluate;
  if (options.independentPoints && !options.preserveVariants) {
    const points = options.independentPoints;
    const mySource = moveSource(
      league,
      team(mine),
      swapped.mine,
      receive,
      options,
    );
    const myBase = mySource.variantsFor();
    const theirSource = myBase.length
      ? moveSource(league, team(partner), swapped.theirs, send, {
          ...options,
          evaluate: evaluatePartner,
        })
      : undefined;
    // With a pickup-free variant on each side, neither side can fail for lack
    // of a legal drop, so lazily shortlisting matches exhaustive enumeration.
    // Otherwise fall through to the exhaustive path and its error handling.
    const theirBase = theirSource?.variantsFor();
    if (theirSource && theirBase?.length) {
      const myMoves = shortlistMoves(
        mySource,
        swapped.mine,
        myBase,
        points.mine,
        points.pickupGain?.mine,
      );
      // Skip the partner's acquisitions when this side cannot qualify.
      if (!myMoves.length) throw new NonImprovingTradeError();
      const theirMoves = shortlistMoves(
        theirSource,
        swapped.theirs,
        theirBase,
        points.partner,
        points.pickupGain?.partner,
      );
      if (!theirMoves.length) throw new NonImprovingTradeError();
      return bestPlan(myMoves, theirMoves, evaluate, evaluatePartner, options);
    }
  }
  let myMoves = rosterMoveCandidates(
    league,
    team(mine),
    swapped.mine,
    receive,
    options,
  );
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
  return bestPlan(myMoves, theirMoves, evaluate, evaluatePartner, options);
}

export type PickupGainBound = (
  current: RosterEvaluation,
) => (pickup: Player) => number;

// Per week, one added player can at most replace the weakest starter or fill
// a vacancy. Valid only for deterministic point lineups without streaming
// replacements or projection bounds; evaluations must include weekly lineups.
export function pickupGainBound(
  league: League,
  period: TradeHorizon,
): PickupGainBound {
  const scores = new Map<number, (number | null)[]>();
  return (current) => {
    const value = current as TradeEvaluation;
    const metric = period === 'ros' ? 'ros' : 'weekly';
    const floors = (period === 'ros' ? [value] : value.weeks).map((lineup) => {
      let floor = Infinity;
      for (const p of lineup.players) floor = Math.min(floor, p[metric] ?? 0);
      return lineup.filled >= lineup.slots ? floor : Math.min(floor, 0);
    });
    return (pickup) => {
      let known = scores.get(pickup.id);
      if (!known) {
        known =
          period === 'ros'
            ? [pickup.ros]
            : horizonWeeks(league, period).map((week) => {
                const value = playerWeek(pickup, league, week);
                return value.unavailable ? null : value.points;
              });
        scores.set(pickup.id, known);
      }
      let gain = 0;
      for (let w = 0; w < known.length; w++)
        if (known[w] !== null) gain += Math.max(0, known[w]! - floors[w]);
      return gain;
    };
  };
}

// Equivalent to evaluating every acquisition, keeping each acquisition's best
// accepted move, then the best two overall in enumeration order. Acquisitions
// whose bounded total cannot pass acceptance or beat two kept moves are skipped.
function shortlistMoves(
  source: ReturnType<typeof moveSource>,
  roster: Player[],
  base: RosterMove[],
  accepts: (value: RosterEvaluation) => boolean,
  pickupGain?: PickupGainBound,
) {
  const score = source.evaluate;
  const kept: { index: number; move: RosterMove }[] = [];
  const consider = (index: number, variants: RosterMove[]) => {
    let best: RosterMove | undefined;
    for (const move of bestVariants(variants, score)) {
      if (!accepts(score(move.roster))) continue;
      if (!best || compareRosterMoves(move, best, score) < 0) best = move;
    }
    if (best) kept.push({ index, move: best });
  };
  consider(0, base);
  const pickups = source.pickups();
  if (pickups.length) {
    // Dropping players never raises a total, so the pre-drop roster plus the
    // pickup's marginal bound caps every variant with that acquisition.
    const current = pickupGain && score(roster);
    const gain = current && pickupGain!(current);
    const order = pickups.map((pickup, i) => ({
      pickup,
      index: i + 1,
      bound: gain ? current.total + gain(pickup) + 1e-6 : Infinity,
    }));
    if (gain) order.sort((a, b) => b.bound - a.bound || a.index - b.index);
    // Kept totals, descending; only the second best matters for pruning.
    const totals: number[] = kept.map((k) => score(k.move.roster).total);
    for (const { pickup, index, bound } of order) {
      if (gain) {
        const optimistic = {
          total: bound,
          complete: true,
          missing: 0,
        } as RosterEvaluation;
        // Orders are by descending bound, so no later acquisition qualifies.
        if (!accepts(optimistic)) break;
        if (totals.length >= 2 && bound < totals[1]) break;
      }
      const before = kept.length;
      consider(index, source.variantsFor(pickup));
      if (kept.length > before) {
        totals.push(score(kept[kept.length - 1].move.roster).total);
        totals.sort((a, b) => b - a);
      }
    }
  }
  return kept
    .sort(
      (a, b) => compareRosterMoves(a.move, b.move, score) || a.index - b.index,
    )
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((k) => k.move);
}

function bestPlan(
  myMoves: RosterMove[],
  theirMoves: RosterMove[],
  evaluate: (players: Player[]) => RosterEvaluation,
  evaluatePartner: (players: Player[]) => RosterEvaluation,
  options: MoveOptions & {
    comparePlans?: (a: TradePlan, b: TradePlan) => number;
    independentPoints?: unknown;
  },
) {
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
