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
    includeTradeHistory: false,
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
    includeTradeHistory: false,
  });
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith('.json'),
  );
  await writeFile(path.join(directory, files[0]), '{}');
  assert.equal(await loadConnection(corrupt), null);
  assert.equal(await loadConnection('../../etc/passwd'), null);
});
