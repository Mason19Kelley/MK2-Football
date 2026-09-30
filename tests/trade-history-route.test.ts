import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/espn/route';

test('ESPN import optionally collects history without returning session or member identifiers', async (t) => {
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: URL | string, init: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url.searchParams.get('view') ?? '');
      if (url.searchParams.get('view') === 'proTeamSchedules_wl')
        return Response.json({
          settings: { proTeams: [{ id: 1, byeWeek: 8 }] },
        });
      assert.equal(
        (init.headers as Record<string, string>).Cookie,
        'espn_s2=secret-s2; SWID=secret-swid',
      );
      if (url.searchParams.get('view') === 'kona_player_info')
        return Response.json({ players: [] });
      if (url.pathname.endsWith('/communication/'))
        return new Response('', { status: 404 });
      if (url.searchParams.get('view') === 'mTransactions2')
        return Response.json({
          transactions: [
            {
              id: 'decline',
              type: 'TRADE_DECLINE',
              executionType: 'EXECUTE',
              memberId: 'hidden-member',
            },
          ],
        });
      return Response.json({
        id: 42,
        scoringPeriodId: 1,
        status: { finalScoringPeriod: 18 },
        settings: {
          name: 'Imported',
          rosterSettings: { lineupSlotCounts: { 0: 1 } },
        },
        teams: [{ id: 1, name: 'Team One', roster: { entries: [] } }],
      });
    },
  );
  const request = (includeTradeHistory: boolean) =>
    new NextRequest('http://localhost:3000/api/espn', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        leagueId: '42',
        season: 2025,
        espnS2: 'secret-s2',
        swid: 'secret-swid',
        includeTradeHistory,
      }),
    });
  const response = await POST(request(true));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.league.tradeHistory.events.length, 1);
  assert.equal(body.league.tradeHistory.coverage.activity, 'unavailable');
  for (const secret of ['secret-s2', 'secret-swid', 'hidden-member'])
    assert.ok(!JSON.stringify(body).includes(secret));
  calls.length = 0;
  const without = await POST(request(false));
  assert.equal((await without.json()).league.tradeHistory, undefined);
  assert.ok(!calls.includes('mTransactions2'));
});
