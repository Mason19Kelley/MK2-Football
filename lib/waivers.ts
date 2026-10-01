import {
  normalizePlayer,
  RawPlayer,
  isSupportedPlayer,
  seasonStatsFilter,
} from './espn';
import { League, WaiverPlayer, WaiverWire, Player } from './types';
import { optimalLineup } from './trades';
export type RawWaiverEntry = {
  id: number;
  onTeamId?: number;
  status?: string;
  player?: RawPlayer;
};
export function normalizeWaiverPlayers(
  entries: RawWaiverEntry[],
  league: League,
): WaiverPlayer[] {
  const rostered = new Set(
    league.teams.flatMap((t) => t.players.map((p) => p.id)),
  );
  const seen = new Set<number>();
  return entries.flatMap((entry) => {
    const p = entry.player;
    if (
      !p ||
      !isSupportedPlayer(p) ||
      rostered.has(p.id) ||
      seen.has(p.id) ||
      entry.onTeamId !== 0 ||
      !['FREEAGENT', 'WAIVERS'].includes(entry.status ?? '')
    )
      return [];
    seen.add(p.id);
    return [
      {
        ...normalizePlayer(p, league.season, league.week, league.finalWeek),
        availability: entry.status as WaiverPlayer['availability'],
        percentOwned:
          typeof p.ownership?.percentOwned === 'number' &&
          Number.isFinite(p.ownership.percentOwned)
            ? p.ownership.percentOwned
            : null,
      },
    ];
  });
}
export async function fetchWaiverWire(
  leagueUrl: URL,
  headers: Record<string, string>,
  league: League,
): Promise<WaiverWire> {
  const pageSize = 500,
    maxPages = 8,
    entries: RawWaiverEntry[] = [];
  let truncated = false;
  const deadline = AbortSignal.timeout(30000);
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(leagueUrl);
    url.searchParams.delete('view');
    url.searchParams.set('view', 'kona_player_info');
    url.searchParams.set('scoringPeriodId', String(league.week));
    const response = await fetch(url, {
      headers: {
        ...headers,
        'x-fantasy-filter': JSON.stringify({
          players: {
            ...seasonStatsFilter(),
            filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
            filterActive: { value: true },
            limit: pageSize,
            offset: page * pageSize,
            sortPercOwned: { sortPriority: 1, sortAsc: false },
          },
        }),
      },
      cache: 'no-store',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) throw new Error('Waiver wire unavailable.');
    const data = await response.json();
    if (!Array.isArray(data.players))
      throw new Error('Missing waiver players.');
    entries.push(...data.players);
    if (data.players.length < pageSize) break;
    if (page === maxPages - 1) truncated = true;
  }
  return {
    players: normalizeWaiverPlayers(entries, league),
    syncedAt: new Date().toISOString(),
    truncated,
  };
}
export function compareWaiverMove(
  roster: Player[],
  add: WaiverPlayer,
  drop: Player | undefined,
  slots: League['slots'],
  metric: 'weekly' | 'ros',
) {
  if (drop && !roster.some((p) => p.id === drop.id))
    throw new Error('Drop player is not on your roster.');
  if (roster.some((p) => p.id === add.id))
    throw new Error('Player is already on your roster.');
  const before = optimalLineup(roster, slots, metric);
  const next = [
    ...roster.filter((p) => p.id !== drop?.id),
    { ...add, slotId: 20, slot: 'BN' },
  ];
  const after = optimalLineup(next, slots, metric);
  const complete =
    before.complete &&
    after.complete &&
    before.missing === 0 &&
    after.missing === 0;
  return {
    before,
    after,
    complete,
    delta: complete ? after.total - before.total : null,
  };
}
