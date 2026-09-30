'use client';

import { Download } from 'lucide-react';
import type { League } from '@/lib/types';

export function TradeHistoryPanel({ league }: { league: League }) {
  const history = league.tradeHistory;
  const names = new Map(
    league.teams.flatMap((t) => t.players.map((p) => [p.id, p.name] as const)),
  );
  function download() {
    if (!history) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(history, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `espn-trades-${history.leagueId}-${history.season}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel trade-history" aria-label="Trade history">
      <div className="panel-heading">
        <div>
          <h3>Trade history</h3>
          <p>
            Historical offers and outcomes for building the acceptance model.
          </p>
        </div>
        {history && (
          <button className="button secondary" onClick={download}>
            <Download size={15} />
            Export trade dataset
          </button>
        )}
      </div>
      {!history ? (
        <p className="finder-note">
          {league.source === 'demo'
            ? 'Connect ESPN with trade history enabled to collect real offers.'
            : 'Sync ESPN with “Import trade history for this season” enabled to collect offers.'}
        </p>
      ) : (
        <>
          <p className="finder-note">
            {history.events.length} records ·{' '}
            {history.events.filter((e) => e.type === 'TRADE_ACCEPT').length}{' '}
            acceptance records ·{' '}
            {history.events.filter((e) => e.type === 'TRADE_DECLINE').length}{' '}
            decline records · {history.examples.length} labeled offers with
            complete linked packages. {history.coverage.loadedWeeks.length}/
            {history.coverage.requestedWeeks.length} transaction weeks loaded.
          </p>
          <p className="finder-note">
            Acceptance percentages need labeled offers plus player values and
            rosters from the time of each offer. This collection does not train
            a model yet.
          </p>
          {history.warnings.map((warning) => (
            <p className="finder-note" key={warning}>
              {warning}
            </p>
          ))}
          {history.events.length === 0 && (
            <p className="finder-note">
              No accessible trade records were returned.
            </p>
          )}
          {history.events.length > 0 && (
            <details>
              <summary>Inspect recent records (up to 20)</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Week</th>
                      <th>Players</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.events.slice(0, 20).map((event) => (
                      <tr key={`${event.source}:${event.id}`}>
                        <td>
                          {event.type.replace('TRADE_', '').toLowerCase()}{' '}
                          {event.status && `(${event.status.toLowerCase()})`}
                        </td>
                        <td>{event.week ?? '—'}</td>
                        <td>
                          {event.items.length
                            ? event.items
                                .map(
                                  (i) =>
                                    `${names.get(i.playerId) ?? `Player ${i.playerId}`}: ${league.teams.find((t) => t.id === i.fromTeamId)?.name ?? `Team ${i.fromTeamId}`} → ${i.action === 'DROP' ? 'dropped' : (league.teams.find((t) => t.id === i.toTeamId)?.name ?? `Team ${i.toTeamId}`)}`,
                                )
                                .join('; ')
                            : 'Player details unavailable'}
                          {event.items.length > 0 &&
                            !event.packageComplete &&
                            ' (incomplete package)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
