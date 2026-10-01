import { playerRosForecast, refreshPlayerRos } from './weekly-forecasts';
import type { BacktestStarter, BacktestTeamWeek } from './backtest';
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
  divisionId?: number;
  playoffSeed?: number;
  record?: {
    overall?: {
      wins?: number;
      losses?: number;
      ties?: number;
      pointsFor?: number;
      pointsAgainst?: number;
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
      playoffSeedingRule?: string;
      divisions?: { id: number; name?: string }[];
      playoffReseed?: boolean;
    };
    scoringSettings?: {
      scoringItems?: { statId: number; points: number }[];
      matchupTieRule?: string;
      playoffMatchupTieRule?: string;
      scoringEnhancementType?: string;
    };
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
    home?: {
      teamId?: number;
      totalPoints?: number;
      pointsByScoringPeriod?: Record<number, number>;
    };
    away?: {
      teamId?: number;
      totalPoints?: number;
      pointsByScoringPeriod?: Record<number, number>;
    };
    winner?: string;
    playoffTierType?: string;
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
    if (normalized.projectedPointsPerGame !== null)
      player.projectedPointsPerGame = normalized.projectedPointsPerGame;
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
  const avg =
    finite(seasonStat?.appliedAverage) ??
    (seasonPoints === null ? null : seasonPoints / 17);
  const result: Player = {
    projectedPointsPerGame: avg,
    id: p.id,
    name: p.fullName ?? `Player ${p.id}`,
    position,
    nflTeam: nfl[p.proTeamId ?? 0] ?? 'FA',
    slot: slotNames[slotId] ?? `Slot ${slotId}`,
    slotId,
    eligibleSlots: (p.eligibleSlots ?? []).filter((id) => !isIDPSlot(id)),
    status: p.injuryStatus ?? 'UNKNOWN',
    weekly,
    ros: null,
    season: seasonPoints,
    actual,
    projectionSource: 'unavailable',
    weeklyProjections: weeklyPoints(stats, 1),
    weeklyActuals: weeklyPoints(stats, 0),
    percentOwned: finite(p.ownership?.percentOwned),
    percentStarted: finite(p.ownership?.percentStarted),
    ...(p.byeWeek !== undefined ? { byeWeek: p.byeWeek } : {}),
  };
  const consistent = playerRosForecast(result, { week, finalWeek });
  result.ros = consistent.points;
  result.projectionSource =
    consistent.points === null
      ? 'unavailable'
      : consistent.estimated
        ? 'estimate'
        : 'weekly-sum';
  return result;
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
      divisionId: t.divisionId,
      playoffSeed: t.playoffSeed,
      pointsAgainst: record?.pointsAgainst,
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
      `${estimated} ROS projections are estimates: sum of weekly forecasts, with missing weeks estimated independently from ESPN projected points per game. Known byes contribute zero; estimates have no opponent adjustment.`,
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
  const playoffRounds = Object.entries(schedule?.matchupPeriods ?? {})
    .filter(([id]) => Number(id) > (schedule?.matchupPeriodCount ?? Infinity))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, weeks]) => weeks.filter((w) => w <= finalWeek))
    .filter((weeks) => weeks.length);
  return {
    ...(schedule
      ? {
          playoffRules: {
            seeding: schedule.playoffSeedingRule ?? 'UNKNOWN',
            matchupTie: raw.settings?.scoringSettings?.matchupTieRule ?? 'NONE',
            // ESPN reports its default playoff tiebreaker (higher seed advances) as NONE.
            playoffTie:
              raw.settings?.scoringSettings?.playoffMatchupTieRule === 'NONE'
                ? 'HIGHER_SEED'
                : (raw.settings?.scoringSettings?.playoffMatchupTieRule ??
                  'UNKNOWN'),
            divisionWinners: (schedule.divisions?.length ?? 0) > 1,
            reseed: schedule.playoffReseed ?? false,
            ...(raw.settings?.scoringSettings?.scoringEnhancementType &&
            raw.settings.scoringSettings.scoringEnhancementType !== 'NONE'
              ? {
                  unsupported:
                    'Additional scoring or median-win rules are unsupported.',
                }
              : {}),
          },
          ...(playoffRounds.length ? { playoffRounds } : {}),
        }
      : {}),
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
                ...(finite(matchup.home?.totalPoints) !== null
                  ? { homePoints: matchup.home!.totalPoints }
                  : {}),
                ...(finite(matchup.away?.totalPoints) !== null
                  ? { awayPoints: matchup.away!.totalPoints }
                  : {}),
                ...(matchup.home?.pointsByScoringPeriod
                  ? { homeActuals: matchup.home.pointsByScoringPeriod }
                  : {}),
                ...(matchup.away?.pointsByScoringPeriod
                  ? { awayActuals: matchup.away.pointsByScoringPeriod }
                  : {}),
                ...(matchup.winner === 'HOME'
                  ? { winnerId: homeId }
                  : matchup.winner === 'AWAY'
                    ? { winnerId: awayId }
                    : {}),
                ...(matchup.playoffTierType &&
                matchup.playoffTierType !== 'NONE'
                  ? { playoff: true }
                  : {}),
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

// Live state comes from the NFL clock, never from a nonzero fantasy score or
// a guessed three-hour game duration. This also locks bench players at kickoff.
export async function enrichLiveGames(league: League): Promise<void> {
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${league.season}&seasontype=2&week=${league.week}&limit=100`,
    {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error('Live NFL game state unavailable.');
  const data = await response.json();
  if (
    !Array.isArray(data.events) ||
    (data.week?.number !== undefined && data.week.number !== league.week) ||
    (data.season?.year !== undefined && data.season.year !== league.season)
  )
    throw new Error('Missing live NFL games for the requested week.');
  const games = new Map<
    string,
    { state: 'scheduled' | 'in-progress' | 'final'; remainingFraction: number }
  >();
  for (const event of data.events) {
    const status = event.status;
    if (!status?.type || !['pre', 'in', 'post'].includes(status.type.state))
      continue;
    const state = status.type.completed
      ? 'final'
      : status.type.state === 'in'
        ? 'in-progress'
        : 'scheduled';
    if (status.type.state === 'post' && !status.type.completed) continue;
    const fraction =
      state === 'final'
        ? 0
        : state === 'scheduled'
          ? 1
          : status.period > 4
            ? 0.15
            : Math.max(
                0,
                Math.min(1, ((4 - status.period) * 900 + status.clock) / 3600),
              );
    if (!Number.isFinite(fraction)) continue;
    for (const competitor of event.competitions?.[0]?.competitors ?? []) {
      const abbreviation = competitor.team?.abbreviation;
      if (abbreviation)
        games.set(abbreviation === 'WSH' ? 'WSH' : abbreviation, {
          state,
          remainingFraction: fraction,
        });
    }
  }
  if (!games.size) throw new Error('Missing live NFL game state.');
  for (const p of [
    ...league.teams.flatMap((t) => t.players),
    ...(league.waiverWire?.players ?? []),
  ]) {
    const game = games.get(p.nflTeam);
    if (game && game.state !== 'scheduled') p.transactionLocked = true;
    if (game)
      p.currentGame = {
        ...game,
        week: league.week,
        actual: p.weeklyActuals?.[league.week] ?? null,
        lockedSlotId: p.slotId,
      };
  }
}

export { refreshPlayerRos };

type RawBoxscoreSide = {
  teamId?: number;
  rosterForCurrentScoringPeriod?: {
    entries?: {
      lineupSlotId: number;
      playerPoolEntry?: { appliedStatTotal?: number; player?: RawPlayer };
    }[];
  };
};
export type ESPNBoxscoreResponse = {
  schedule?: { home?: RawBoxscoreSide; away?: RawBoxscoreSide }[];
};

// Starters for one completed scoring period with the projection ESPN held for
// that week. Team-weeks with an unprojected starter are skipped, not guessed.
export function parseBacktestWeek(
  raw: ESPNBoxscoreResponse,
  season: number,
  week: number,
): { teamWeeks: BacktestTeamWeek[]; skipped: number } {
  const teamWeeks: BacktestTeamWeek[] = [];
  let skipped = 0;
  for (const matchup of raw.schedule ?? []) {
    for (const side of [matchup.home, matchup.away]) {
      const entries = side?.rosterForCurrentScoringPeriod?.entries;
      if (!side || !Number.isInteger(side.teamId) || !entries?.length) continue;
      const starters: BacktestStarter[] = [];
      const bench: BacktestStarter[] = [];
      let complete = true;
      for (const entry of entries) {
        const p = entry.playerPoolEntry?.player;
        if (
          !p ||
          [21, 25].includes(entry.lineupSlotId) ||
          isIDPSlot(entry.lineupSlotId) ||
          !isSupportedPlayer(p)
        )
          continue;
        const benched = entry.lineupSlotId === 20;
        const stat = (source: number) =>
          finite(
            p.stats?.find(
              (s) =>
                s.seasonId === season &&
                s.statSourceId === source &&
                s.statSplitTypeId === 1 &&
                s.scoringPeriodId === week,
            )?.appliedTotal,
          );
        const projection = stat(1);
        if (projection === null) {
          // An unprojected bench player is left out; a starter voids the week.
          if (benched) continue;
          complete = false;
          break;
        }
        (benched ? bench : starters).push({
          id: p.id,
          position: pos[p.defaultPositionId!]!,
          nflTeam: nfl[p.proTeamId ?? 0] ?? 'FA',
          projection,
          // Inactive players have no stat line and scored zero.
          actual:
            stat(0) ?? finite(entry.playerPoolEntry?.appliedStatTotal) ?? 0,
        });
      }
      if (complete && starters.length)
        teamWeeks.push({ week, teamId: side.teamId!, starters, bench });
      else skipped++;
    }
  }
  return { teamWeeks, skipped };
}

export async function fetchBacktestWeek(
  leagueUrl: URL,
  headers: Record<string, string>,
  season: number,
  week: number,
) {
  const url = new URL(leagueUrl);
  url.searchParams.delete('view');
  for (const view of ['mMatchupScore', 'mScoreboard', 'mBoxscore'])
    url.searchParams.append('view', view);
  url.searchParams.set('scoringPeriodId', String(week));
  const response = await fetch(url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Week ${week} box scores unavailable (HTTP ${response.status}).`,
      ),
      { status: response.status },
    );
  return parseBacktestWeek(
    (await response.json()) as ESPNBoxscoreResponse,
    season,
    week,
  );
}
