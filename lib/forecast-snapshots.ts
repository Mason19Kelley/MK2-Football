import { League, Player } from './types';
import { FindTradeOptions } from './trade-finder';
// Capture today's inputs for future out-of-time validation. This is never a
// reconstruction of historical offer-time features or an acceptance label.
export function forecastSnapshot(
  league: League,
  settings: Pick<
    FindTradeOptions,
    'horizon' | 'objective' | 'scenarios' | 'playoffs' | 'waiverBaseline'
  >,
  capturedAt = new Date().toISOString(),
) {
  const forecast = (p: Player) => ({
    id: p.id,
    position: p.position,
    nflTeam: p.nflTeam,
    slotId: p.slotId,
    eligibleSlots: p.eligibleSlots,
    status: p.status,
    weekly: p.weekly,
    ros: p.ros,
    weeklyProjections: p.weeklyProjections,
    weeklyActuals: p.weeklyActuals,
    currentGame: p.currentGame,
    projectedPointsPerGame: p.projectedPointsPerGame,
    weeklyOverrides: p.weeklyOverrides,
    projectionSource: p.projectionSource,
    projectionBounds: p.projectionBounds,
    forecastUpdatedAt: p.forecastUpdatedAt,
    forecastProvenance: p.forecastProvenance,
    byeWeek: p.byeWeek,
    availabilityProbability: p.availabilityProbability,
    returnWeek: p.returnWeek,
    scoreStdDev: p.scoreStdDev,
    roleStdDev: p.roleStdDev,
    transactionLocked: p.transactionLocked,
  });
  return {
    version: 1,
    capturedAt,
    sourceSyncedAt: league.syncedAt,
    settings,
    league: {
      id: league.id,
      season: league.season,
      week: league.week,
      finalWeek: league.finalWeek,
      scoring: league.scoring,
      slots: league.slots,
      matchups: league.matchups,
      playoffStartWeek: league.playoffStartWeek,
      playoffTeamCount: league.playoffTeamCount,
      playoffRoundWeeks: league.playoffRoundWeeks,
      playoffRounds: league.playoffRounds,
      playoffRules: league.playoffRules,
      positionLimits: league.positionLimits,
      teams: league.teams.map((t) => ({
        id: t.id,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
        pointsAgainst: t.pointsAgainst,
        divisionId: t.divisionId,
        playoffSeed: t.playoffSeed,
        rosterCapacity: t.rosterCapacity,
        acquisitionsRemaining: t.acquisitionsRemaining,
        players: t.players.map(forecast),
      })),
      waiverWire: league.waiverWire
        ? {
            syncedAt: league.waiverWire.syncedAt,
            truncated: league.waiverWire.truncated,
            players: league.waiverWire.players.map((p) => ({
              ...forecast(p),
              availability: p.availability,
            })),
          }
        : undefined,
    },
  };
}
