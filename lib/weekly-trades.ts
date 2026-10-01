import { League, Player } from './types';
import { optimalLineup } from './trades';

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
      league.playoffStartWeek! > league.finalWeek)
  )
    throw new Error('Choose a playoff start week to compare playoff gains.');
  const start = Math.max(
    league.week,
    horizon === 'playoffs' ? league.playoffStartWeek! : league.week,
  );
  const end =
    horizon === 'next3'
      ? Math.min(league.finalWeek, league.week + 2)
      : league.finalWeek;
  return Array.from(
    { length: Math.max(0, end - start + 1) },
    (_, i) => start + i,
  );
}
// Never infer an entire season of missed games from today's injury flag.
// IR remains unavailable until the manager updates/syncs the roster.
export function playerWeek(p: Player, league: League, week: number) {
  const unavailable =
    p.byeWeek === week ||
    p.slotId === 21 ||
    (week === league.week &&
      ['OUT', 'DOUBTFUL', 'INACTIVE', 'SUSPENSION', 'SUSPENDED'].includes(
        p.status,
      ));
  if (unavailable) return { points: 0, estimated: false, unavailable: true };
  if (Number.isFinite(p.weeklyOverrides?.[week]))
    return {
      points: p.weeklyOverrides![week],
      estimated: false,
      unavailable: false,
    };
  const weeks = Array.from(
    { length: Math.max(0, league.finalWeek - league.week + 1) },
    (_, i) => league.week + i,
  );
  const forecasts: Record<number, number> = {
    ...p.weeklyProjections,
    ...p.weeklyOverrides,
  };
  if (forecasts[league.week] === undefined && p.weekly !== null)
    forecasts[league.week] = p.weekly;
  const forecast = forecasts[week];
  if (p.projectionSource === 'custom') {
    // A ROS override is a total, not a new weekly forecast. Spread it across
    // non-bye weeks so the override never silently disappears in weekly mode.
    const playing = weeks.filter((w) => w !== p.byeWeek);
    return {
      points: p.ros === null || !playing.length ? null : p.ros / playing.length,
      estimated: true,
      unavailable: false,
    };
  }
  if (Number.isFinite(forecast))
    return {
      points: forecast,
      estimated: p.projectionSource === 'sample',
      unavailable: false,
    };
  if (p.ros === null)
    return { points: null, estimated: false, unavailable: false };
  const known = weeks.filter(
    (w) => w !== p.byeWeek && Number.isFinite(forecasts[w]),
  );
  const remaining = weeks.length - known.length;
  // Keep known forecasts. Allocate the residual evenly, including a possible
  // bye in the denominator, then zero the bye; never inflate estimates to
  // compensate for missed games. These are estimates, not matchup forecasts.
  const estimate =
    remaining > 0
      ? Math.max(0, p.ros - known.reduce((sum, w) => sum + forecasts[w], 0)) /
        remaining
      : 0;
  return { points: estimate, estimated: true, unavailable: false };
}
export function evaluateRoster(
  league: League,
  roster: Player[],
  horizon: TradeHorizon,
  projectionCache?: Map<number, Map<number, ReturnType<typeof playerWeek>>>,
  replacementCache?: Map<number, Player[]>,
  options: { streaming?: boolean; streamSpecialists?: boolean } = {},
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
        : specialistStreamingCandidates(league, roster, week);
    let lineup = optimalLineup(
      [
        ...values.map(({ p, value }) => projectedPlayer(p, value)),
        ...specialists,
      ],
      league.slots,
      'weekly',
    );
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
        const supplemented = optimalLineup(
          all.map((p) => ({
            ...p,
            weekly:
              p.weekly === null
                ? null
                : p.weekly + (rosterIds.has(p.id) ? bonus : 0),
          })),
          league.slots,
          'weekly',
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
): Player[] {
  const owned = new Set(roster.map((p) => p.id));
  return weeklyReplacementCandidates(league, week, true)
    .filter(
      (p) => (p.position === 'K' || p.position === 'D/ST') && !owned.has(p.id),
    )
    .map((p) => ({
      ...p,
      eligibleSlots: p.eligibleSlots.filter(
        (slot) => slot === 16 || slot === 17,
      ),
    }));
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
