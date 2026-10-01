import {
  createTradeSeasonForecaster,
  forecastTradeSeasonOdds,
  TradeSeasonOddsInput,
} from './trade-season-odds';
const scope = globalThis as unknown as {
  onmessage:
    | ((
        event: MessageEvent<
          TradeSeasonOddsInput | { inputs: TradeSeasonOddsInput[] }
        >,
      ) => void)
    | null;
  postMessage: (message: unknown) => void;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Season odds calculation failed.';
scope.onmessage = ({ data }) => {
  if ('inputs' in data) {
    const forecasters = new Map<
      string,
      ReturnType<typeof createTradeSeasonForecaster>
    >();
    data.inputs.forEach((input, index) => {
      try {
        const key = JSON.stringify([
          input.scenarios,
          input.playoffs,
          input.streaming,
        ]);
        let forecast = forecasters.get(key);
        if (!forecast) {
          forecast = createTradeSeasonForecaster(input);
          forecasters.set(key, forecast);
        }
        scope.postMessage({ index, result: forecast(input) });
      } catch (error) {
        scope.postMessage({ index, error: message(error) });
      }
    });
    scope.postMessage({ done: true });
    return;
  }
  try {
    scope.postMessage({ result: forecastTradeSeasonOdds(data) });
  } catch (error) {
    scope.postMessage({ error: message(error) });
  }
};
