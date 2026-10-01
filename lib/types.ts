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
