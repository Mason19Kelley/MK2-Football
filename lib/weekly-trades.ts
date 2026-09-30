import { League, Player } from './types';
import { optimalLineup } from './trades';

export type TradeHorizon = 'ros' | 'remaining' | 'next3' | 'playoffs';
export type WeekLineup = ReturnType<typeof optimalLineup> & {
  week: number;
  estimated: number;
  unknownByes: number;
};
export type TradeEvaluation = ReturnType<typeof optimalLineup> & {
  weeks: WeekLineup[];
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
  const weeks = Array.from(
    { length: Math.max(0, league.finalWeek - league.week + 1) },
    (_, i) => league.week + i,
  );
  const forecasts: Record<number, number> = { ...p.weeklyProjections };
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
): TradeEvaluation {
  const base = optimalLineup(roster, league.slots);
  if (horizon === 'ros') return { ...base, weeks: [] };
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
    const lineup = optimalLineup(
      values.map(({ p, value }) => ({
        ...p,
        weekly: value.points,
        eligibleSlots: value.unavailable ? [] : p.eligibleSlots,
      })),
      league.slots,
      'weekly',
    );
    const selected = new Set(lineup.players.map((p) => p.id));
    return {
      ...lineup,
      week,
      estimated: values.filter(
        ({ p, value }) => selected.has(p.id) && value.estimated,
      ).length,
      unknownByes: values.filter(
        ({ p }) => selected.has(p.id) && p.byeWeek === undefined,
      ).length,
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
        roster.map((p) => ({ ...p, ros: p.ros ?? 0 })),
        league.slots,
      ).complete,
    weeks,
  };
}
