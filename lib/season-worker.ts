import { forecastSeason } from './season-forecast';
import { League } from './types';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<League>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ result: forecastSeason(data) });
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : 'Season forecast failed.',
    });
  }
};
