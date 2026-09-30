export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K';
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
  17: 'K',
  18: 'P',
  19: 'HC',
  20: 'BN',
  21: 'IR',
  23: 'FLEX',
  25: 'RES',
};
export const positions = ['QB', 'RB', 'WR', 'TE', 'K'] as const;
export const isDefensiveSlot = (id: number) =>
  (id >= 8 && id <= 16) || id === 24;

// Also applies to older browser snapshots with positions no longer supported.
export function removeDefensivePlayers(league: League): League {
  const supported = (p: Player) =>
    positions.includes(p.position) && !isDefensiveSlot(p.slotId);
  const clean = <T extends Player>(p: T): T => ({
    ...p,
    eligibleSlots: p.eligibleSlots.filter((id) => !isDefensiveSlot(id)),
  });
  return {
    ...league,
    teams: league.teams.map((t) => ({
      ...t,
      players: t.players.filter(supported).map(clean),
    })),
    slots: league.slots.filter((s) => !isDefensiveSlot(s.id)),
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
