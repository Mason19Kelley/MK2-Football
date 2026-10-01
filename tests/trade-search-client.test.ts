import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLeague } from '../lib/demo';
import { runTradeSearch } from '../lib/trade-search-client';
const options = {
  maxPlayers: 1 as const,
  minimumGain: 0,
  ranking: 'mine' as const,
};

test('synchronous worker startup failures reject instead of stranding the evaluator', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = class {
    constructor() {
      throw new Error('Workers blocked.');
    }
  } as unknown as typeof Worker;
  try {
    await assert.rejects(
      runTradeSearch(demoLeague, 1, options),
      /Workers blocked/,
    );
  } finally {
    globalThis.Worker = original;
  }
});

test('worker readiness is separate from results and preparation progress reaches callers', async () => {
  const original = globalThis.Worker;
  let terminated = false;
  const result = { candidates: [], checked: 1, matched: 0 };
  globalThis.Worker = class {
    onmessage?: (event: { data: unknown }) => void;
    postMessage() {
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: 'ready' } });
        this.onmessage?.({
          data: {
            type: 'progress',
            checked: 0,
            progress: { phase: 'preparing', evaluatedRosters: 5 },
          },
        });
        this.onmessage?.({ data: { type: 'result', result } });
      });
    }
    terminate() {
      terminated = true;
    }
  } as unknown as typeof Worker;
  try {
    const phases: string[] = [];
    const returned = await runTradeSearch(demoLeague, 1, {
      ...options,
      onProgress: (_checked, p) => phases.push(p!.phase),
    });
    assert.deepEqual(returned, result);
    assert.deepEqual(phases, ['preparing']);
    assert.ok(terminated);
  } finally {
    globalThis.Worker = original;
  }
});

test('canceling an initialized worker settles its promise and terminates it', async () => {
  const original = globalThis.Worker;
  let terminated = false;
  globalThis.Worker = class {
    postMessage() {}
    terminate() {
      terminated = true;
    }
  } as unknown as typeof Worker;
  try {
    const controller = new AbortController();
    const pending = runTradeSearch(demoLeague, 1, {
      ...options,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(terminated);
  } finally {
    globalThis.Worker = original;
  }
});
