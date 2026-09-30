import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeLeague,
  parseLeagueId,
  ESPNResponse,
  enrichByeWeeks,
} from '@/lib/espn';
import { fetchTradeHistory } from '@/lib/trade-history';
import { fetchWaiverWire } from '@/lib/waivers';
import { isAllowedRequestOrigin } from '@/lib/request-origin';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const respond = (data: unknown, status = 200) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  // Credentials are used only for this request, never written to storage or returned.
  if (!isAllowedRequestOrigin(request.headers, request.url))
    return respond({ error: 'Cross-origin requests are not allowed.' }, 403);
  try {
    const body = await request.json();
    const id = parseLeagueId(String(body.leagueId ?? ''));
    const season = Number(body.season);
    if (
      !Number.isInteger(season) ||
      season < 2019 ||
      season > new Date().getFullYear() + 1
    )
      return respond(
        { error: 'Choose a supported season from 2019 through next year.' },
        400,
      );
    const s2 = String(body.espnS2 ?? '').trim(),
      swid = String(body.swid ?? '').trim();
    if (s2.length > 4096 || swid.length > 100 || /[\r\n;]/.test(s2 + swid))
      return respond({ error: 'Invalid ESPN cookie format.' }, 400);
    if (Boolean(s2) !== Boolean(swid))
      return respond(
        { error: 'Private leagues need both espn_s2 and SWID cookies.' },
        400,
      );
    const url = new URL(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${id}`,
    );
    for (const view of ['mTeam', 'mRoster', 'mSettings'])
      url.searchParams.append('view', view);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (s2 && swid) headers.Cookie = `espn_s2=${s2}; SWID=${swid}`;
    const res = await fetch(url, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403)
      return respond(
        {
          error:
            'This league is private or the ESPN session has expired. Enter fresh espn_s2 and SWID cookies from your signed-in ESPN account.',
        },
        401,
      );
    if (res.status === 404)
      return respond(
        {
          error:
            'ESPN could not find this league for that season. Check the league ID and year; private leagues may also need session cookies.',
        },
        404,
      );
    if (!res.ok)
      return respond(
        {
          error: `ESPN is unavailable (HTTP ${res.status}). Try again shortly.`,
        },
        502,
      );
    const raw = (await res.json()) as ESPNResponse;
    const league = normalizeLeague(raw, season);
    try {
      league.waiverWire = await fetchWaiverWire(url, headers, league);
    } catch {
      league.warnings.push(
        'Waiver wire could not be loaded. Sync ESPN to try again; imported rosters are available.',
      );
    }
    try {
      await enrichByeWeeks(league);
    } catch {
      league.warnings.push(
        'NFL bye weeks could not be loaded. Weekly trade estimates assume unknown byes are playable; sync ESPN to retry.',
      );
    }
    if (body.includeTradeHistory === true) {
      league.tradeHistory = await fetchTradeHistory(url, headers, league);
    }
    return respond({ league });
  } catch (error) {
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      return respond(
        { error: 'ESPN took too long to respond. Please try again.' },
        504,
      );
    if (error instanceof SyntaxError)
      return respond(
        { error: 'The request or ESPN response was not valid JSON.' },
        400,
      );
    return respond(
      {
        error:
          error instanceof Error &&
          /Enter an ESPN|returned no teams/.test(error.message)
            ? error.message
            : 'Could not connect to ESPN. Please try again.',
      },
      400,
    );
  }
}
