'use client';

import { useEffect, useState } from 'react';
import type {
  TradeSeasonOdds,
  TradeSeasonOddsInput,
} from '@/lib/trade-season-odds';

export function TradeSeasonOddsComparison({
  input,
}: {
  input: TradeSeasonOddsInput;
}) {
  const [state, setState] = useState<{
    input: TradeSeasonOddsInput;
    result?: TradeSeasonOdds;
    error?: string;
  }>();
  useEffect(() => {
    const worker = new Worker(
      new URL('../lib/trade-season-odds-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = ({
      data,
    }: MessageEvent<{ result?: TradeSeasonOdds; error?: string }>) => {
      setState({ input, ...data });
      worker.terminate();
    };
    worker.onerror = () => {
      setState({
        input,
        error:
          'Season odds calculation failed. Try changing the trade to recalculate.',
      });
      worker.terminate();
    };
    worker.postMessage(input);
    return () => worker.terminate();
  }, [input]);
  const current = state?.input === input ? state : undefined;
  return (
    <section className="panel trade-season-odds" aria-label="Trade season odds">
      <span className="eyebrow">PROJECTED SEASON ODDS</span>
      <h3>Playoff and championship chances</h3>
      {!current?.result ? (
        <p role="status">
          {current?.error
            ? `Odds unavailable: ${current.error}`
            : 'Calculating before-and-after season odds…'}
        </p>
      ) : (
        <>
          <div className="trade-odds-table-wrap">
            <table className="trade-odds-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Outcome</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {current.result.teams.flatMap((team) =>
                  (['playoffs', 'title'] as const).map((metric) => {
                    const before = team.before[metric]! * 100;
                    const after = team.after[metric]! * 100;
                    const change = after - before;
                    const rounded = Number(change.toFixed(1));
                    return (
                      <tr key={`${team.id}-${metric}`}>
                        <th scope="row">
                          {
                            input.league.teams.find((t) => t.id === team.id)
                              ?.name
                          }
                        </th>
                        <td>
                          {metric === 'playoffs'
                            ? 'Make playoffs'
                            : 'Win championship'}
                        </td>
                        <td>{before.toFixed(1)}%</td>
                        <td>{after.toFixed(1)}%</td>
                        <td className={rounded > 0 ? 'green-text' : ''}>
                          {rounded > 0 ? '+' : ''}
                          {rounded.toFixed(1)} pp
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <p className="finder-note">
            Changes are in percentage points. Odds always cover the full
            remaining season.
          </p>
          <details className="league-forecast-details">
            <summary>Season odds model</summary>
            <p>{current.result.description}</p>
          </details>
        </>
      )}
    </section>
  );
}
