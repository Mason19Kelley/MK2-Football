import { findTrades, FindTradeOptions } from './trade-finder';
import { League } from './types';
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
  try {
    const result = await findTrades(data.league, data.myTeamId, {
      ...data.options,
      onProgress: (checked, progress) =>
        scope.postMessage({ type: 'progress', checked, progress }),
    });
    scope.postMessage({ type: 'result', result });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Trade search failed.',
    });
  }
};
scope.postMessage({ type: 'ready' });
