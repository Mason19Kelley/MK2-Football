import {
  BacktestComparison,
  BacktestData,
  BacktestReport,
  compareBacktests,
  runBacktest,
} from './backtest';
import type { ScenarioSettings } from './trade-evaluation';

export type BacktestJob = {
  data: BacktestData;
  baseline: ScenarioSettings;
  candidate?: ScenarioSettings;
};
export type BacktestResult = {
  baseline?: BacktestReport;
  candidate?: BacktestReport;
  comparison?: BacktestComparison;
  error?: string;
};
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BacktestJob>) => void) | null;
  postMessage: (message: BacktestResult) => void;
};
scope.onmessage = ({ data: { data, baseline, candidate } }) => {
  try {
    const base = runBacktest(data, baseline);
    const next = candidate && runBacktest(data, candidate);
    scope.postMessage({
      baseline: base,
      ...(next
        ? { candidate: next, comparison: compareBacktests(base, next) }
        : {}),
    });
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : 'Backtest failed.',
    });
  }
};
