import { League, Player } from './types';

// Migrate browser snapshots created when manager CSV uploads were supported.
// Keep roster/availability data, but restore forecasts from the source snapshot.
export function restoreSourceProjections(
  league: League,
  original?: League,
): League {
  const source = new Map(
    (original?.id === league.id && original.season === league.season
      ? [
          ...original.teams.flatMap((team) => team.players),
          ...(original.waiverWire?.players ?? []),
        ]
      : []
    ).map((player) => [player.id, player]),
  );
  const restore = <T extends Player>(player: T): T => {
    const next = { ...player };
    if (
      player.projectionSource === 'custom' ||
      Object.keys(player.weeklyOverrides ?? {}).length
    ) {
      const baseline = source.get(player.id);
      if (
        baseline &&
        baseline.projectionSource !== 'custom' &&
        !Object.keys(baseline.weeklyOverrides ?? {}).length
      ) {
        next.weekly = baseline.weekly;
        next.ros = baseline.ros;
        next.season = baseline.season;
        next.projectedPointsPerGame = baseline.projectedPointsPerGame;
        next.weeklyProjections = baseline.weeklyProjections;
        next.projectionSource = baseline.projectionSource;
      } else {
        // A source snapshot may be missing in old storage. Never retain uploaded
        // values as ESPN forecasts; a refresh will refill unavailable values.
        next.weekly = player.weeklyProjections?.[league.week] ?? null;
        if (player.projectionSource === 'custom') {
          next.ros = null;
          next.projectedPointsPerGame = null;
          next.projectionSource = 'unavailable';
        }
      }
    }
    delete next.weeklyOverrides;
    delete next.projectionBounds;
    delete next.forecastUpdatedAt;
    delete next.forecastProvenance;
    delete next.availabilityProbability;
    delete next.returnWeek;
    delete next.scoreStdDev;
    delete next.roleStdDev;
    return next;
  };
  return {
    ...league,
    teams: league.teams.map((team) => ({
      ...team,
      players: team.players.map(restore),
    })),
    ...(league.waiverWire
      ? {
          waiverWire: {
            ...league.waiverWire,
            players: league.waiverWire.players.map(restore),
          },
        }
      : {}),
  };
}
