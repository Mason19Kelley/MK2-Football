import { League, Player } from './types';
import {
  evaluateRoster,
  TradeEvaluation,
  TradeHorizon,
  playerWeek,
} from './weekly-trades';
import {
  bestNoTradeMove,
  compareRosterMoves,
  planTrade,
  RosterMove,
  TradePlan,
  tradePickupCandidates,
} from './trade-plans';
import {
  evaluateForecastRoster,
  ScenarioSettings,
  summarizeGains,
  validateScenarios,
} from './trade-evaluation';
import {
  evaluateLeagueOutcomes,
  OutcomeSummary,
  PlayoffScenario,
  TradeObjective,
  validateOutcomeSchedule,
} from './trade-outcomes';

type Impact = {
  before: TradeEvaluation;
  after: TradeEvaluation;
  gain: number;
  utilityGain?: number;
  uncertainty?: ReturnType<typeof summarizeGains>;
  outcomes?: { before: OutcomeSummary; after: OutcomeSummary };
};
export type TradeCandidate = {
  partnerId: number;
  send: Player[];
  receive: Player[];
  plan: TradePlan;
  horizon: TradeHorizon;
  objective?: TradeObjective;
  baseline?: { mine: RosterMove; partner: RosterMove };
  waiverBaseline?: boolean;
  scenarios?: ScenarioSettings;
  playoffs?: PlayoffScenario;
  partnerHorizon?: TradeHorizon;
  searchPolicy?: {
    ranking: TradeRanking;
    minimumGain: number;
    partnerMinimumGain?: number;
  };
  tradeOnly: { mine: number; partner: number };
  mine: Impact;
  partner: Impact;
};
export type TradeRanking =
  'mine' | 'balanced' | 'combined' | 'bargaining' | 'downside';
export function rankTrades(
  a: TradeCandidate,
  b: TradeCandidate,
  ranking: TradeRanking,
) {
  const score = (t: TradeCandidate) => {
    const mine = t.mine.utilityGain ?? t.mine.gain,
      partner = t.partner.utilityGain ?? t.partner.gain;
    return ranking === 'mine'
      ? mine
      : ranking === 'balanced'
        ? Math.min(mine, partner)
        : ranking === 'bargaining'
          ? mine * partner
          : ranking === 'downside'
            ? (t.mine.uncertainty?.p10 ?? mine)
            : mine + partner;
  };
  return (
    score(b) - score(a) ||
    (b.mine.utilityGain ?? b.mine.gain) - (a.mine.utilityGain ?? a.mine.gain) ||
    a.partnerId - b.partnerId ||
    a.send
      .map((p) => p.id)
      .join(',')
      .localeCompare(b.send.map((p) => p.id).join(',')) ||
    a.receive
      .map((p) => p.id)
      .join(',')
      .localeCompare(b.receive.map((p) => p.id).join(','))
  );
}
export function improvesBoth(
  t: TradeCandidate,
  minimumGain: number,
  partnerMinimumGain = minimumGain,
) {
  const mine = t.mine.utilityGain ?? t.mine.gain,
    partner = t.partner.utilityGain ?? t.partner.gain;
  const epsilon = t.objective && t.objective !== 'points' ? 1e-8 : 0.05;
  return (
    mine > epsilon &&
    partner > epsilon &&
    mine + 1e-8 >= minimumGain &&
    partner + 1e-8 >= partnerMinimumGain
  );
}
export function dominatesTrade(a: TradeCandidate, b: TradeCandidate) {
  const am = a.mine.utilityGain ?? a.mine.gain,
    ap = a.partner.utilityGain ?? a.partner.gain;
  const bm = b.mine.utilityGain ?? b.mine.gain,
    bp = b.partner.utilityGain ?? b.partner.gain;
  return (
    a.partnerId === b.partnerId &&
    am >= bm - 1e-8 &&
    ap >= bp - 1e-8 &&
    (am > bm + 1e-8 || ap > bp + 1e-8)
  );
}
function packages(players: Player[], size: number): Player[][] {
  return size === 1
    ? players.map((p) => [p])
    : players.flatMap((p, i) => players.slice(i + 1).map((q) => [p, q]));
}
const projected = (lineup: TradeEvaluation) =>
  lineup.complete && lineup.missing === 0;
export type FindTradeOptions = {
  partnerId?: number;
  maxPlayers: 1 | 2;
  unequal?: boolean;
  allSizes?: boolean;
  includePickup?: boolean;
  waiverBaseline?: boolean;
  horizon?: TradeHorizon;
  partnerHorizon?: TradeHorizon;
  minimumGain: number;
  partnerMinimumGain?: number;
  ranking: TradeRanking;
  paretoOnly?: boolean;
  scenarios?: ScenarioSettings;
  objective?: TradeObjective;
  playoffs?: PlayoffScenario;
  limit?: number;
  signal?: AbortSignal;
  onProgress?: (checked: number, progress?: TradeSearchProgress) => void;
  selectedPackage?: { send: number[]; receive: number[] };
  includeNonImproving?: boolean;
};
export type TradeSearchProgress = {
  phase: 'preparing' | 'searching';
  evaluatedRosters: number;
};
export async function findTrades(
  league: League,
  myTeamId: number,
  options: FindTradeOptions,
) {
  const mine = league.teams.find((t) => t.id === myTeamId);
  if (!mine) throw new Error('Choose a team in this league.');
  if (
    !Number.isFinite(options.minimumGain) ||
    options.minimumGain < 0 ||
    (options.partnerMinimumGain !== undefined &&
      (!Number.isFinite(options.partnerMinimumGain) ||
        options.partnerMinimumGain < 0))
  )
    throw new Error('Minimum gain must be a nonnegative number.');
  if (![1, 2].includes(options.maxPlayers))
    throw new Error('Unsupported trade size.');
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Invalid result limit.');
  const horizon = options.horizon ?? 'ros';
  if (!['ros', 'remaining', 'next3', 'playoffs'].includes(horizon))
    throw new Error('Unsupported trade horizon.');
  if (
    !['mine', 'balanced', 'combined', 'bargaining', 'downside'].includes(
      options.ranking,
    )
  )
    throw new Error('Unsupported ranking.');
  const objective = options.objective ?? 'points';
  if (!['points', 'wins', 'title'].includes(objective))
    throw new Error('Unsupported objective.');
  if (
    options.partnerHorizon &&
    !['ros', 'remaining', 'next3', 'playoffs'].includes(options.partnerHorizon)
  )
    throw new Error('Unsupported partner horizon.');
  if (
    objective !== 'points' &&
    options.partnerHorizon &&
    options.partnerHorizon !== horizon
  )
    throw new Error(
      'Win objectives use the same schedule period for both teams.',
    );
  if (options.scenarios) validateScenarios(options.scenarios);
  if (objective !== 'points' && !options.scenarios)
    throw new Error('Enable outcome scenarios to rank wins or championships.');
  validateOutcomeSchedule(league, horizon, objective, options.playoffs);
  if (league.tradesLocked)
    throw new Error('Trades are locked for this league.');
  const abort = () => options.signal?.throwIfAborted();
  abort();
  // Legacy opt-out retains the original streaming baseline. Default policy is a
  // fixed roster after at most one immediate acquisition; no unlimited streamers.
  const waiverBaseline = options.waiverBaseline ?? true;
  const includePickup = waiverBaseline || (options.includePickup ?? false);
  const cache = new Map<string, TradeEvaluation>();
  const projectionCache = new Map<
    number,
    Map<number, ReturnType<typeof playerWeek>>
  >();
  const replacementCache = new Map<number, Player[]>();
  const specialistCache = new Map<number, Player[]>();
  let phase: TradeSearchProgress['phase'] = 'preparing';
  let evaluatedRosters = 0;
  let checked = 0;
  let reportedAt = 0;
  options.onProgress?.(0, { phase, evaluatedRosters });
  const evaluate = (roster: Player[], period: TradeHorizon = horizon) => {
    abort();
    const key =
      period +
      ':' +
      roster
        .map((p) => `${p.id}:${p.slotId}`)
        .sort()
        .join(',');
    const previous = cache.get(key);
    if (previous) return previous;
    const value =
      !waiverBaseline &&
      !options.scenarios &&
      !roster.some((p) => p.projectionBounds)
        ? evaluateRoster(
            league,
            roster,
            period,
            projectionCache,
            replacementCache,
            { specialistCache },
          )
        : evaluateForecastRoster(league, roster, period, {
            scenarios: options.scenarios,
            streaming: !waiverBaseline && !options.scenarios,
            projectionCache,
            replacementCache,
            specialistCache,
          });
    evaluatedRosters++;
    if (Date.now() - reportedAt >= 100) {
      options.onProgress?.(checked, { phase, evaluatedRosters });
      reportedAt = Date.now();
    }
    if (cache.size >= 10000) cache.clear();
    cache.set(key, value);
    return value;
  };
  const hasBounds = [
    ...league.teams.flatMap((t) => t.players),
    ...(league.waiverWire?.players ?? []),
  ].some(
    (p) =>
      p.projectionBounds?.ros ||
      Object.keys(p.projectionBounds?.weekly ?? {}).length > 0,
  );
  const pickupCandidates = includePickup
    ? options.scenarios ||
      hasBounds ||
      (options.partnerHorizon && options.partnerHorizon !== horizon)
      ? (league.waiverWire?.players.filter(
          (p) => p.availability === 'FREEAGENT',
        ) ?? [])
      : tradePickupCandidates(league, horizon)
    : [];
  const moveOptions = {
    includePickup,
    pickupCandidates,
    evaluate,
    signal: options.signal,
    preserveVariants:
      objective !== 'points' || Boolean(options.scenarios) || hasBounds,
    pruneUnusedDrops:
      waiverBaseline && !options.scenarios && objective === 'points',
  };
  const currentEvaluations = new Map(
    league.teams.map((t) => [t.id, evaluate(t.players)]),
  );
  if (
    objective !== 'points' &&
    [...currentEvaluations.values()].some((e) => !projected(e))
  )
    throw new Error(
      'Win scenarios need complete forecasts for every team’s current roster.',
    );
  const baselines = new Map<
    number,
    { move: RosterMove; evaluation: TradeEvaluation }
  >();
  // Only focal teams need optimized baselines. Other teams use current rosters
  // in matchup scenarios and do not need acquisition searches.
  const baselineTeams = league.teams.filter(
    (t) =>
      t.id === myTeamId ||
      options.partnerId === undefined ||
      t.id === options.partnerId,
  );
  for (const team of baselineTeams) {
    abort();
    try {
      const evaluateUtility = (players: Player[]) => {
        const value = evaluate(players);
        if (objective === 'points') return value;
        const all = new Map(currentEvaluations);
        all.set(team.id, value);
        const outcome = evaluateLeagueOutcomes(
          league,
          all,
          horizon,
          objective,
          options.playoffs,
        ).get(team.id)!;
        const utility = objective === 'title' ? outcome.title! : outcome.wins;
        return { ...value, total: utility, upperTotal: utility };
      };
      const base = waiverBaseline
        ? bestNoTradeMove(league, team, {
            ...moveOptions,
            evaluate: evaluateUtility,
          })
        : {
            move: {
              roster: team.players,
              openSpots: 0,
              capacitySource: 'snapshot' as const,
            },
            evaluation: evaluate(team.players),
          };
      const value = evaluate(base.move.roster);
      baselines.set(team.id, {
        move: base.move,
        evaluation: {
          ...value,
          missing: base.evaluation.missing,
          upperTotal:
            objective === 'points' ? base.evaluation.upperTotal : value.total,
        },
      });
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !/No eligible player can be dropped|at most one extra player/.test(
          err.message,
        )
      )
        throw err;
    }
    // Baselines can themselves require many legal add/drop evaluations.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const myBase = baselines.get(myTeamId),
    before = myBase?.evaluation;
  if (!before || !projected(before))
    throw new Error(
      'Your team needs forecasts or explicit bounds for missing values and enough eligible players. Check weekly and ROS projections.',
    );
  const leagueBefore = new Map(
    [...baselines].map(([id, b]) => [id, b.evaluation]),
  );
  if (
    objective !== 'points' &&
    baselineTeams.some(
      (t) => !leagueBefore.has(t.id) || !projected(leagueBefore.get(t.id)!),
    )
  )
    throw new Error(
      'Win scenarios need complete forecasts and legal roster plans for every team.',
    );
  // Other teams' current rosters avoid pretending every owner can claim the same
  // no-trade free agent. Each focal baseline is a separate counterfactual.
  const candidates: TradeCandidate[] = [],
    skipped: string[] = [];
  const frontiers = new Map<number, TradeCandidate[]>();
  let matched = 0,
    unplannable = 0,
    yieldedAt = Date.now();
  phase = 'searching';
  options.onProgress?.(0, { phase, evaluatedRosters });
  const eligible = (players: Player[]) =>
    players.filter(
      (p) =>
        p.slotId !== 21 &&
        p.position !== 'K' &&
        p.position !== 'D/ST' &&
        !p.transactionLocked,
    );
  for (const partner of league.teams.filter(
    (t) =>
      t.id !== myTeamId &&
      (options.partnerId === undefined || t.id === options.partnerId),
  )) {
    const evaluatePartner = (players: Player[]) =>
      evaluate(players, options.partnerHorizon ?? horizon);
    const alternative =
      options.partnerHorizon && options.partnerHorizon !== horizon
        ? waiverBaseline
          ? bestNoTradeMove(league, partner, {
              ...moveOptions,
              evaluate: evaluatePartner,
            })
          : {
              move: {
                roster: partner.players,
                openSpots: 0,
                capacitySource: 'snapshot' as const,
              },
              evaluation: evaluatePartner(partner.players),
            }
        : undefined;
    const partnerBase = alternative
        ? {
            move: alternative.move,
            evaluation: {
              ...evaluatePartner(alternative.move.roster),
              upperTotal: alternative.evaluation.upperTotal,
              missing: alternative.evaluation.missing,
            },
          }
        : baselines.get(partner.id),
      partnerBefore = partnerBase?.evaluation;
    if (!partnerBefore || !projected(partnerBefore)) {
      skipped.push(partner.name);
      continue;
    }
    const beforeOutcomes = (teamId: number, base: TradeEvaluation) => {
      const all = new Map(currentEvaluations);
      all.set(teamId, base);
      return evaluateLeagueOutcomes(
        league,
        all,
        horizon,
        objective,
        options.playoffs,
      ).get(teamId)!;
    };
    const myBeforeOutcome =
      objective === 'points' ? undefined : beforeOutcomes(myTeamId, before);
    const partnerBeforeOutcome =
      objective === 'points'
        ? undefined
        : beforeOutcomes(partner.id, partnerBefore);
    const impact = (
      base: TradeEvaluation,
      after: TradeEvaluation,
      oldOutcome?: OutcomeSummary,
      nextOutcome?: OutcomeSummary,
    ): Impact => {
      const gain = after.total - (base.upperTotal ?? base.total);
      const utilityGain =
        oldOutcome && nextOutcome
          ? objective === 'title'
            ? nextOutcome.title! - oldOutcome.title!
            : nextOutcome.wins - oldOutcome.wins
          : undefined;
      const values = nextOutcome?.values ?? after.scenarioTotals;
      const previous = oldOutcome?.values ?? base.scenarioTotals;
      return {
        before: base,
        after,
        gain,
        utilityGain,
        uncertainty:
          values && previous ? summarizeGains(values, previous) : undefined,
        outcomes:
          oldOutcome && nextOutcome
            ? { before: oldOutcome, after: nextOutcome }
            : undefined,
      };
    };
    const candidateFor = (
      plan: TradePlan,
      send: Player[],
      receive: Player[],
    ): TradeCandidate => {
      const after = evaluate(plan.mine.roster),
        partnerAfter = evaluatePartner(plan.partner.roster);
      let outcomes: Map<number, OutcomeSummary> | undefined;
      if (objective !== 'points') {
        const all = new Map(currentEvaluations);
        all.set(myTeamId, after);
        all.set(partner.id, partnerAfter);
        outcomes = evaluateLeagueOutcomes(
          league,
          all,
          horizon,
          objective,
          options.playoffs,
        );
      }
      return {
        partnerId: partner.id,
        send,
        receive,
        plan,
        horizon,
        objective,
        waiverBaseline,
        scenarios: options.scenarios,
        playoffs: options.playoffs,
        partnerHorizon: options.partnerHorizon,
        searchPolicy: {
          ranking: options.ranking,
          minimumGain: options.minimumGain,
          partnerMinimumGain: options.partnerMinimumGain,
        },
        baseline: { mine: myBase!.move, partner: partnerBase!.move },
        tradeOnly: { mine: 0, partner: 0 },
        mine: impact(before, after, myBeforeOutcome, outcomes?.get(myTeamId)),
        partner: impact(
          partnerBefore,
          partnerAfter,
          partnerBeforeOutcome,
          outcomes?.get(partner.id),
        ),
      };
    };
    const sizes = options.selectedPackage
      ? [
          [
            options.selectedPackage.send.length,
            options.selectedPackage.receive.length,
          ],
        ]
      : options.allSizes
        ? [
            [1, 1],
            [2, 2],
            [2, 1],
            [1, 2],
          ]
        : options.unequal
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
    const selectedPlayers = (players: Player[], ids: number[]) => {
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !players.some((p) => p.id === id))
      )
        throw new Error('Invalid selected trade package.');
      return ids.map((id) => players.find((p) => p.id === id)!);
    };
    for (const [sendSize, receiveSize] of sizes)
      for (const send of options.selectedPackage
        ? [selectedPlayers(mine.players, options.selectedPackage.send)]
        : packages(eligible(mine.players), sendSize))
        for (const receive of options.selectedPackage
          ? [selectedPlayers(partner.players, options.selectedPackage.receive)]
          : packages(eligible(partner.players), receiveSize)) {
          abort();
          checked++;
          try {
            const scored = new WeakMap<TradePlan, TradeCandidate>();
            const get = (plan: TradePlan) => {
              let c = scored.get(plan);
              if (!c) {
                c = candidateFor(plan, send, receive);
                scored.set(plan, c);
              }
              return c;
            };
            const valid = (c: TradeCandidate) =>
              projected(c.mine.after) &&
              projected(c.partner.after) &&
              improvesBoth(c, options.minimumGain, options.partnerMinimumGain);
            const plan = planTrade(
              league,
              mine.players,
              partner.players,
              send.map((p) => p.id),
              receive.map((p) => p.id),
              {
                ...moveOptions,
                evaluatePartner,
                comparePlans: (a, b) =>
                  Number(valid(get(b))) - Number(valid(get(a))) ||
                  rankTrades(get(a), get(b), options.ranking) ||
                  compareRosterMoves(a.mine, b.mine, evaluate) ||
                  compareRosterMoves(a.partner, b.partner, evaluatePartner),
              },
            );
            const candidate = get(plan);
            if (
              valid(candidate) ||
              (options.includeNonImproving &&
                projected(candidate.mine.after) &&
                projected(candidate.partner.after))
            ) {
              matched++;
              if (options.paretoOnly) {
                const frontier = frontiers.get(partner.id) ?? [];
                if (!frontier.some((c) => dominatesTrade(c, candidate)))
                  frontiers.set(partner.id, [
                    ...frontier.filter((c) => !dominatesTrade(candidate, c)),
                    candidate,
                  ]);
              } else {
                candidates.push(candidate);
                candidates.sort((a, b) => rankTrades(a, b, options.ranking));
                if (candidates.length > limit) candidates.pop();
              }
            }
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
          if (Date.now() - yieldedAt >= 25) {
            options.onProgress?.(checked, { phase, evaluatedRosters });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            yieldedAt = Date.now();
          }
        }
  }
  abort();
  const frontierCount = options.paretoOnly
    ? [...frontiers.values()].reduce((sum, f) => sum + f.length, 0)
    : undefined;
  if (options.paretoOnly)
    candidates.push(
      ...[...frontiers.values()]
        .flat()
        .sort((a, b) => rankTrades(a, b, options.ranking))
        .slice(0, limit),
    );
  // Pickup-free gains are display details, not part of ranking or filtering.
  // Only compute them for offers that survive the frontier and result limit.
  for (const candidate of candidates) {
    abort();
    const partner = league.teams.find((t) => t.id === candidate.partnerId)!;
    const evaluatePartner = (players: Player[]) =>
      evaluate(players, options.partnerHorizon ?? horizon);
    const noPickup = planTrade(
      league,
      mine.players,
      partner.players,
      candidate.send.map((p) => p.id),
      candidate.receive.map((p) => p.id),
      { evaluate, evaluatePartner, includePickup: false },
    );
    candidate.tradeOnly = {
      mine:
        evaluate(noPickup.mine.roster).total -
        (candidate.mine.before.upperTotal ?? candidate.mine.before.total),
      partner:
        evaluatePartner(noPickup.partner.roster).total -
        (candidate.partner.before.upperTotal ?? candidate.partner.before.total),
    };
  }
  const warnings: string[] = [];
  if (waiverBaseline)
    warnings.push(
      'Gains compare separate best no-trade counterfactuals with up to one immediate acquisition. Post-trade pickups are jointly allocated. K/D/ST streaming from available free agents is assumed in weekly projections.',
    );
  warnings.push(
    'Current-week games are assumed unplayed. Capacity and supplied locks, acquisition budgets and position limits are enforced; ESPN does not currently import those transaction restrictions.',
  );
  if (waiverBaseline && !league.waiverWire)
    warnings.push(
      'Waiver pool unavailable; the no-trade baseline uses owned players only. Sync ESPN.',
    );
  if (league.waiverWire?.truncated)
    warnings.push(
      'The available-player pool is truncated; optimality applies only to imported players.',
    );
  if (
    horizon === 'ros' &&
    league.teams.some((t) =>
      t.players.some((p) => Object.keys(p.weeklyOverrides ?? {}).length),
    )
  )
    warnings.push(
      'Legacy season-total mode uses ROS totals. Choose a weekly period to use weekly overrides, or upload a week-0 ROS total.',
    );
  if (options.scenarios)
    warnings.push(
      'Scenario probabilities reflect your assumptions, not a calibrated forecast. Lineups are chosen before score noise is drawn.',
    );
  if (objective === 'title')
    warnings.push(
      'Declared bracket uses wins/ties, points-for, then team ID; higher seeds win playoff ties. Confirm these rules match your league.',
    );
  if (
    league.teams.some((t) =>
      t.players.some((p) => p.returnWeek && p.slotId === 21),
    )
  )
    warnings.push(
      'IR recovery scenarios assume activation is possible; confirm roster room before acting.',
    );
  return {
    candidates,
    skipped,
    checked,
    matched,
    unplannable,
    frontierCount,
    warnings,
    baseline: myBase!.move,
    baselineTotal: before.total,
    baselineUpperTotal: before.upperTotal ?? before.total,
    scope:
      'All selected 1–2 player packages and evaluated legal roster plans; scenario rankings are optimal only for the configured sampled model.',
  };
}
