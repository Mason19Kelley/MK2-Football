import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const wasmPath = path.resolve(
  import.meta.dirname,
  '../../engine/trade-scorer/target/wasm32-unknown-unknown/release/trade_scorer.wasm',
);
const { instance } = await WebAssembly.instantiate(
  await fs.readFile(wasmPath),
  {},
);
const api = instance.exports;
const error = () =>
  new TextDecoder().decode(
    new Uint8Array(
      api.memory.buffer,
      api.benchmark_error_ptr(),
      api.benchmark_error_len(),
    ),
  );
const load = (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const ptr = api.benchmark_alloc(bytes.length);
  try {
    new Uint8Array(api.memory.buffer, ptr, bytes.length).set(bytes);
    return api.benchmark_load(ptr, bytes.length);
  } finally {
    api.benchmark_free(ptr, bytes.length);
  }
};
const corpus = {
  slots: [1, 6],
  players: [
    {
      id: 1,
      position: 1,
      eligibility: 66,
      ir: false,
      ros: 10,
      weekly: [10, 0],
      unavailable: [false, true],
    },
    {
      id: 2,
      position: 1,
      eligibility: 66,
      ir: false,
      ros: 6,
      weekly: [6, 6],
      unavailable: [false, false],
    },
    {
      id: 3,
      position: 1,
      eligibility: 66,
      ir: true,
      ros: 50,
      weekly: [0, 0],
      unavailable: [true, true],
    },
  ],
  specialists: [[], []],
  rosters: [[0, 1, 2]],
  expected: [
    {
      total: 22,
      missing: 0,
      complete: true,
      weekTotals: [16, 6],
      weekFilled: [2, 1],
      weekSelected: [[1, 2], [2]],
    },
  ],
};
assert.ok(Number.isNaN(api.benchmark_score(0, 1)));
assert.match(error(), /load a corpus/);
assert.equal(load(corpus), 1);
assert.equal(api.benchmark_count(), 1);
assert.equal(api.benchmark_score(0, 1), 22);
assert.equal(api.benchmark_score(0, 0), 0);
assert.ok(Number.isNaN(api.benchmark_score(0, 2)));
assert.match(error(), /invalid roster range/);
assert.equal(load({ ...corpus, expected: [] }), 0);
assert.match(error(), /corpus length mismatch/);
assert.equal(api.benchmark_count(), 0);
assert.ok(Number.isNaN(api.benchmark_score(0, 1)));
assert.equal(
  load({
    ...corpus,
    expected: [{ ...corpus.expected[0], weekSelected: [[2, 1], [2]] }],
  }),
  1,
);
assert.ok(Number.isNaN(api.benchmark_score(0, 1)));
assert.match(error(), /roster 0: week 0/);
assert.equal(load(corpus), 1);
assert.equal(api.benchmark_score(0, 1), 22);
api.benchmark_clear();
assert.equal(api.benchmark_count(), 0);
assert.equal(api.benchmark_error_len(), 0);
assert.equal(load(corpus), 1);
assert.equal(api.benchmark_score(0, 1), 22);
console.log(
  'WASM ABI smoke checks passed: load, free, IR/byes, ordered parity, ranges, errors and reload.',
);
