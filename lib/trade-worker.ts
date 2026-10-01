import {
  findTrades,
  FindTradeOptions,
  shortlistOptions,
  usesOutcomeShortlist,
} from './trade-finder';
import { League } from './types';
import { createWasmScorer, TradeRosterEngine } from './trade-wasm';
const scope = globalThis as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          league: League;
          myTeamId: number;
          options: FindTradeOptions;
        }>,
      ) => void)
    | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = async ({ data }) => {
  let engine: TradeRosterEngine | undefined;
  try {
    scope.postMessage({
      type: 'progress',
      checked: 0,
      progress: { phase: 'preparing', evaluatedRosters: 0 },
    });
    try {
      // Outcome searches score their points shortlist with the fast engine.
      engine = await createWasmScorer(
        data.league,
        usesOutcomeShortlist(data.options)
          ? shortlistOptions(data.options)
          : data.options,
      );
    } catch (error) {
      console.warn('WASM scorer unavailable; using TypeScript.', error);
    }
    const result = await findTrades(
      data.league,
      data.myTeamId,
      {
        ...data.options,
        onProgress: (checked, progress) =>
          scope.postMessage({ type: 'progress', checked, progress }),
      },
      engine,
    );
    scope.postMessage({ type: 'result', result });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Trade search failed.',
    });
  } finally {
    engine?.dispose();
  }
};
scope.postMessage({ type: 'ready' });
