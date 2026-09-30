import type { League } from './types';

export const tradeTypes = [
  'TRADE_PROPOSAL',
  'TRADE_ACCEPT',
  'TRADE_DECLINE',
  'TRADE_VETO',
  'TRADE_UPHOLD',
] as const;
type TradeType = (typeof tradeTypes)[number] | 'TRADE_COMPLETED';
export type TradeItem = {
  playerId: number;
  fromTeamId: number;
  toTeamId: number;
  action: 'TRADE' | 'DROP';
};
export type TradeEvent = {
  id: string;
  source: 'transactions' | 'activity';
  type: TradeType;
  status: string | null;
  executionType: string | null;
  relatedId: string | null;
  teamId: number | null;
  week: number | null;
  proposedAt: number | null;
  acceptedAt: number | null;
  processedAt: number | null;
  items: TradeItem[];
  packageComplete: boolean;
};
export type TradeExample = {
  offerId: string;
  outcomeEventId: string;
  accepted: boolean;
  items: TradeItem[];
  // Import-time forecasts/rosters must never be substituted for offer-time data.
  historicalFeatures: null;
};
export type TradeHistory = {
  version: 1;
  leagueId: string;
  season: number;
  fetchedAt: string;
  events: TradeEvent[];
  examples: TradeExample[];
  coverage: {
    requestedWeeks: number[];
    loadedWeeks: number[];
    activity: 'loaded' | 'unavailable' | 'truncated';
  };
  warnings: string[];
};
type RawItem = {
  type?: string;
  playerId?: number;
  fromTeamId?: number;
  toTeamId?: number;
};
export type RawTrade = {
  id?: string | number;
  type?: string;
  status?: string;
  executionType?: string;
  relatedTransactionId?: string | number;
  teamId?: number;
  scoringPeriodId?: number;
  proposedDate?: number;
  acceptedDate?: number;
  processDate?: number;
  items?: RawItem[];
};
export type RawTopic = {
  id?: string | number;
  date?: number;
  messages?: {
    messageTypeId?: number;
    from?: number;
    to?: number;
    targetId?: number;
  }[];
};
const number = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;
const id = (n: unknown): string | null =>
  (typeof n === 'string' && n.length > 0) ||
  (typeof n === 'number' && Number.isFinite(n))
    ? String(n)
    : null;
const team = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
function validItems(items: RawItem[]): TradeItem[] {
  const found = new Map<string, TradeItem>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (
      !Number.isInteger(item.playerId) ||
      item.playerId! <= 0 ||
      !team(item.fromTeamId)
    )
      continue;
    if (item.type !== 'TRADE' && item.type !== 'DROP') continue;
    if (
      item.type === 'TRADE' &&
      (!team(item.toTeamId) || item.fromTeamId === item.toTeamId)
    )
      continue;
    if (item.type === 'DROP' && item.toTeamId !== 0) continue;
    const clean: TradeItem = {
      playerId: item.playerId!,
      fromTeamId: item.fromTeamId!,
      toTeamId: item.toTeamId!,
      action: item.type,
    };
    found.set(JSON.stringify(clean), clean);
  }
  return [...found.values()];
}
export function normalizeTrade(raw: RawTrade): TradeEvent | null {
  const key = id(raw.id);
  if (!key || !tradeTypes.includes(raw.type as (typeof tradeTypes)[number]))
    return null;
  return {
    id: key,
    source: 'transactions',
    type: raw.type as TradeType,
    status: typeof raw.status === 'string' ? raw.status : null,
    executionType:
      typeof raw.executionType === 'string' ? raw.executionType : null,
    relatedId: id(raw.relatedTransactionId),
    teamId: team(raw.teamId) ? raw.teamId! : null,
    week: number(raw.scoringPeriodId),
    proposedAt: number(raw.proposedDate),
    acceptedAt: number(raw.acceptedDate),
    processedAt: number(raw.processDate),
    items: validItems(Array.isArray(raw.items) ? raw.items : []),
    packageComplete:
      Array.isArray(raw.items) &&
      raw.items.length > 0 &&
      validItems(raw.items).length === raw.items.length &&
      completePackage(validItems(raw.items)),
  };
}
export function normalizeTradeActivity(raw: RawTopic): TradeEvent | null {
  const key = id(raw.id);
  const items = validItems(
    (Array.isArray(raw.messages) ? raw.messages : [])
      .filter((m) => m.messageTypeId === 244)
      .map((m) => ({
        type: 'TRADE',
        playerId: m.targetId,
        fromTeamId: m.from,
        toTeamId: m.to,
      })),
  );
  if (!key || !items.length) return null;
  return {
    id: key,
    source: 'activity',
    type: 'TRADE_COMPLETED',
    status: 'EXECUTED',
    executionType: 'EXECUTE',
    relatedId: null,
    teamId: null,
    week: null,
    proposedAt: null,
    acceptedAt: null,
    processedAt: number(raw.date),
    items,
    packageComplete: completePackage(items),
  };
}
const signature = (items: TradeItem[]) =>
  items
    .map((i) => JSON.stringify(i))
    .sort()
    .join('|');
export function completePackage(items: TradeItem[]) {
  const legs = items.filter((i) => i.action === 'TRADE');
  const teams = new Set(legs.flatMap((i) => [i.fromTeamId, i.toTeamId]));
  return (
    legs.length >= 2 &&
    teams.size === 2 &&
    new Set(legs.map((i) => i.fromTeamId)).size === 2 &&
    new Set(legs.map((i) => i.playerId)).size === legs.length
  );
}
// Only exact ESPN ID links can recover a hidden package; no player/date guesses.
export function buildTradeExamples(events: TradeEvent[]): TradeExample[] {
  const transactions = events.filter((e) => e.source === 'transactions');
  const byId = new Map(transactions.map((e) => [e.id, e]));
  const neighbors = new Map<string, Set<string>>();
  for (const e of transactions) {
    if (!e.relatedId || !byId.has(e.relatedId)) continue;
    for (const [a, b] of [
      [e.id, e.relatedId],
      [e.relatedId, e.id],
    ]) {
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      neighbors.get(a)!.add(b);
    }
  }
  const seen = new Set<string>();
  const examples: TradeExample[] = [];
  for (const root of transactions) {
    if (seen.has(root.id)) continue;
    const component: TradeEvent[] = [],
      pending = [root.id];
    while (pending.length) {
      const key = pending.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      component.push(byId.get(key)!);
      pending.push(...(neighbors.get(key) ?? []));
    }
    const outcomes = component.filter(
      (e) =>
        ['TRADE_ACCEPT', 'TRADE_DECLINE'].includes(e.type) &&
        e.executionType === 'EXECUTE' &&
        !['CANCELED', 'PENDING', 'FAILED'].includes(e.status ?? ''),
    );
    // Conflicting outcomes or vetoes cannot be treated as clean binary labels.
    if (
      !outcomes.length ||
      new Set(outcomes.map((e) => e.type)).size !== 1 ||
      component.some((e) => e.type === 'TRADE_VETO')
    )
      continue;
    const packages = component.filter((e) => e.packageComplete);
    if (
      !packages.length ||
      new Set(packages.map((e) => signature(e.items))).size !== 1
    )
      continue;
    // A nonempty partial or changed offer must not be repaired from another version.
    if (
      component.some(
        (e) =>
          e.items.length > 0 &&
          (!e.packageComplete ||
            signature(e.items) !== signature(packages[0].items)),
      )
    )
      continue;
    const outcome = outcomes.sort((a, b) => a.id.localeCompare(b.id))[0];
    const offer = component.find((e) => e.type === 'TRADE_PROPOSAL') ?? outcome;
    examples.push({
      offerId: offer.id,
      outcomeEventId: outcome.id,
      accepted: outcome.type === 'TRADE_ACCEPT',
      items: packages[0].items,
      historicalFeatures: null,
    });
  }
  return examples;
}

export async function fetchTradeHistory(
  leagueUrl: URL,
  headers: Record<string, string>,
  league: Pick<League, 'id' | 'season' | 'week' | 'finalWeek'>,
  fetcher: typeof fetch = fetch,
): Promise<TradeHistory> {
  const deadline = AbortSignal.timeout(60000);
  const lastWeek = Math.max(0, Math.min(25, league.week, league.finalWeek));
  const requestedWeeks = Array.from({ length: lastWeek + 1 }, (_, i) => i);
  const loadedWeeks: number[] = [],
    warnings: string[] = [];
  const events = new Map<string, TradeEvent>();
  const remember = (event: TradeEvent | null) => {
    if (!event) return;
    const key = `${event.source}:${event.id}`,
      previous = events.get(key);
    if (!previous || event.items.length > previous.items.length)
      events.set(key, event);
  };
  const read = async (url: URL, filter: unknown) => {
    const response = await fetcher(url, {
      headers: { ...headers, 'x-fantasy-filter': JSON.stringify(filter) },
      cache: 'no-store',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(12000)]),
    });
    if (!response.ok) throw new Error('Trade history unavailable.');
    return response.json();
  };
  // Bound concurrency and preserve successful weeks when another request fails.
  for (let start = 0; start < requestedWeeks.length; start += 3) {
    await Promise.all(
      requestedWeeks.slice(start, start + 3).map(async (week) => {
        try {
          const url = new URL(leagueUrl);
          url.search = '';
          url.searchParams.set('view', 'mTransactions2');
          url.searchParams.set('scoringPeriodId', String(week));
          const data = await read(url, {
            transactions: { filterType: { value: tradeTypes } },
          });
          if (!Array.isArray(data.transactions))
            throw new Error('Missing transactions.');
          for (const raw of data.transactions)
            if (raw && typeof raw === 'object') remember(normalizeTrade(raw));
          loadedWeeks.push(week);
        } catch {
          /* Coverage records inaccessible weeks without leaking ESPN errors. */
        }
      }),
    );
  }
  let activity: TradeHistory['coverage']['activity'] = 'loaded';
  const pageSize = 100,
    maxPages = 5;
  const topicIds = new Set<string>();
  try {
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(leagueUrl);
      url.search = '';
      url.pathname = url.pathname.replace(/\/$/, '') + '/communication/';
      url.searchParams.set('view', 'kona_league_communication');
      const data = await read(url, {
        topics: {
          filterType: { value: ['ACTIVITY_TRANSACTIONS'] },
          filterIncludeMessageTypeIds: { value: [244] },
          limit: pageSize,
          limitPerMessageSet: { value: 1000 },
          offset: page * pageSize,
          sortMessageDate: { sortPriority: 1, sortAsc: false },
        },
      });
      if (!Array.isArray(data.topics)) throw new Error('Missing topics.');
      let added = 0;
      for (const raw of data.topics) {
        if (!raw || typeof raw !== 'object') continue;
        const key = id(raw.id);
        if (key && !topicIds.has(key)) {
          topicIds.add(key);
          added++;
          remember(normalizeTradeActivity(raw));
        }
      }
      if (data.topics.length < pageSize) break;
      if (!added || page === maxPages - 1) {
        activity = 'truncated';
        break;
      }
    }
  } catch {
    activity = 'unavailable';
  }
  loadedWeeks.sort((a, b) => a - b);
  if (loadedWeeks.length !== requestedWeeks.length)
    warnings.push(
      'Some transaction weeks could not be loaded. Sync ESPN to retry.',
    );
  if (activity === 'unavailable')
    warnings.push(
      'Completed-trade activity is unavailable; historical seasons may not retain this feed.',
    );
  if (activity === 'truncated')
    warnings.push(
      'Completed-trade activity was capped or ESPN repeated a page.',
    );
  const sorted = [...events.values()].sort(
    (a, b) =>
      (b.processedAt ?? b.acceptedAt ?? b.proposedAt ?? 0) -
        (a.processedAt ?? a.acceptedAt ?? a.proposedAt ?? 0) ||
      a.id.localeCompare(b.id),
  );
  if (sorted.some((e) => !e.packageComplete))
    warnings.push(
      'ESPN withheld or returned incomplete player packages for some records. Those records cannot supply labeled examples unless an exact linked record has the complete package.',
    );
  warnings.push(
    'Offer-time rosters and valuations have not been collected. Current projections are excluded from historical examples. Counts represent records, which may include multiple stages of one offer.',
  );
  return {
    version: 1,
    leagueId: league.id,
    season: league.season,
    fetchedAt: new Date().toISOString(),
    events: sorted,
    examples: buildTradeExamples(sorted),
    coverage: { requestedWeeks, loadedWeeks, activity },
    warnings,
  };
}
