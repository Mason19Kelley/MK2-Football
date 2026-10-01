import type { League, Player } from './types';

// Source averages are per active NFL game; ROS overrides are remaining totals.
// Missing weeks are estimated independently, never as a residual of known weeks.
export function productionForecast(
  p: Player,
  league: Pick<League, 'week' | 'finalWeek'>,
  week: number,
) {
  if (week > league.finalWeek || p.byeWeek === week)
    return { points: 0, estimated: false };
  if (Number.isFinite(p.weeklyOverrides?.[week]))
    return { points: p.weeklyOverrides![week], estimated: false };
  const playingWeeks = Math.max(
    0,
    league.finalWeek -
      league.week +
      1 -
      Number(
        p.byeWeek !== undefined &&
          p.byeWeek >= league.week &&
          p.byeWeek <= league.finalWeek,
      ),
  );
  if (p.projectionSource === 'custom')
    return {
      points: p.ros === null ? null : playingWeeks ? p.ros / playingWeeks : 0,
      estimated: true,
    };
  const known =
    p.weeklyProjections?.[week] ?? (week === league.week ? p.weekly : null);
  if (Number.isFinite(known))
    return { points: known!, estimated: p.projectionSource === 'sample' };
  const average =
    p.projectedPointsPerGame ??
    (p.ros === null
      ? null
      : p.ros / Math.max(1, league.finalWeek - league.week + 1));
  return { points: average, estimated: average !== null };
}

export function playerRosForecast(
  p: Player,
  league: Pick<League, 'week' | 'finalWeek'>,
) {
  let points = 0;
  let estimated = false;
  for (let week = league.week; week <= league.finalWeek; week++) {
    const value = productionForecast(p, league, week);
    if (value.points === null) return { points: null, estimated: false };
    points += value.points;
    estimated ||= value.estimated;
  }
  return { points, estimated };
}

export function refreshPlayerRos(league: League) {
  for (const p of [
    ...league.teams.flatMap((t) => t.players),
    ...(league.waiverWire?.players ?? []),
  ]) {
    if (p.projectionSource === 'custom') continue;
    if (p.projectedPointsPerGame === undefined && p.ros !== null)
      p.projectedPointsPerGame =
        p.ros / Math.max(1, league.finalWeek - league.week + 1);
    const value = playerRosForecast(p, league);
    p.ros = value.points;
    if (p.projectionSource !== 'sample')
      p.projectionSource =
        value.points === null
          ? 'unavailable'
          : value.estimated
            ? 'estimate'
            : 'weekly-sum';
  }
}
