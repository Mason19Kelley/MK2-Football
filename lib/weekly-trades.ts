import { League, Player, fantasyFinalWeek } from './types';
import { optimalLineup } from './trades';
import { productionForecast } from './weekly-forecasts';

export type TradeHorizon = 'ros' | 'remaining' | 'next3' | 'playoffs';
export type WeekLineup = ReturnType<typeof optimalLineup> & {
  week: number;
  estimated: number;
  unknownByes: number;
  replacements: Player[];
};
export type TradeEvaluation = ReturnType<typeof optimalLineup> & {
  weeks: WeekLineup[];
  upperTotal?: number;
  scenarioTotals?: number[];
  scenarioWeeks?: Record<number, number[]>;
  bounded?: boolean;
  usedPlayerIds?: number[];
};
export const horizonLabels: Record<TradeHorizon, string> = {
  ros: 'Season-total lineup (legacy)',
  remaining: 'Full remaining season',
  next3: 'Next three weeks',
  playoffs: 'Playoff weeks',
};
export function horizonWeeks(league: League, horizon: TradeHorizon) {
  if (horizon === 'ros') return [];
  if (
    horizon === 'playoffs' &&
    (!Number.isInteger(league.playoffStartWeek) ||
      league.playoffStartWeek! < 1 ||
      league.playoffStartWeek! > fantasyFinalWeek(league))
  )
    throw new Error('Choose a playoff start week to compare playoff gains.');
  const start = Math.max(
    league.week,
    horizon === 'playoffs' ? league.playoffStartWeek! : league.week,
  );
  const end =
    horizon === 'next3'
      ? Math.min(fantasyFinalWeek(league), league.week + 2)
      : fantasyFinalWeek(league);
  return Array.from(
    { length: Math.max(0, end - start + 1) },
    (_, i) => start + i,
  );
}
// Never infer an entire season of missed games from today's injury flag.
// IR remains unavailable until the manager updates/syncs the roster.
export function playerWeek(p: Player, league: League, week: number) {
  if (week > fantasyFinalWeek(league))
    return { points: 0, estimated: false, unavailable: true };
  const game = p.currentGame?.week === week ? p.currentGame : undefined;
  if (game && game.state !== 'scheduled') {
    const value = productionForecast(p, league, week);
    return {
      points:
        game.actual === null
          ? null
          : game.actual +
            (game.remainingFraction === 0
              ? 0
              : (value.points ?? 0) * game.remainingFraction),
      estimated: game.state === 'in-progress',
      unavailable: false,
    };
  }
  const unavailable =
    p.byeWeek === week ||
    p.slotId === 21 ||
    (week === league.week &&
      ['OUT', 'DOUBTFUL', 'INACTIVE', 'SUSPENSION', 'SUSPENDED'].includes(
        p.status,
      ));
  if (unavailable) return { points: 0, estimated: false, unavailable: true };
  return { ...productionForecast(p, league, week), unavailable: false };
}
export function evaluateRoster(
  league: League,
  roster: Player[],
  horizon: TradeHorizon,
  projectionCache?: Map<number, Map<number, ReturnType<typeof playerWeek>>>,
  replacementCache?: Map<number, Player[]>,
  options: {
    streaming?: boolean;
    streamSpecialists?: boolean;
    specialistCache?: Map<number, Player[]>;
  } = {},
): TradeEvaluation {
  const base = optimalLineup(roster, league.slots);
  if (horizon === 'ros') return { ...base, weeks: [] };
  const projectedPlayer = (
    p: Player,
    value: ReturnType<typeof playerWeek>,
  ): Player => {
    // Forecasts are immutable during a search. Share the same projected player
    // objects across roster assignments instead of cloning every week/roster.
    const cached = value as ReturnType<typeof playerWeek> & {
      projected?: Player;
    };
    return (cached.projected ??= {
      ...p,
      weekly: value.points,
      eligibleSlots: value.unavailable ? [] : p.eligibleSlots,
    });
  };
  const weeks = horizonWeeks(league, horizon).map((week) => {
    const values = roster.map((p) => {
      let byWeek = projectionCache?.get(p.id);
      if (projectionCache && !byWeek) {
        byWeek = new Map();
        projectionCache.set(p.id, byWeek);
      }
      let value = byWeek?.get(week);
      if (!value) {
        value = playerWeek(p, league, week);
        byWeek?.set(week, value);
      }
      return { p, value };
    });
    const specialists =
      options.streamSpecialists === false
        ? []
        : specialistStreamingCandidates(
            league,
            roster,
            week,
            options.specialistCache,
          );
    let lineup = weeklyLineup(league, week, [
      ...values.map(({ p, value }) => projectedPlayer(p, value)),
      ...specialists,
    ]);
    const rosterIds = new Set(roster.map((p) => p.id));
    let replacements: Player[] = lineup.players.filter(
      (p) => !rosterIds.has(p.id),
    );
    if (!lineup.complete && league.waiverWire && options.streaming !== false) {
      let candidates = replacementCache?.get(week);
      if (!candidates) {
        candidates = weeklyReplacementCandidates(league, week);
        replacementCache?.set(week, candidates);
      }
      const rosterIds = new Set(roster.map((p) => p.id));
      const available = candidates.filter((p) => !rosterIds.has(p.id));
      if (available.length) {
        const owned = [
          ...values.map(({ p, value }) => projectedPlayer(p, value)),
          ...replacements,
        ];
        const ownedIds = new Set(owned.map((p) => p.id));
        const all = [...owned, ...available.filter((p) => !ownedIds.has(p.id))];
        // First maximize coverage, then retain as many owned starters as possible,
        // then maximize real projected points. Free agents only cover vacancies.
        const bonus =
          1 + all.reduce((sum, p) => sum + Math.abs(p.weekly ?? 0), 0);
        const supplemented = weeklyLineup(
          league,
          week,
          all.map((p) => ({
            ...p,
            weekly:
              p.weekly === null
                ? null
                : p.weekly + (rosterIds.has(p.id) ? bonus : 0),
          })),
        );
        const actual = new Map(all.map((p) => [p.id, p]));
        const players = supplemented.players.map((p) => actual.get(p.id)!);
        lineup = {
          ...supplemented,
          players,
          total: players.reduce((sum, p) => sum + (p.weekly ?? 0), 0),
        };
        replacements = players.filter((p) => !rosterIds.has(p.id));
      }
    }
    const selected = new Set(lineup.players.map((p) => p.id));
    return {
      ...lineup,
      week,
      replacements,
      estimated:
        values.filter(({ p, value }) => selected.has(p.id) && value.estimated)
          .length +
        replacements.filter(
          (p) =>
            playerWeek(
              league.waiverWire!.players.find((q) => q.id === p.id)!,
              league,
              week,
            ).estimated,
        ).length,
      unknownByes:
        values.filter(({ p }) => selected.has(p.id) && p.byeWeek === undefined)
          .length + replacements.filter((p) => p.byeWeek === undefined).length,
      missing: values.filter(
        ({ p, value }) => p.slotId !== 21 && value.points === null,
      ).length,
    };
  });
  return {
    ...base,
    total: weeks.reduce((sum, w) => sum + w.total, 0),
    missing: weeks.reduce((sum, w) => sum + w.missing, 0),
    // A bye can leave a zero-point vacancy; it must be visible rather than
    // hiding every trade involving that team. Structural eligibility still applies.
    complete:
      weeks.length > 0 &&
      optimalLineup(
        [
          ...new Map(
            [...roster, ...weeks.flatMap((w) => w.replacements)].map((p) => [
              p.id,
              p,
            ]),
          ).values(),
        ].map((p) => ({
          ...p,
          ros: p.ros ?? 0,
        })),
        league.slots,
      ).complete,
    weeks,
  };
}

// Specialist streaming is a projection assumption, never a roster mutation.
// Use only available, unrostered free agents with forecasts for this week.
export function specialistStreamingCandidates(
  league: League,
  roster: Player[],
  week: number,
  cache?: Map<number, Player[]>,
): Player[] {
  // Cache only the league-wide pool. A post-trade pickup can already be owned
  // by this roster, so ownership filtering must still happen on every call.
  let candidates = cache?.get(week);
  if (!candidates) {
    candidates = weeklyReplacementCandidates(league, week, true).map((p) => ({
      ...p,
      eligibleSlots: p.eligibleSlots.filter(
        (slot) => slot === 16 || slot === 17,
      ),
    }));
    cache?.set(week, candidates);
  }
  const owned = new Set(roster.map((p) => p.id));
  return candidates.filter((p) => !owned.has(p.id));
}

// Players with the same starting eligibility are interchangeable for a single
// week. Keep enough of the strongest to fill every slot, including repeated QB
// slots and superflex, rather than adding thousands of free agents to matching.
export function weeklyReplacementCandidates(
  league: League,
  week: number,
  specialistsOnly = false,
): Player[] {
  const rostered = new Set(
    league.teams.flatMap((t) => t.players.map((p) => p.id)),
  );
  const starting = new Set(league.slots.map((s) => s.id));
  const count = league.slots.reduce((sum, s) => sum + s.count, 0);
  const groups = new Map<string, Player[]>();
  const seen = new Set<number>();
  for (const p of league.waiverWire?.players ?? []) {
    if (
      (specialistsOnly && p.position !== 'K' && p.position !== 'D/ST') ||
      p.availability !== 'FREEAGENT' ||
      p.slotId === 21 ||
      rostered.has(p.id) ||
      seen.has(p.id)
    )
      continue;
    seen.add(p.id);
    const eligibility = [
      ...new Set(p.eligibleSlots.filter((s) => starting.has(s))),
    ].sort((a, b) => a - b);
    const value = playerWeek(p, league, week);
    if (!eligibility.length || value.unavailable || value.points === null)
      continue;
    const key = eligibility.join(',');
    const group = groups.get(key) ?? [];
    group.push({ ...p, slotId: 20, slot: 'BN', weekly: value.points });
    group.sort((a, b) => b.weekly! - a.weekly! || a.id - b.id);
    groups.set(key, group.slice(0, count));
  }
  return [...groups.values()].flat();
}

// Reserve exact locked slots before optimizing the remaining lineup. Locked
// bench players cannot enter; negative actual scores cannot be benched away.
export function weeklyLineup(league: League, week: number, roster: Player[]) {
  const locked = roster.filter(
    (p) => p.currentGame?.week === week && p.currentGame.state !== 'scheduled',
  );
  if (!locked.length) return optimalLineup(roster, league.slots, 'weekly');
  const slots = league.slots.map((s) => ({ ...s }));
  const starters: Player[] = [];
  for (const p of locked) {
    const slot = slots.find(
      (s) => s.id === p.currentGame!.lockedSlotId && s.count > 0,
    );
    if (slot) {
      slot.count--;
      starters.push(p);
    }
  }
  const ids = new Set(locked.map((p) => p.id));
  const rest = optimalLineup(
    roster.filter((p) => !ids.has(p.id)),
    slots.filter((s) => s.count > 0),
    'weekly',
  );
  const players = [...starters, ...rest.players];
  const totalSlots = league.slots.reduce((sum, s) => sum + s.count, 0);
  return {
    ...rest,
    players,
    total: players.reduce((sum, p) => sum + (p.weekly ?? 0), 0),
    slots: totalSlots,
    filled: players.length,
    complete: players.length === totalSlots,
    missing: rest.missing + starters.filter((p) => p.weekly === null).length,
  };
}
