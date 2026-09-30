import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/espn/route';
import { isAllowedRequestOrigin } from '../lib/request-origin';
const internal = 'http://localhost:3000/api/espn';
function allowed(values: Record<string, string>) {
  return isAllowedRequestOrigin(new Headers(values), internal);
}
test('same-origin browser calls work behind a preview proxy', () => {
  assert.equal(
    allowed({
      origin: 'https://preview.example.com',
      'sec-fetch-site': 'same-origin',
    }),
    true,
  );
  assert.equal(allowed({ origin: 'http://localhost:3000' }), true);
  assert.equal(
    allowed({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' }),
    true,
  );
});
test('legacy clients can use the public host and protocol forwarded by a proxy', () => {
  assert.equal(
    allowed({
      origin: 'https://preview.example.com',
      'x-forwarded-host': 'preview.example.com',
      'x-forwarded-proto': 'https',
    }),
    true,
  );
  assert.equal(
    allowed({
      origin: 'https://preview.example.com',
      'x-forwarded-host': 'preview.example.com',
      'x-forwarded-proto': 'http',
    }),
    false,
  );
});
test('cross-site, same-site subdomains, malformed origins and ambiguous hosts are rejected', () => {
  for (const site of ['cross-site', 'same-site'])
    assert.equal(
      allowed({ origin: 'https://evil.example', 'sec-fetch-site': site }),
      false,
    );
  assert.equal(allowed({ origin: 'https://evil.example' }), false);
  for (const origin of [
    'null',
    'garbage',
    'https://user:password@preview.example.com',
    'https://preview.example.com/path',
    'ftp://preview.example.com',
  ])
    assert.equal(allowed({ origin, 'sec-fetch-site': 'same-origin' }), false);
  assert.equal(
    allowed({
      origin: 'https://preview.example.com',
      'x-forwarded-host': 'preview.example.com, evil.example',
      'x-forwarded-proto': 'https',
    }),
    false,
  );
  assert.equal(
    allowed({
      origin: 'https://preview.example.com',
      'x-forwarded-host': 'preview.example.com/evil',
      'x-forwarded-proto': 'https',
    }),
    false,
  );
  assert.equal(allowed({}), true);
});
test('ESPN route reaches input validation from a same-origin preview and blocks foreign browser calls', async () => {
  const preview = new NextRequest(internal, {
    method: 'POST',
    headers: {
      origin: 'https://preview.example.com',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ leagueId: 'invalid', season: 2026 }),
  });
  const result = await POST(preview);
  assert.equal(result.status, 400);
  assert.match((await result.json()).error, /Enter an ESPN league ID/);
  const foreign = new NextRequest(internal, {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ leagueId: 'invalid', season: 2026 }),
  });
  assert.equal((await POST(foreign)).status, 403);
});
