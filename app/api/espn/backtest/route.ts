import { NextRequest, NextResponse } from 'next/server';
import { fetchBacktestWeek, parseLeagueId } from '@/lib/espn';
import { isAllowedRequestOrigin } from '@/lib/request-origin';
import { CONNECTION_COOKIE, loadConnection } from '@/lib/espn-connection';
import { FANTASY_FINAL_WEEK } from '@/lib/types';
export const runtime = 'nodejs';

// Completed-week box scores for the scoring backtest. Private leagues use the
// saved connection, so cookies never pass through the browser again.
export async function POST(request: NextRequest) {
  const respond = (data: unknown, status = 200) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (!isAllowedRequestOrigin(request.headers, request.url))
    return respond({ error: 'Cross-origin requests are not allowed.' }, 403);
  try {
    const body = await request.json();
    const id = parseLeagueId(String(body.leagueId ?? ''));
    const season = Number(body.season);
    const weeks: unknown = body.weeks;
    if (
      !Number.isInteger(season) ||
      season < 2019 ||
      season > new Date().getFullYear() + 1 ||
      !Array.isArray(weeks) ||
      !weeks.length ||
      weeks.length > FANTASY_FINAL_WEEK ||
      new Set(weeks).size !== weeks.length ||
      weeks.some((w) => !Number.isInteger(w) || w < 1 || w > FANTASY_FINAL_WEEK)
    )
      return respond({ error: 'Choose a season and completed weeks.' }, 400);
    const saved = await loadConnection(
      request.cookies.get(CONNECTION_COOKIE)?.value,
    );
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (saved?.leagueId === id && saved.season === season && saved.espnS2)
      headers.Cookie = `espn_s2=${saved.espnS2}; SWID=${saved.swid}`;
    const url = new URL(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${id}`,
    );
    const results: Record<
      number,
      Awaited<ReturnType<typeof fetchBacktestWeek>>
    > = {};
    // A few weeks at a time keeps ESPN from rate-limiting a full season.
    const queue = [...(weeks as number[])];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let week = queue.shift(); week; week = queue.shift())
          results[week] = await fetchBacktestWeek(url, headers, season, week);
      }),
    );
    return respond({ weeks: results });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403)
      return respond(
        {
          error:
            'ESPN denied access to past box scores. Reconnect ESPN with fresh espn_s2 and SWID cookies.',
          reconnect: true,
        },
        401,
      );
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      return respond(
        { error: 'ESPN took too long to respond. Please try again.' },
        504,
      );
    return respond(
      {
        error:
          error instanceof Error &&
          /Enter an ESPN|box scores/.test(error.message)
            ? error.message
            : 'Could not load past box scores from ESPN. Please try again.',
      },
      status ? 502 : 400,
    );
  }
}
