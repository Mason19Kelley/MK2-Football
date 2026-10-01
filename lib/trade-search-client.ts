import { findTrades, FindTradeOptions } from './trade-finder';
import { League } from './types';
export async function runTradeSearch(
  league: League,
  myTeamId: number,
  options: FindTradeOptions,
): Promise<Awaited<ReturnType<typeof findTrades>>> {
  if (typeof Worker === 'undefined')
    return findTrades(league, myTeamId, options);
  options.signal?.throwIfAborted();
  const worker = new Worker(new URL('./trade-worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      finish();
      reject(
        new Error(
          'The trade search worker did not start. Reload the page and retry.',
        ),
      );
    }, 15000);
    const finish = () => {
      clearTimeout(startupTimer);
      worker.terminate();
      options.signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException('Search canceled.', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => {
      finish();
      reject(
        new Error('The trade search worker failed. Reload and try again.'),
      );
    };
    worker.onmessage = ({ data }) => {
      clearTimeout(startupTimer);
      if (data.type === 'ready') return;
      if (data.type === 'progress')
        options.onProgress?.(data.checked, data.progress);
      else if (data.type === 'result') {
        finish();
        resolve(data.result);
      } else if (data.type === 'error') {
        finish();
        reject(new Error(data.error));
      }
    };
    worker.onmessageerror = () => {
      finish();
      reject(
        new Error(
          'The trade search result could not be read. Retry the search.',
        ),
      );
    };
    const { signal: _signal, onProgress: _progress, ...serializable } = options;
    try {
      worker.postMessage({ league, myTeamId, options: serializable });
    } catch (error) {
      finish();
      reject(
        error instanceof Error
          ? error
          : new Error('Could not start the trade search.'),
      );
    }
  });
}
