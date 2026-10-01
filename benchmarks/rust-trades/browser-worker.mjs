// Benchmark-only worker: both engines replay the same captured roster workload.
// This module is served only by the local benchmark server, not the app.
self.onmessage = async ({ data: { engine, runs, corpusUrl } }) => {
  try {
    const initializationStart = performance.now();
    const fetchStart = performance.now();
    let bytes = await (await fetch(corpusUrl)).arrayBuffer();
    const fetchMs = performance.now() - fetchStart;
    const byteLength = bytes.byteLength;
    let count,
      score,
      cleanup = () => {},
      parseMs,
      compileMs = 0,
      wasmBytes;
    if (engine === 'wasm') {
      const compileStart = performance.now();
      const moduleBytes = await (await fetch('/scorer.wasm')).arrayBuffer();
      wasmBytes = moduleBytes.byteLength;
      const { instance } = await WebAssembly.instantiate(moduleBytes, {});
      compileMs = performance.now() - compileStart;
      const api = instance.exports;
      const error = () =>
        new TextDecoder().decode(
          new Uint8Array(
            api.memory.buffer,
            api.benchmark_error_ptr(),
            api.benchmark_error_len(),
          ),
        );
      const loadStart = performance.now();
      const ptr = api.benchmark_alloc(byteLength);
      try {
        new Uint8Array(api.memory.buffer, ptr, byteLength).set(
          new Uint8Array(bytes),
        );
        if (!api.benchmark_load(ptr, byteLength)) throw new Error(error());
      } finally {
        api.benchmark_free(ptr, byteLength);
      }
      bytes = null;
      parseMs = performance.now() - loadStart;
      count = api.benchmark_count();
      score = (start, end) => {
        const checksum = api.benchmark_score(start, end);
        if (!Number.isFinite(checksum)) throw new Error(error());
        return checksum;
      };
      cleanup = () => api.benchmark_clear();
    } else {
      const { evaluateRoster } = await import('/lib/weekly-trades.js');
      const loadStart = performance.now();
      const corpus = JSON.parse(new TextDecoder().decode(bytes));
      bytes = null;
      const slotIds = [0, 2, 4, 6, 16, 17, 23];
      const positions = ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'];
      const weeks = corpus.specialists.length;
      const projectionCache = new Map();
      const players = corpus.players.map((p) => {
        const projections = Object.fromEntries(
          p.weekly.map((points, week) => [week + 1, points]),
        );
        projectionCache.set(
          p.id,
          new Map(
            p.weekly.map((points, week) => [
              week + 1,
              {
                points,
                unavailable: p.unavailable[week],
                estimated: false,
              },
            ]),
          ),
        );
        return {
          id: p.id,
          name: String(p.id),
          position: positions[p.position],
          nflTeam: 'FA',
          slot: p.ir ? 'IR' : 'BN',
          slotId: p.ir ? 21 : 20,
          eligibleSlots: slotIds.filter(
            (_, index) => p.eligibility & (1 << index),
          ),
          ros: p.ros,
          weekly: p.weekly[0],
          weeklyProjections: projections,
          projectionSource: 'weekly-sum',
          status: 'ACTIVE',
          season: null,
          actual: null,
        };
      });
      const slots = [...new Set(corpus.slots)].map((index) => ({
        id: slotIds[index],
        label: String(index),
        count: corpus.slots.filter((slot) => slot === index).length,
      }));
      const specialistCache = new Map(
        corpus.specialists.map((indices, week) => [
          week + 1,
          indices.map((index) => ({
            ...players[index],
            weekly: corpus.players[index].weekly[week],
          })),
        ]),
      );
      const replacementCache = new Map();
      const league = {
        week: 1,
        finalWeek: weeks,
        slots,
        teams: [],
        waiverWire: {
          players: players.map((p) => ({ ...p, availability: 'FREEAGENT' })),
        },
      };
      parseMs = performance.now() - loadStart;
      count = corpus.rosters.length;
      const equal = (a, b) => Math.abs(a - b) <= 1e-7;
      score = (start, end) => {
        let checksum = 0;
        for (let i = start; i < end; i++) {
          const result = evaluateRoster(
            league,
            corpus.rosters[i].map((index) => players[index]),
            'remaining',
            projectionCache,
            replacementCache,
            { streaming: false, specialistCache },
          );
          const expected = corpus.expected[i];
          if (
            !equal(result.total, expected.total) ||
            result.missing !== expected.missing ||
            result.complete !== expected.complete
          )
            throw new Error(`TypeScript roster ${i} summary mismatch`);
          for (let week = 0; week < weeks; week++) {
            const actual = result.weeks[week],
              selected = expected.weekSelected[week];
            if (
              !equal(actual.total, expected.weekTotals[week]) ||
              actual.filled !== expected.weekFilled[week] ||
              actual.players.length !== selected.length ||
              actual.players.some((p, index) => p.id !== selected[index])
            )
              throw new Error(`TypeScript roster ${i} week ${week} mismatch`);
          }
          checksum += result.total;
        }
        return checksum;
      };
    }
    const initializationMs = performance.now() - initializationStart;
    self.postMessage({ type: 'loaded', engine, count, initializationMs });
    const runsMs = [],
      runsWallMs = [];
    let checksum;
    for (let run = 0; run < runs; run++) {
      const start = performance.now();
      let computeMs = 0;
      checksum = 0;
      for (let offset = 0; offset < count; offset += 2000) {
        const chunkStart = performance.now();
        checksum += score(offset, Math.min(count, offset + 2000));
        computeMs += performance.now() - chunkStart;
        self.postMessage({
          type: 'progress',
          engine,
          run,
          checked: Math.min(count, offset + 2000),
          count,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      runsMs.push(computeMs);
      runsWallMs.push(performance.now() - start);
      self.postMessage({
        type: 'run',
        engine,
        run,
        ms: computeMs,
        wallMs: runsWallMs[run],
      });
    }
    cleanup();
    self.postMessage({
      type: 'result',
      engine,
      count,
      byteLength,
      fetchMs,
      parseMs,
      compileMs,
      wasmBytes,
      initializationMs,
      runsMs,
      runsWallMs,
      checksum,
      parity: true,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      engine,
      error: error.message || String(error),
    });
  }
};
