export const FANTASY_FINAL_WEEK = 17;
export const fantasyFinalWeek = (league: Pick<League, 'finalWeek'>) =>
  Math.min(league.finalWeek, FANTASY_FINAL_WEEK);

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'D/ST' | 'K';
export type Player = {
  id: number;
  name: string;
  position: Position;
  nflTeam: string;
  slot: string;
  slotId: number;
  eligibleSlots: number[];
  status: string;
  weekly: number | null;
  ros: number | null;
  season: number | null;
  actual: number | null;
  projectionSource:
    'sample' | 'estimate' | 'weekly-sum' | 'unavailable' | 'custom';
  weeklyProjections?: Record<number, number>;
  weeklyActuals?: Record<number, number>;
  percentOwned?: number | null;
  percentStarted?: number | null;
  byeWeek?: number;
  weeklyOverrides?: Record<number, number>;
  projectionBounds?: {
    ros?: { lower: number; upper: number };
    weekly?: Record<number, { lower: number; upper: number }>;
  };
  forecastUpdatedAt?: string;
  forecastProvenance?: string;
  availabilityProbability?: number;
  returnWeek?: number;
  scoreStdDev?: number;
  roleStdDev?: number;
  transactionLocked?: boolean;
};
export type WaiverPlayer = Player & {
  availability: 'FREEAGENT' | 'WAIVERS';
  percentOwned: number | null;
};
export type WaiverWire = {
  players: WaiverPlayer[];
  syncedAt: string;
  truncated: boolean;
};
export type Team = {
  id: number;
  name: string;
  abbreviation: string;
  owner: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  players: Player[];
  rosterCapacity?: number;
  acquisitionsRemaining?: number;
};
export type League = {
  id: string;
  name: string;
  season: number;
  week: number;
  finalWeek: number;
  scoring: string;
  source: 'demo' | 'espn';
  syncedAt: string;
  teams: Team[];
  slots: { id: number; label: string; count: number }[];
  warnings: string[];
  waiverWire?: WaiverWire;
  playoffStartWeek?: number;
  playoffTeamCount?: number;
  playoffRoundWeeks?: number;
  matchups?: { id: number; weeks: number[]; homeId: number; awayId: number }[];
  positionLimits?: Partial<Record<Position, number>>;
  tradesLocked?: boolean;
};
export const slotNames: Record<number, string> = {
  0: 'QB',
  1: 'TQB',
  2: 'RB',
  3: 'RB/WR',
  4: 'WR',
  5: 'WR/TE',
  6: 'TE',
  7: 'OP',
  16: 'D/ST',
  17: 'K',
  18: 'P',
  19: 'HC',
  20: 'BN',
  21: 'IR',
  23: 'FLEX',
  25: 'RES',
};
export const positions = ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'] as const;
export const isIDPSlot = (id: number) => (id >= 8 && id <= 15) || id === 24;

// Also applies to older browser snapshots with positions no longer supported.
export function removeIDPPlayers(league: League): League {
  const supported = (p: Player) =>
    positions.includes(p.position) && !isIDPSlot(p.slotId);
  const clean = <T extends Player>(p: T): T => ({
    ...p,
    eligibleSlots: p.eligibleSlots.filter((id) => !isIDPSlot(id)),
  });
  league = normalizeFantasySeason(league);
  return {
    ...league,
    teams: league.teams.map((t) => ({
      ...t,
      players: t.players.filter(supported).map(clean),
    })),
    slots: league.slots.filter((s) => !isIDPSlot(s.id)),
    ...(league.waiverWire
      ? {
          waiverWire: {
            ...league.waiverWire,
            players: league.waiverWire.players.filter(supported).map(clean),
          },
        }
      : {}),
  };
}
// Migrate saved snapshots once, before projections reach any dashboard totals.
export function normalizeFantasySeason(league: League): League {
  const finalWeek = fantasyFinalWeek(league);
  const trim = <T>(values: Record<number, T> | undefined) =>
    values &&
    Object.fromEntries(
      Object.entries(values).filter(([w]) => Number(w) <= finalWeek),
    );
  const clean = <T extends Player>(p: T): T => {
    const oldWeeks = Math.max(0, league.finalWeek - league.week + 1);
    const newWeeks = Math.max(0, finalWeek - league.week + 1);
    const adjust = (value: number | null) => {
      if (value === null || oldWeeks === newWeeks) return value;
      if (!newWeeks) return 0;
      const excluded = Array.from(
        { length: league.finalWeek - finalWeek },
        (_, i) => finalWeek + i + 1,
      ).filter((w) => w >= league.week);
      if (
        p.projectionSource === 'weekly-sum' &&
        excluded.every((w) => Number.isFinite(p.weeklyProjections?.[w]))
      )
        return (
          value - excluded.reduce((sum, w) => sum + p.weeklyProjections![w], 0)
        );
      return (value * newWeeks) / oldWeeks;
    };
    return {
      ...p,
      ros: adjust(p.ros),
      season:
        league.finalWeek > finalWeek && p.season !== null
          ? p.season - (p.weeklyProjections?.[18] ?? p.season / 17)
          : p.season,
      weekly: league.week > finalWeek ? null : p.weekly,
      weeklyProjections: trim(p.weeklyProjections),
      weeklyActuals: trim(p.weeklyActuals),
      weeklyOverrides: trim(p.weeklyOverrides),
      ...(p.projectionBounds
        ? {
            projectionBounds: {
              ros: p.projectionBounds.ros && {
                lower: adjust(p.projectionBounds.ros.lower)!,
                upper: adjust(p.projectionBounds.ros.upper)!,
              },
              weekly: trim(p.projectionBounds.weekly),
            },
          }
        : {}),
    };
  };
  return {
    ...league,
    finalWeek,
    teams: league.teams.map((t) => ({ ...t, players: t.players.map(clean) })),
    ...(league.waiverWire
      ? {
          waiverWire: {
            ...league.waiverWire,
            players: league.waiverWire.players.map(clean),
          },
        }
      : {}),
    ...(league.matchups
      ? {
          matchups: league.matchups
            .map((m) => ({
              ...m,
              weeks: m.weeks.filter((w) => w <= finalWeek),
            }))
            .filter((m) => m.weeks.length),
        }
      : {}),
  };
}
export const points = (n: number | null) =>
  n === null
    ? '—'
    : n.toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
export const active = (p: Player) => ![20, 21, 25].includes(p.slotId);
export function total(players: Player[], metric: 'weekly' | 'ros') {
  return players.reduce((sum, p) => sum + (p[metric] ?? 0), 0);
}
