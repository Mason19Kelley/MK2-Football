import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST, DELETE } from '../app/api/espn/route';
import {
  loadConnection,
  saveConnection,
  CONNECTION_COOKIE,
} from '../lib/espn-connection';

test('saved ESPN connections refresh securely, expire, and disconnect', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'espn-connection-'));
  process.env.ESPN_CONNECTION_DIR = directory;
  t.after(async () => {
    delete process.env.ESPN_CONNECTION_DIR;
    await rm(directory, { recursive: true, force: true });
  });
  let upstreamStatus = 200;
  let requests = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: URL | string, init: RequestInit) => {
      requests++;
      const url = new URL(String(input));
      if (url.searchParams.get('view') === 'proTeamSchedules_wl')
        return Response.json({
          settings: { proTeams: [{ id: 1, byeWeek: 8 }] },
        });
      assert.equal(
        (init.headers as Record<string, string>).Cookie,
        'espn_s2=secret-session; SWID=secret-owner',
      );
      if (upstreamStatus !== 200)
        return new Response('', { status: upstreamStatus });
      if (url.searchParams.get('view') === 'kona_player_info')
        return Response.json({ players: [] });
      return Response.json({
        id: 42,
        settings: { rosterSettings: { lineupSlotCounts: { 0: 1 } } },
        teams: [{ id: 1, name: 'Live roster', roster: { entries: [] } }],
      });
    },
  );
  const request = (
    body: unknown,
    token?: string,
    origin = 'http://localhost:3000',
    method = 'POST',
  ) =>
    new NextRequest('http://localhost:3000/api/espn', {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(token ? { Cookie: `${CONNECTION_COOKIE}=${token}` } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
  const response = await POST(
    request({
      leagueId: '42',
      season: 2025,
      espnS2: 'secret-session',
      swid: 'secret-owner',
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=strict/i);
  assert.ok(!cookie.includes('secret-session'));
  const token = cookie.split(';')[0].split('=')[1];
  assert.equal((await loadConnection(token))?.espnS2, 'secret-session');
  for (const file of await readdir(directory)) {
    const contents = await readFile(path.join(directory, file));
    assert.ok(!contents.includes(Buffer.from('secret-session')));
    assert.ok(!contents.includes(Buffer.from('secret-owner')));
  }
  const refresh = { refresh: true, leagueId: '42', season: 2025 };
  const refreshed = await POST(request(refresh, token));
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).league.teams[0].name, 'Live roster');
  assert.equal(refreshed.headers.get('set-cookie'), null);
  const calls = requests;
  assert.equal(
    (await POST(request({ ...refresh, leagueId: '43' }, token))).status,
    401,
  );
  assert.equal((await POST(request(refresh))).status, 401);
  assert.equal(
    (await POST(request(refresh, token, 'https://other.example'))).status,
    403,
  );
  assert.equal(requests, calls);
  upstreamStatus = 403;
  const expiredSession = await POST(request(refresh, token));
  assert.equal(expiredSession.status, 401);
  assert.equal((await expiredSession.json()).reconnect, true);
  assert.equal(
    (await DELETE(request(null, token, 'https://other.example', 'DELETE')))
      .status,
    403,
  );
  assert.ok(await loadConnection(token));
  assert.equal(
    (await DELETE(request(null, token, undefined, 'DELETE'))).status,
    200,
  );
  assert.equal(await loadConnection(token), null);
  const expired = await saveConnection({
    leagueId: '42',
    season: 2025,
    espnS2: '',
    swid: '',
  });
  const realNow = Date.now;
  t.mock.method(Date, 'now', () => realNow() + 181 * 24 * 60 * 60 * 1000);
  assert.equal(await loadConnection(expired), null);
  t.mock.restoreAll();
  const corrupt = await saveConnection({
    leagueId: '42',
    season: 2025,
    espnS2: '',
    swid: '',
  });
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith('.json'),
  );
  await writeFile(path.join(directory, files[0]), '{}');
  assert.equal(await loadConnection(corrupt), null);
  assert.equal(await loadConnection('../../etc/passwd'), null);
});

test('backtest box scores use the saved connection only for its own league', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'espn-backtest-'));
  process.env.ESPN_CONNECTION_DIR = directory;
  t.after(async () => {
    delete process.env.ESPN_CONNECTION_DIR;
    await rm(directory, { recursive: true, force: true });
  });
  const token = await saveConnection({
    leagueId: '42',
    season: 2025,
    espnS2: 'secret-session',
    swid: 'secret-owner',
  });
  const requested: { week: string | null; cookie?: string }[] = [];
  let upstreamStatus = 200;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: URL | string, init: RequestInit) => {
      const url = new URL(String(input));
      requested.push({
        week: url.searchParams.get('scoringPeriodId'),
        cookie: (init.headers as Record<string, string>).Cookie,
      });
      if (upstreamStatus !== 200)
        return new Response('', { status: upstreamStatus });
      const week = Number(url.searchParams.get('scoringPeriodId'));
      const stat = (statSourceId: number, appliedTotal: number) => ({
        seasonId: 2025,
        statSourceId,
        statSplitTypeId: 1,
        scoringPeriodId: week,
        appliedTotal,
      });
      return Response.json({
        schedule: [
          {
            home: {
              teamId: 1,
              rosterForCurrentScoringPeriod: {
                entries: [
                  {
                    lineupSlotId: 0,
                    playerPoolEntry: {
                      player: {
                        id: 7,
                        defaultPositionId: 1,
                        proTeamId: 12,
                        stats: [stat(1, 20), stat(0, 10 + week)],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      });
    },
  );
  const { POST: backtest } = await import('../app/api/espn/backtest/route');
  const request = (body: unknown, origin = 'http://localhost:3000') =>
    new NextRequest('http://localhost:3000/api/espn/backtest', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: `${CONNECTION_COOKIE}=${token}`,
      },
      body: JSON.stringify(body),
    });
  const response = await backtest(
    request({ leagueId: '42', season: 2025, weeks: [1, 2, 3] }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.weeks[3].teamWeeks[0].starters[0].actual, 13);
  assert.deepEqual(requested.map((r) => r.week).sort(), ['1', '2', '3']);
  assert.ok(
    requested.every(
      (r) => r.cookie === 'espn_s2=secret-session; SWID=secret-owner',
    ),
  );
  requested.length = 0;
  // Another league never receives the saved cookies.
  await backtest(request({ leagueId: '43', season: 2025, weeks: [1] }));
  assert.equal(requested[0].cookie, undefined);
  for (const weeks of [[], [0], [1, 1], [19], 'all'])
    assert.equal(
      (await backtest(request({ leagueId: '42', season: 2025, weeks }))).status,
      400,
    );
  assert.equal(
    (
      await backtest(
        request(
          { leagueId: '42', season: 2025, weeks: [1] },
          'https://other.example',
        ),
      )
    ).status,
    403,
  );
  upstreamStatus = 401;
  const denied = await backtest(
    request({ leagueId: '42', season: 2025, weeks: [1] }),
  );
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).reconnect, true);
});
