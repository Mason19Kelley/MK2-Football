import {
  forecastTradeSeasonOdds,
  TradeSeasonOddsInput,
} from './trade-season-odds';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<TradeSeasonOddsInput>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ result: forecastTradeSeasonOdds(data) });
  } catch (error) {
    scope.postMessage({
      error:
        error instanceof Error
          ? error.message
          : 'Season odds calculation failed.',
    });
  }
};
