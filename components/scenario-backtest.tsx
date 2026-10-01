'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { League } from '@/lib/types';
import {
  BacktestReport,
  BacktestTeamWeek,
  completedWeeks,
} from '@/lib/backtest';
import type { BacktestJob, BacktestResult } from '@/lib/backtest-worker';
import {
  defaultScenarioSettings,
  ScenarioSettings,
} from '@/lib/trade-evaluation';

type WeekData = { teamWeeks: BacktestTeamWeek[]; skipped: number };
// Completed weeks never change, so box scores are fetched once per session.
const boxScores = new Map<string, WeekData>();

export function ScenarioBacktest({
  league,
  settings,
}: {
  league: League;
  settings: ScenarioSettings;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<
    BacktestResult & { settings: ScenarioSettings; skipped: number }
  >();
  const weeks = completedWeeks(league);
  const baseline = {
    ...defaultScenarioSettings,
    samples: settings.samples,
    seed: settings.seed,
  };
  const custom = JSON.stringify(settings) !== JSON.stringify(baseline);

  async function run() {
    setRunning(true);
    setError('');
    try {
      const key = (w: number) => `${league.id}:${league.season}:${w}`;
      const missing = weeks.filter((w) => !boxScores.has(key(w)));
      if (missing.length) {
        const response = await fetch('/api/espn/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId: league.id,
            season: league.season,
            weeks: missing,
          }),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? 'Could not load past box scores.');
        for (const w of missing) boxScores.set(key(w), body.weeks[w]);
      }
      const loaded = weeks.map((w) => boxScores.get(key(w))!);
      const job: BacktestJob = {
        data: {
          teamWeeks: loaded.flatMap((w) => w.teamWeeks),
          matchups: league.matchups,
        },
        baseline,
        ...(custom ? { candidate: settings } : {}),
      };
      const output = await new Promise<BacktestResult>((resolve) => {
        const worker = new Worker(
          new URL('../lib/backtest-worker.ts', import.meta.url),
          { type: 'module' },
        );
        worker.onmessage = ({ data }: MessageEvent<BacktestResult>) => {
          resolve(data);
          worker.terminate();
        };
        worker.onerror = () => {
          resolve({ error: 'Backtest calculation failed.' });
          worker.terminate();
        };
        worker.postMessage(job);
      });
      if (output.error) throw new Error(output.error);
      setResult({
        ...output,
        settings,
        skipped: loaded.reduce((s, w) => s + w.skipped, 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed.');
    } finally {
      setRunning(false);
    }
  }

  const stale =
    result && JSON.stringify(result.settings) !== JSON.stringify(settings);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const reports = [
    ['Defaults', result?.baseline],
    ...(result?.candidate ? [['Your settings', result.candidate]] : []),
  ] as [string, BacktestReport][];
  const shown = result?.candidate ?? result?.baseline;
  const rows: [string, string, (r: BacktestReport) => string][] = [
    ['Team score z-score spread', '1.00', (r) => r.teams.zSd.toFixed(2)],
    ['Actual inside 80% range', '80%', (r) => pct(r.teams.coverage80)],
    ['Actual inside 50% range', '50%', (r) => pct(r.teams.coverage50)],
    [
      'Typical miss vs simulated spread',
      'equal',
      (r) => `${r.teams.rmse.toFixed(1)} vs ${r.teams.modelSd.toFixed(1)}`,
    ],
    ['Average miss (actual − mean)', '0', (r) => r.teams.bias.toFixed(1)],
    [
      'Matchup Brier score',
      '< 0.250',
      (r) => (r.matchups.count ? r.matchups.brier.toFixed(3) : '—'),
    ],
  ];

  return (
    <section className="panel scenario-backtest" aria-label="Scenario backtest">
      <span className="eyebrow">CHECK THE ASSUMPTIONS</span>
      <h3>How these settings did on past weeks</h3>
      <p className="finder-note">
        Simulates every completed week from the lineups each team actually
        started and ESPN’s projections at the time, then checks where the real
        scores landed. A well-calibrated model has a z-score spread near 1.00
        and about 80% of scores inside its 80% range.
      </p>
      {league.source === 'demo' ? (
        <p className="finder-note">
          Connect ESPN to check these settings against your league’s results.
        </p>
      ) : !weeks.length ? (
        <p className="finder-note">No completed weeks to check yet.</p>
      ) : (
        <button className="button secondary" onClick={run} disabled={running}>
          {running && <Loader2 size={15} className="spin" />}
          {running
            ? 'Checking…'
            : result
              ? 'Check again with current settings'
              : `Check against weeks 1–${weeks.at(-1)}`}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result?.baseline && (
        <div aria-live="polite">
          {stale && (
            <p className="finder-note">
              Settings changed since this check. Results below use the earlier
              settings.
            </p>
          )}
          <p className="finder-note">
            {result.baseline.teams.count} team-weeks
            {result.baseline.matchups.count
              ? `, ${result.baseline.matchups.count} matchups`
              : ''}
            {result.skipped
              ? `; ${result.skipped} team-weeks skipped for missing projections`
              : ''}
            .
          </p>
          <div className="trade-odds-table-wrap">
            <table className="trade-odds-table">
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Target</th>
                  {reports.map(([label]) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, target, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{target}</td>
                    {reports.map(([name, r]) => (
                      <td key={name}>{value(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.candidate && (
            <p
              className={
                result.improves ? 'finder-note green-text' : 'finder-note'
              }
            >
              {result.improves
                ? 'Your settings fit past weeks better than the defaults on every gate measure.'
                : 'Your settings don’t beat the defaults: z-score spread, 80% range and matchup Brier score must each be no worse, with at least one better.'}
            </p>
          )}
          {shown && (
            <details className="league-forecast-details">
              <summary>
                By position ({result.candidate ? 'your settings' : 'defaults'})
              </summary>
              <div className="trade-odds-table-wrap">
                <table className="trade-odds-table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Player-weeks</th>
                      <th>z-score spread</th>
                      <th>Inside 80%</th>
                      <th>Typical miss</th>
                      <th>Simulated SD</th>
                      <th>Average miss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(shown.players).map(([position, c]) => (
                      <tr key={position}>
                        <th scope="row">{position}</th>
                        <td>{c.count}</td>
                        <td>{c.zSd.toFixed(2)}</td>
                        <td>{pct(c.coverage80)}</td>
                        <td>{c.rmse.toFixed(1)}</td>
                        <td>{c.modelSd.toFixed(1)}</td>
                        <td>{c.bias.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
