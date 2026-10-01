import { League, Player, WaiverPlayer, normalizeFantasySeason } from './types';
import { evaluateRoster, playerWeek } from './weekly-trades';
import { rosterMoveCandidates } from './trade-plans';

export type WaiverPickup = {
  add: WaiverPlayer;
  drops: Player[];
  before: number;
  after: number;
  gain: number;
  estimated: number;
};

// Each result is the best legal move for one pickup, scored with independently
// optimized weekly lineups. No hypothetical future streaming claims are added.
export function findWaiverPickups(input: League, teamId: number) {
  const league = normalizeFantasySeason(input);
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error('Choose a team in this league.');
  if (!league.waiverWire) throw new Error('Sync your waiver wire first.');
  const projectionCache = new Map<
    number,
    Map<number, ReturnType<typeof playerWeek>>
  >();
  const cache = new WeakMap<Player[], ReturnType<typeof evaluateRoster>>();
  const evaluate = (players: Player[]) => {
    let value = cache.get(players);
    if (!value) {
      value = evaluateRoster(
        league,
        players,
        'remaining',
        projectionCache,
        undefined,
        {
          streaming: false,
          streamSpecialists: false,
        },
      );
      value.usedPlayerIds = [
        ...new Set(value.weeks.flatMap((w) => w.players.map((p) => p.id))),
      ];
      cache.set(players, value);
    }
    return value;
  };
  const before = evaluate(team.players);
  if (!before.complete || before.missing)
    throw new Error(
      'Complete your team’s projections and starting slots before finding pickups.',
    );
  // Waiver claims and free agents both belong in the search. The shared roster
  // planner treats candidates as claimable; this never submits a transaction.
  const claimable: League = {
    ...league,
    waiverWire: {
      ...league.waiverWire,
      players: league.waiverWire.players.map((p) => ({
        ...p,
        availability: 'FREEAGENT',
      })),
    },
  };
  const moves = rosterMoveCandidates(claimable, team, team.players, [], {
    includePickup: true,
    evaluate,
    pruneUnusedDrops: true,
  });
  const pickups: WaiverPickup[] = [];
  for (const move of moves) {
    if (!move.pickup) continue;
    const after = evaluate(move.roster);
    const gain = after.total - before.total;
    if (!after.complete || after.missing || gain <= 0.000001) continue;
    pickups.push({
      add: league.waiverWire.players.find((p) => p.id === move.pickup!.id)!,
      drops: move.drops ?? [],
      before: before.total,
      after: after.total,
      gain,
      estimated: after.weeks.reduce((sum, w) => sum + w.estimated, 0),
    });
  }
  return {
    pickups: pickups.sort((a, b) => b.gain - a.gain || a.add.id - b.add.id),
    capacityEstimated: team.rosterCapacity === undefined,
  };
}
