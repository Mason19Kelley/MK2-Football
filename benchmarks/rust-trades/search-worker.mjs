import { findTrades } from '/lib/trade-finder.js';
import { createWasmScorer } from '/lib/trade-wasm.js';
self.onmessage = async ({ data: { engine, league, myTeamId, options } }) => {
  let scorer;
  try {
    const start = performance.now();
    if (engine === 'wasm') {
      scorer = await createWasmScorer(league, options);
      if (!scorer) throw new Error('Requested WASM mode is unsupported');
    }
    const initializationMs = performance.now() - start;
    const result = await findTrades(
      league,
      myTeamId,
      {
        ...options,
        onProgress: (checked, progress) =>
          self.postMessage({ type: 'progress', engine, checked, ...progress }),
      },
      scorer,
    );
    self.postMessage({
      type: 'result',
      engine,
      totalMs: performance.now() - start,
      initializationMs,
      result,
    });
  } catch (error) {
    self.postMessage({ type: 'error', engine, error: String(error) });
  } finally {
    scorer?.dispose();
  }
};
