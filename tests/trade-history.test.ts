import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTrade,
  normalizeTradeActivity,
  buildTradeExamples,
  fetchTradeHistory,
  type RawTrade,
} from '../lib/trade-history';
const items = [
  { type: 'TRADE', playerId: 10, fromTeamId: 1, toTeamId: 2 },
  { type: 'TRADE', playerId: 20, fromTeamId: 2, toTeamId: 1 },
];
const event = (raw: RawTrade) => normalizeTrade(raw)!;
test('retains hidden packages and excludes owner identities from normalized records', () => {
  const raw = {
    id: 'hidden',
    type: 'TRADE_DECLINE',
    executionType: 'EXECUTE',
    proposedDate: 123,
    memberId: 'private-owner',
  };
  const result = event(raw);
  assert.equal(result.type, 'TRADE_DECLINE');
  assert.deepEqual(result.items, []);
  assert.equal(result.packageComplete, false);
  assert.ok(!JSON.stringify(result).includes('private-owner'));
  assert.deepEqual(buildTradeExamples([result]), []);
});
test('recovers acceptance/decline packages only through explicit transaction links', () => {
  const proposal = event({ id: 'offer', type: 'TRADE_PROPOSAL', items });
  for (const type of ['TRADE_ACCEPT', 'TRADE_DECLINE']) {
    const outcome = event({
      id: 'outcome',
      relatedTransactionId: 'offer',
      type,
      executionType: 'EXECUTE',
      status: 'EXECUTED',
    });
    const examples = buildTradeExamples([proposal, outcome]);
    assert.equal(examples.length, 1);
    assert.equal(examples[0].accepted, type === 'TRADE_ACCEPT');
    assert.equal(examples[0].historicalFeatures, null);
    assert.deepEqual(
      buildTradeExamples([proposal, { ...outcome, relatedId: null }]),
      [],
    );
  }
});
test('does not label pending, canceled, vetoed, contradictory, or changed offers', () => {
  const proposal = event({ id: 'offer', type: 'TRADE_PROPOSAL', items });
  const accept = event({
    id: 'accept',
    relatedTransactionId: 'offer',
    type: 'TRADE_ACCEPT',
    executionType: 'EXECUTE',
    items,
  });
  assert.deepEqual(buildTradeExamples([proposal]), []);
  assert.deepEqual(
    buildTradeExamples([{ ...accept, executionType: 'CANCEL' }]),
    [],
  );
  assert.deepEqual(buildTradeExamples([{ ...accept, status: 'PENDING' }]), []);
  assert.deepEqual(
    buildTradeExamples([
      proposal,
      accept,
      event({ id: 'veto', type: 'TRADE_VETO', relatedTransactionId: 'accept' }),
    ]),
    [],
  );
  assert.deepEqual(
    buildTradeExamples([
      proposal,
      accept,
      event({
        id: 'decline',
        type: 'TRADE_DECLINE',
        executionType: 'EXECUTE',
        relatedTransactionId: 'offer',
      }),
    ]),
    [],
  );
  assert.deepEqual(
    buildTradeExamples([
      proposal,
      {
        ...accept,
        items: [{ ...accept.items[0], playerId: 99 }, accept.items[1]],
      },
    ]),
    [],
  );
});
test('partial, malformed, duplicate-player and unsupported asset packages are not complete', () => {
  for (const legs of [
    items.slice(0, 1),
    [items[0], { ...items[1], playerId: 10 }],
    [...items, { type: 'PICK', playerId: 99, fromTeamId: 1, toTeamId: 2 }],
    [...items, { type: 'TRADE', playerId: 99, fromTeamId: 0, toTeamId: 2 }],
  ]) {
    const record = event({
      id: 'a',
      type: 'TRADE_ACCEPT',
      executionType: 'EXECUTE',
      items: legs,
    });
    assert.equal(record.packageComplete, false);
    assert.deepEqual(buildTradeExamples([record]), []);
  }
});
test('completed activity preserves direction but does not invent a binary proposal label', () => {
  const result = normalizeTradeActivity({
    id: 'topic',
    date: 100,
    messages: [
      { messageTypeId: 244, from: 1, to: 2, targetId: 10 },
      { messageTypeId: 244, from: 2, to: 1, targetId: 20 },
      { messageTypeId: 180, to: 1, targetId: 99 },
    ],
  })!;
  assert.equal(result.packageComplete, true);
  assert.equal(result.items.length, 2);
  assert.deepEqual(buildTradeExamples([result]), []);
});
test('collector covers preseason and weeks, deduplicates, and reports partial access without leaking cookies', async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal((init!.headers as Record<string, string>).Cookie, 'secret');
    assert.equal(init!.cache, 'no-store');
    if (url.pathname.endsWith('/communication/'))
      return new Response('', { status: 404 });
    if (url.searchParams.get('scoringPeriodId') === '1')
      return new Response('', { status: 403 });
    return Response.json({
      transactions: [
        { id: 'offer', type: 'TRADE_PROPOSAL', items },
        {
          id: 'accept',
          type: 'TRADE_ACCEPT',
          relatedTransactionId: 'offer',
          executionType: 'EXECUTE',
        },
      ],
    });
  };
  const history = await fetchTradeHistory(
    new URL('https://example.test/leagues/42?view=mRoster'),
    { Cookie: 'secret' },
    { id: '42', season: 2025, week: 2, finalWeek: 18 },
    fetcher,
  );
  assert.deepEqual(history.coverage.requestedWeeks, [0, 1, 2]);
  assert.deepEqual(history.coverage.loadedWeeks, [0, 2]);
  assert.equal(history.coverage.activity, 'unavailable');
  assert.equal(history.events.length, 2);
  assert.equal(history.examples.length, 1);
  assert.ok(history.warnings.some((w) => w.includes('Some transaction weeks')));
  assert.ok(!JSON.stringify(history).includes('secret'));
  assert.equal(requests.length, 4);
});
test('collector paginates activity and marks repeated full pages as truncated', async () => {
  const offsets: number[] = [];
  const topic = {
    id: 'topic',
    messages: [
      { messageTypeId: 244, from: 1, to: 2, targetId: 10 },
      { messageTypeId: 244, from: 2, to: 1, targetId: 20 },
    ],
  };
  const fetcher: typeof fetch = async (input, init) => {
    if (!String(input).includes('communication'))
      return Response.json({ transactions: [] });
    offsets.push(
      JSON.parse((init!.headers as Record<string, string>)['x-fantasy-filter'])
        .topics.offset,
    );
    return Response.json({ topics: Array.from({ length: 100 }, () => topic) });
  };
  const history = await fetchTradeHistory(
    new URL('https://example.test/leagues/42'),
    {},
    { id: '42', season: 2025, week: 0, finalWeek: 18 },
    fetcher,
  );
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(history.coverage.activity, 'truncated');
  assert.equal(history.events.length, 1);
});
