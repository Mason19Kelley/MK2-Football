import {
  League,
  Player,
  Position,
  Team,
  slotNames,
  isIDPSlot,
  FANTASY_FINAL_WEEK,
} from './types';
type Stats = {
  seasonId?: number;
  statSourceId?: number;
  statSplitTypeId?: number;
  scoringPeriodId?: number;
  appliedTotal?: number;
  appliedAverage?: number;
};
export type RawPlayer = {
  id: number;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  eligibleSlots?: number[];
  injuryStatus?: string;
  byeWeek?: number;
  stats?: Stats[];
  ownership?: { percentOwned?: number; percentStarted?: number };
};
type RawTeam = {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  owners?: string[];
  record?: {
    overall?: {
      wins?: number;
      losses?: number;
      ties?: number;
      pointsFor?: number;
    };
  };
  roster?: {
    entries?: {
      lineupSlotId: number;
      playerPoolEntry?: { player?: RawPlayer };
    }[];
  };
};
export type ESPNResponse = {
  id: number;
  seasonId?: number;
  scoringPeriodId?: number;
  status?: { finalScoringPeriod?: number };
  settings?: {
    name?: string;
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    scheduleSettings?: {
      matchupPeriodCount?: number;
      matchupPeriodLength?: number;
      playoffTeamCount?: number;
      playoffMatchupPeriodLength?: number;
      matchupPeriods?: Record<string, number[]>;
    };
    scoringSettings?: { scoringItems?: { statId: number; points: number }[] };
  };
  members?: {
    id: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
  }[];
  teams?: RawTeam[];
  schedule?: {
    id?: number;
    matchupPeriodId?: number;
    home?: { teamId?: number };
    away?: { teamId?: number };
  }[];
};
const nfl: Record<number, string> = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WSH',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
};
const pos: Record<number, Position> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  15: 'QB',
  16: 'D/ST',
};
export const isSupportedPlayer = (p: RawPlayer) =>
  pos[p.defaultPositionId ?? 0] !== undefined;
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function weeklyPoints(stats: Stats[], source: number): Record<number, number> {
  return Object.fromEntries(
    stats
      .filter(
        (s) =>
          s.statSourceId === source &&
          s.statSplitTypeId === 1 &&
          Number.isInteger(s.scoringPeriodId) &&
          s.scoringPeriodId! >= 1 &&
          s.scoringPeriodId! <= FANTASY_FINAL_WEEK &&
          finite(s.appliedTotal) !== null,
      )
      .map((s) => [s.scoringPeriodId!, s.appliedTotal!]),
  );
}

// Request all available weekly splits, plus season totals, in league scoring.
export function seasonStatsFilter() {
  return {
    filterStatsForScoringPeriodIds: {
      value: Array.from({ length: FANTASY_FINAL_WEEK + 1 }, (_, week) => week),
    },
    filterStatsForSourceIds: { value: [0, 1] },
  };
}

export async function enrichRosterStats(
  leagueUrl: URL,
  headers: Record<string, string>,
  league: League,
): Promise<void> {
  const players = league.teams.flatMap((team) => team.players);
  if (!players.length) return;
  const url = new URL(leagueUrl);
  url.searchParams.delete('view');
  url.searchParams.set('view', 'kona_playercard');
  url.searchParams.set('scoringPeriodId', String(league.week));
  const response = await fetch(url, {
    headers: {
      ...headers,
      'x-fantasy-filter': JSON.stringify({
        players: {
          filterIds: { value: players.map((p) => p.id) },
          ...seasonStatsFilter(),
        },
      }),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Player season stats unavailable.');
  const data = await response.json();
  if (!Array.isArray(data.players)) throw new Error('Missing player stats.');
  const rawPlayers = new Map<number, RawPlayer>(
    data.players
      .filter((entry: { player?: RawPlayer }) => entry.player)
      .map((entry: { player: RawPlayer }) => [entry.player.id, entry.player]),
  );
  for (const player of players) {
    const raw = rawPlayers.get(player.id);
    if (!raw) continue;
    const normalized = normalizePlayer(
      raw,
      league.season,
      league.week,
      league.finalWeek,
      player.slotId,
    );
    player.weeklyProjections = {
      ...player.weeklyProjections,
      ...normalized.weeklyProjections,
    };
    player.weeklyActuals = {
      ...player.weeklyActuals,
      ...normalized.weeklyActuals,
    };
    player.percentOwned = normalized.percentOwned;
    player.percentStarted = normalized.percentStarted;
    if (normalized.season !== null) player.season = normalized.season;
    if (normalized.actual !== null) player.actual = normalized.actual;
    if (normalized.weekly !== null) player.weekly = normalized.weekly;
    if (normalized.ros !== null) {
      player.ros = normalized.ros;
      player.projectionSource = normalized.projectionSource;
    }
  }
}

export function normalizePlayer(
  p: RawPlayer,
  season: number,
  week: number,
  finalWeek: number,
  slotId = 20,
): Player {
  finalWeek = Math.min(finalWeek, FANTASY_FINAL_WEEK);
  const position = pos[p.defaultPositionId ?? 0];
  if (!position) throw new Error('Unsupported player position.');
  const stats = (p.stats ?? []).filter((s) => s.seasonId === season);
  const seasonStat = stats.find(
    (s) =>
      s.statSourceId === 1 &&
      s.statSplitTypeId === 0 &&
      s.scoringPeriodId === 0,
  );
  const seasonPoints = finite(seasonStat?.appliedTotal);
  const actual = finite(
    stats.find(
      (s) =>
        s.statSourceId === 0 &&
        s.statSplitTypeId === 0 &&
        s.scoringPeriodId === 0,
    )?.appliedTotal,
  );
  const weekly = finite(
    stats.find(
      (s) =>
        s.statSourceId === 1 &&
        s.statSplitTypeId === 1 &&
        s.scoringPeriodId === week &&
        week <= finalWeek,
    )?.appliedTotal,
  );
  const remainingWeeks = Math.max(0, finalWeek - week + 1);
  const future = new Map(
    stats
      .filter(
        (s) =>
          s.statSourceId === 1 &&
          s.statSplitTypeId === 1 &&
          (s.scoringPeriodId ?? 0) >= week &&
          (s.scoringPeriodId ?? 0) <= finalWeek &&
          finite(s.appliedTotal) !== null,
      )
      .map((s) => [s.scoringPeriodId!, s.appliedTotal!]),
  );
  const avg =
    finite(seasonStat?.appliedAverage) ??
    (seasonPoints === null ? null : seasonPoints / 17);
  let ros: number | null = null;
  let projectionSource: Player['projectionSource'] = 'unavailable';
  if (remainingWeeks === 0) {
    ros = 0;
    projectionSource = 'weekly-sum';
  } else if (future.size === remainingWeeks) {
    ros = [...future.values()].reduce((s, v) => s + v, 0);
    projectionSource = 'weekly-sum';
  } else if (avg !== null) {
    ros = Math.round(avg * remainingWeeks * 10) / 10;
    projectionSource = 'estimate';
  }
  return {
    id: p.id,
    name: p.fullName ?? `Player ${p.id}`,
    position,
    nflTeam: nfl[p.proTeamId ?? 0] ?? 'FA',
    slot: slotNames[slotId] ?? `Slot ${slotId}`,
    slotId,
    eligibleSlots: (p.eligibleSlots ?? []).filter((id) => !isIDPSlot(id)),
    status: p.injuryStatus ?? 'UNKNOWN',
    weekly,
    ros,
    season:
      seasonPoints === null
        ? null
        : seasonPoints -
          (finite(
            stats.find(
              (s) =>
                s.statSourceId === 1 &&
                s.statSplitTypeId === 1 &&
                s.scoringPeriodId === 18,
            )?.appliedTotal,
          ) ??
            avg ??
            0),
    actual,
    projectionSource,
    weeklyProjections: weeklyPoints(stats, 1),
    weeklyActuals: weeklyPoints(stats, 0),
    percentOwned: finite(p.ownership?.percentOwned),
    percentStarted: finite(p.ownership?.percentStarted),
    ...(p.byeWeek !== undefined ? { byeWeek: p.byeWeek } : {}),
  };
}
export function normalizeLeague(raw: ESPNResponse, season: number): League {
  if (!Array.isArray(raw.teams) || !raw.teams.length)
    throw new Error(
      'ESPN returned no teams. Check your league ID, season, and access.',
    );
  const week = raw.scoringPeriodId ?? 1,
    finalWeek = Math.min(
      raw.status?.finalScoringPeriod ?? FANTASY_FINAL_WEEK,
      FANTASY_FINAL_WEEK,
    );
  let estimated = 0,
    unavailable = 0;
  const slotCounts = raw.settings?.rosterSettings?.lineupSlotCounts;
  const rosterCapacity = slotCounts
    ? Object.entries(slotCounts)
        .filter(([id]) => ![21, 25].includes(Number(id)))
        .reduce((sum, [, count]) => sum + count, 0)
    : undefined;
  const teams: Team[] = raw.teams.map((t) => {
    const record = t.record?.overall;
    const players: Player[] = (t.roster?.entries ?? []).flatMap((entry) => {
      const p = entry.playerPoolEntry?.player;
      if (!p || !isSupportedPlayer(p) || isIDPSlot(entry.lineupSlotId))
        return [];
      const player = normalizePlayer(
        p,
        season,
        week,
        finalWeek,
        entry.lineupSlotId,
      );
      if (player.projectionSource === 'estimate') estimated++;
      if (player.projectionSource === 'unavailable') unavailable++;
      return [player];
    });
    const owners = (t.owners ?? [])
      .map((id) => raw.members?.find((m) => m.id === id))
      .filter(Boolean)
      .map(
        (m) =>
          m!.displayName ??
          [m!.firstName, m!.lastName].filter(Boolean).join(' '),
      )
      .filter(Boolean);
    const hiddenRosterSpots = (t.roster?.entries ?? []).filter(
      (entry) =>
        ![21, 25].includes(entry.lineupSlotId) &&
        Boolean(entry.playerPoolEntry?.player) &&
        (!isSupportedPlayer(entry.playerPoolEntry!.player!) ||
          isIDPSlot(entry.lineupSlotId)),
    ).length;
    return {
      ...(rosterCapacity !== undefined
        ? { rosterCapacity: Math.max(0, rosterCapacity - hiddenRosterSpots) }
        : {}),
      id: t.id,
      name:
        t.name ??
        ([t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`),
      abbreviation: t.abbrev ?? `T${t.id}`,
      owner: owners.join(' & ') || 'League manager',
      wins: record?.wins ?? 0,
      losses: record?.losses ?? 0,
      ties: record?.ties ?? 0,
      pointsFor: record?.pointsFor ?? 0,
      players,
    };
  });
  const ppr =
    raw.settings?.scoringSettings?.scoringItems?.find((s) => s.statId === 53)
      ?.points ?? 0;
  const slots = Object.entries(
    raw.settings?.rosterSettings?.lineupSlotCounts ?? {},
  )
    .filter(
      ([id, count]) =>
        count > 0 &&
        ![20, 21, 25].includes(Number(id)) &&
        !isIDPSlot(Number(id)),
    )
    .map(([id, count]) => ({
      id: Number(id),
      label: slotNames[Number(id)] ?? `Slot ${id}`,
      count,
    }));
  const warnings: string[] = [];
  if (estimated)
    warnings.push(
      `${estimated} ROS projections are estimates: ESPN projected season average × remaining league weeks, including the current week. Future byes, injuries, and schedule strength are not adjusted.`,
    );
  if (unavailable)
    warnings.push(
      `${unavailable} players have no ROS projection. Missing values are shown as — and excluded from totals.`,
    );
  if (!slots.length)
    warnings.push(
      'ESPN did not return starting lineup settings; trade lineup comparisons are unavailable.',
    );
  const schedule = raw.settings?.scheduleSettings;
  const regularWeeks = Object.entries(schedule?.matchupPeriods ?? {})
    .filter(([id]) => Number(id) <= (schedule?.matchupPeriodCount ?? 0))
    .flatMap(([, weeks]) => weeks);
  const regularEnd = regularWeeks.length
    ? Math.max(...regularWeeks)
    : (schedule?.matchupPeriodCount ?? 0) *
      (schedule?.matchupPeriodLength ?? 1);
  return {
    ...(schedule?.playoffTeamCount !== undefined
      ? { playoffTeamCount: schedule.playoffTeamCount }
      : {}),
    ...(schedule?.playoffMatchupPeriodLength !== undefined
      ? { playoffRoundWeeks: schedule.playoffMatchupPeriodLength }
      : {}),
    ...(raw.schedule
      ? {
          matchups: raw.schedule.flatMap((matchup, index) => {
            const period = matchup.matchupPeriodId;
            const homeId = matchup.home?.teamId,
              awayId = matchup.away?.teamId;
            if (
              !Number.isInteger(period) ||
              !Number.isInteger(homeId) ||
              !Number.isInteger(awayId)
            )
              return [];
            const length = schedule?.matchupPeriodLength ?? 1;
            const weeks =
              schedule?.matchupPeriods?.[String(period)] ??
              Array.from(
                { length },
                (_, offset) => (period! - 1) * length + offset + 1,
              );
            return [
              {
                id: matchup.id ?? index,
                weeks: weeks.filter((w) => w <= finalWeek),
                homeId: homeId!,
                awayId: awayId!,
              },
            ];
          }),
        }
      : {}),
    ...(regularEnd > 0 && regularEnd < finalWeek
      ? { playoffStartWeek: regularEnd + 1 }
      : {}),
    id: String(raw.id),
    name: raw.settings?.name ?? 'ESPN League',
    season,
    week,
    finalWeek,
    scoring:
      ppr === 1
        ? 'PPR'
        : ppr === 0.5
          ? 'Half PPR'
          : ppr === 0
            ? 'Standard'
            : `${ppr} PPR`,
    source: 'espn',
    syncedAt: new Date().toISOString(),
    teams,
    slots,
    warnings,
  };
}
export function parseLeagueId(input: string): string {
  const trimmed = input.trim();
  if (/^\d{1,12}$/.test(trimmed) && Number(trimmed) > 0)
    return String(Number(trimmed));
  try {
    const url = new URL(trimmed);
    if (
      !['fantasy.espn.com', 'www.espn.com', 'espn.com'].includes(url.hostname)
    )
      throw new Error();
    const id = url.searchParams.get('leagueId');
    if (id && /^\d{1,12}$/.test(id) && Number(id) > 0)
      return String(Number(id));
  } catch {}
  throw new Error(
    'Enter an ESPN league ID or a league URL containing leagueId.',
  );
}

// Public season metadata contains an explicit byeWeek; an absent schedule
// never becomes an invented bye. This enriches roster and waiver snapshots.
export async function enrichByeWeeks(league: League): Promise<void> {
  const response = await fetch(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${league.season}?view=proTeamSchedules_wl`,
    {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error('NFL bye schedule unavailable.');
  const data = await response.json();
  if (!Array.isArray(data.settings?.proTeams))
    throw new Error('Missing NFL schedule.');
  const byes = new Map<string, number>();
  for (const team of data.settings.proTeams) {
    if (
      nfl[team.id] &&
      Number.isInteger(team.byeWeek) &&
      team.byeWeek >= 0 &&
      team.byeWeek <= 18
    )
      byes.set(nfl[team.id], team.byeWeek);
  }
  if (!byes.size) throw new Error('Missing NFL bye weeks.');
  for (const p of [
    ...league.teams.flatMap((t) => t.players),
    ...(league.waiverWire?.players ?? []),
  ]) {
    const bye = byes.get(p.nflTeam);
    if (bye !== undefined) p.byeWeek = bye;
  }
}
