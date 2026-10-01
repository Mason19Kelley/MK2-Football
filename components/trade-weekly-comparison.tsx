import { useMemo } from 'react';
import { League, Player, points } from '@/lib/types';
import {
  evaluateForecastRoster,
  ScenarioSettings,
} from '@/lib/trade-evaluation';

export function TradeWeeklyComparison({
  league,
  before,
  after,
  name,
  scenarios,
  streaming = true,
}: {
  league: League;
  before: Player[];
  after: Player[];
  name: string;
  scenarios?: ScenarioSettings;
  streaming?: boolean;
}) {
  const comparison = useMemo(() => {
    const original = evaluateForecastRoster(league, before, 'remaining', {
      scenarios,
      streaming,
    });
    const next = evaluateForecastRoster(league, after, 'remaining', {
      scenarios,
      streaming,
    });
    return original.weeks.map((w, i) => ({
      before: w,
      after: next.weeks[i],
      gain: next.weeks[i].total - w.total,
    }));
  }, [league, before, after, scenarios, streaming]);
  const changedWeeks = comparison.filter((w) => {
    const beforeIds = new Set(w.before.players.map((p) => p.id));
    return (
      beforeIds.size !== w.after.players.length ||
      w.after.players.some((p) => !beforeIds.has(p.id))
    );
  });
  const gain = (start: number, end: number) =>
    comparison
      .filter((w) => w.before.week >= start && w.before.week <= end)
      .reduce((sum, w) => sum + w.gain, 0);
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${points(n)}`;
  const missing = comparison.some((w) => w.before.missing || w.after.missing);
  const estimates = comparison.some(
    (w) => w.before.estimated || w.after.estimated,
  );
  const byesUnknown = comparison.some(
    (w) => w.before.unknownByes || w.after.unknownByes,
  );
  return (
    <section className="weekly-comparison" aria-label={`${name} weekly impact`}>
      <h4>{name} · Weekly lineup impact</h4>
      <div className="weekly-gain-summary">
        <span>
          Next 3 weeks
          <strong>
            {missing ? '—' : signed(gain(league.week, league.week + 2))}
          </strong>
        </span>
        <span>
          Playoffs
          <strong>
            {missing || !league.playoffStartWeek
              ? '—'
              : signed(
                  gain(
                    Math.max(league.week, league.playoffStartWeek),
                    league.finalWeek,
                  ),
                )}
          </strong>
        </span>
        <span>
          Remaining season
          <strong>
            {missing ? '—' : signed(gain(league.week, league.finalWeek))}
          </strong>
        </span>
      </div>
      <p className="finder-note">
        {!streaming &&
          'Uses the planned roster with no additional future pickups. '}
        {scenarios &&
          'Totals are sampled outcomes under the configured assumptions; displayed starters use the base forecasts. '}
        {estimates &&
          'EST. includes evenly allocated ROS estimates or illustrative sample forecasts. '}
        {byesUnknown &&
          'Some bye weeks are unknown; those players are assumed playable. '}
        Known byes and current-week OUT / DOUBTFUL players are unavailable.
        Future injury recovery is unknown; IR stays excluded. Empty starting
        slots{' '}
        {streaming
          ? 'use the best projected eligible free agents in the imported pool; otherwise they score zero.'
          : 'score zero.'}{' '}
        Replacements assume an available roster spot or a bench drop and that
        the player remains available that week.
        {!league.waiverWire && ' Sync ESPN to load waiver replacements.'}
      </p>
      <details>
        <summary>See weekly starters and coverage</summary>
        {changedWeeks.length === 0 ? (
          <p className="finder-note">No weekly starter changes.</p>
        ) : (
          <div className="weekly-table-scroll">
            <table className="weekly-impact-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Gain</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {changedWeeks.map((w) => (
                  <tr key={w.before.week}>
                    <th>
                      {w.before.week}
                      {league.playoffStartWeek &&
                      w.before.week >= league.playoffStartWeek
                        ? ' · PO'
                        : ''}
                    </th>
                    <td>
                      {points(w.before.total)}
                      <small>
                        {w.before.players
                          .filter(
                            (p) => !w.after.players.some((q) => q.id === p.id),
                          )
                          .map(
                            (p) =>
                              `${p.name}${w.before.replacements.some((r) => r.id === p.id) ? ` (free agent · ${points(p.weekly)} pts)` : ''}`,
                          )
                          .join(', ') || 'No starters removed'}
                      </small>
                    </td>
                    <td>
                      {points(w.after.total)}
                      <small>
                        {w.after.players
                          .filter(
                            (p) => !w.before.players.some((q) => q.id === p.id),
                          )
                          .map(
                            (p) =>
                              `${p.name}${w.after.replacements.some((r) => r.id === p.id) ? ` (free agent · ${points(p.weekly)} pts)` : ''}`,
                          )
                          .join(', ') || 'No starters added'}
                      </small>
                    </td>
                    <td>
                      {w.before.missing || w.after.missing
                        ? '—'
                        : signed(w.gain)}
                    </td>
                    <td>
                      {w.before.filled}/{w.before.slots} → {w.after.filled}/
                      {w.after.slots}
                      <small>
                        {w.before.missing || w.after.missing
                          ? 'Missing projections'
                          : w.before.estimated || w.after.estimated
                            ? 'EST.'
                            : 'Forecasts'}
                      </small>
                      {(w.before.replacements.length > 0 ||
                        w.after.replacements.length > 0) && (
                        <small>Includes free-agent replacements</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
