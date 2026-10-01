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
    <TradeSeasonOddsDisplay
      input={input}
      result={current?.result}
      error={current?.error}
    />
  );
}

export function TradeSeasonOddsDisplay({
  input,
  result,
  error,
}: {
  input: TradeSeasonOddsInput;
  result?: TradeSeasonOdds;
  error?: string;
}) {
  const signed = (value: number, digits = 2) =>
    `${value >= 0.5 * 10 ** -digits ? '+' : ''}${(Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits)}`;
  const record = (value: TradeSeasonOdds['teams'][number]['beforeRecord']) =>
    `${value.wins.toFixed(2)}–${value.losses.toFixed(2)}${value.ties > 0 ? `–${value.ties.toFixed(2)}` : ''}`;
  return (
    <section className="panel trade-season-odds" aria-label="Trade season odds">
      <span className="eyebrow">PROJECTED SEASON ODDS</span>
      <h3>Expected record and season chances</h3>
      {!result ? (
        <p aria-live="polite">
          {error
            ? `Odds unavailable: ${error}`
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
                {result.teams.flatMap((team) =>
                  (['record', 'playoffs', 'title'] as const).map((metric) => {
                    if (metric === 'record')
                      return (
                        <tr key={`${team.id}-record`}>
                          <th scope="row">
                            {
                              input.league.teams.find((t) => t.id === team.id)
                                ?.name
                            }
                          </th>
                          <td>
                            Expected W–L
                            {team.beforeRecord.ties > 0 ||
                            team.afterRecord.ties > 0
                              ? '–T'
                              : ''}
                          </td>
                          <td>{record(team.beforeRecord)}</td>
                          <td>{record(team.afterRecord)}</td>
                          <td>
                            {signed(
                              team.afterRecord.wins - team.beforeRecord.wins,
                            )}{' '}
                            W /{' '}
                            {signed(
                              team.afterRecord.losses -
                                team.beforeRecord.losses,
                            )}{' '}
                            L
                          </td>
                        </tr>
                      );
                    const available =
                      team.before[metric] !== undefined &&
                      team.after[metric] !== undefined;
                    const before = (team.before[metric] ?? 0) * 100;
                    const after = (team.after[metric] ?? 0) * 100;
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
                        <td>{available ? `${before.toFixed(1)}%` : '—'}</td>
                        <td>{available ? `${after.toFixed(1)}%` : '—'}</td>
                        <td className={rounded > 0 ? 'green-text' : ''}>
                          {available ? `${signed(rounded, 1)} pp` : '—'}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <p className="finder-note">
            Record changes are expected wins and losses; probability changes are
            percentage points. Metrics always cover the full remaining season.
          </p>
          {(result.qualificationError || result.championshipError) && (
            <p className="finder-note">
              {result.qualificationError
                ? `Playoff odds unavailable: ${result.qualificationError}`
                : `Championship odds unavailable: ${result.championshipError}`}
            </p>
          )}
          <details className="league-forecast-details">
            <summary>Season odds model</summary>
            <p>{result.description}</p>
          </details>
        </>
      )}
    </section>
  );
}
