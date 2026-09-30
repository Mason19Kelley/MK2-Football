'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, ArrowRight } from 'lucide-react';
import { League, points } from '@/lib/types';
import { findTrades, TradeCandidate, TradeRanking } from '@/lib/trade-finder';

export function TradeFinder({
  league,
  myTeamId,
  onReview,
}: {
  league: League;
  myTeamId: number;
  onReview: (trade: TradeCandidate) => void;
}) {
  const [partnerId, setPartnerId] = useState('all');
  const [maxPlayers, setMaxPlayers] = useState<1 | 2>(1);
  const [minimumGain, setMinimumGain] = useState('1');
  const [ranking, setRanking] = useState<TradeRanking>('mine');
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof findTrades>
  > | null>(null);
  const [running, setRunning] = useState(false);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setResult(null);
    setError('');
    return () => {
      controller.current?.abort();
    };
  }, [league, myTeamId, partnerId, maxPlayers, minimumGain, ranking]);
  useEffect(() => {
    setPartnerId('all');
  }, [league, myTeamId]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    setResult(null);
    setError('');
    setChecked(0);
    try {
      // Allow the searching state to render before evaluating rosters.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const next = await findTrades(league, myTeamId, {
        partnerId: partnerId === 'all' ? undefined : Number(partnerId),
        maxPlayers,
        minimumGain: Number(minimumGain),
        ranking,
        signal: current.signal,
        onProgress: setChecked,
      });
      if (!current.signal.aborted) setResult(next);
    } catch (err) {
      if (!current.signal.aborted)
        setError(err instanceof Error ? err.message : 'Trade search failed.');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  return (
    <section className="panel trade-finder" aria-label="Trade finder">
      <div className="panel-heading">
        <div>
          <h3>Trade finder</h3>
          <p>Find trades that improve both teams’ best starting lineups.</p>
        </div>
        <Search size={20} />
      </div>
      <form onSubmit={search} className="finder-controls">
        <label>
          Search teams
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
          >
            <option value="all">All other teams</option>
            {league.teams
              .filter((t) => t.id !== myTeamId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Trade size
          <select
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value) as 1 | 2)}
          >
            <option value={1}>One for one</option>
            <option value={2}>One for one + two for two</option>
          </select>
        </label>
        <label>
          Minimum ROS gain per team
          <input
            type="number"
            min="0"
            step="0.1"
            required
            value={minimumGain}
            onChange={(e) => setMinimumGain(e.target.value)}
          />
        </label>
        <label>
          Rank results by
          <select
            value={ranking}
            onChange={(e) => setRanking(e.target.value as TradeRanking)}
          >
            <option value="mine">Your lineup gain</option>
            <option value="balanced">Balanced gains</option>
            <option value="combined">Combined gain</option>
          </select>
        </label>
        <button
          className="button primary"
          disabled={running || league.teams.length < 2}
          type="submit"
        >
          {running ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Search size={15} />
          )}
          {running ? 'Searching…' : 'Find trades'}
        </button>
        {running && (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              controller.current?.abort();
              setRunning(false);
            }}
          >
            Cancel search
          </button>
        )}
      </form>
      <p className="finder-note">
        ROS points · Equal-size swaps preserve roster counts. Kickers and IR
        players are excluded. Both teams must gain projected starter points.
        Acceptance likelihood is not estimated.
      </p>
      <div role="status" className="finder-status">
        {running && `Checked ${checked.toLocaleString()} trades…`}
        {result &&
          (result.matched
            ? `Showing ${result.candidates.length} of ${result.matched.toLocaleString()} improving trades (${result.checked.toLocaleString()} checked).`
            : `No trades met these criteria (${result.checked.toLocaleString()} checked). Try a lower minimum gain, more teams, or two-for-two trades.`)}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && result.skipped.length > 0 && (
        <p className="finder-note">
          Skipped teams needing complete ROS projections or eligible starters:{' '}
          {result.skipped.join(', ')}.
        </p>
      )}
      <div className="finder-results">
        {result?.candidates.map((t) => {
          const partner = league.teams.find((p) => p.id === t.partnerId)!;
          return (
            <article
              className="finder-card"
              key={`${t.partnerId}:${t.send.map((p) => p.id)}:${t.receive.map((p) => p.id)}`}
            >
              <div className="finder-card-heading">
                <h4>{partner.name}</h4>
                <span className="count-chip">
                  {t.send.length} for {t.receive.length}
                </span>
              </div>
              <div className="finder-swap">
                <div>
                  <span className="eyebrow">YOU SEND</span>
                  {t.send.map((p) => (
                    <p key={p.id}>
                      <strong>{p.name}</strong>
                      <small>
                        {p.position} · {points(p.ros)} ROS
                      </small>
                    </p>
                  ))}
                </div>
                <div>
                  <span className="eyebrow">YOU RECEIVE</span>
                  {t.receive.map((p) => (
                    <p key={p.id}>
                      <strong>{p.name}</strong>
                      <small>
                        {p.position} · {points(p.ros)} ROS
                      </small>
                    </p>
                  ))}
                </div>
              </div>
              <div className="finder-gains">
                <div>
                  Your starters <strong>+{points(t.mine.gain)}</strong>
                  <small>
                    {points(t.mine.before.total)} → {points(t.mine.after.total)}{' '}
                    ROS
                  </small>
                </div>
                <div>
                  Their starters <strong>+{points(t.partner.gain)}</strong>
                  <small>
                    {points(t.partner.before.total)} →{' '}
                    {points(t.partner.after.total)} ROS
                  </small>
                </div>
              </div>
              <details>
                <summary>See starting lineup changes</summary>
                {(
                  [
                    ['Your team', t.mine],
                    [partner.name, t.partner],
                  ] as const
                ).map(([name, impact]) => (
                  <div key={name} className="finder-lineup">
                    <strong>{name}</strong>
                    <p>
                      Before:{' '}
                      {impact.before.players.map((p) => p.name).join(', ')}
                    </p>
                    <p>
                      After:{' '}
                      {impact.after.players.map((p) => p.name).join(', ')}
                    </p>
                  </div>
                ))}
              </details>
              <button className="button secondary" onClick={() => onReview(t)}>
                Review in trade lab <ArrowRight size={14} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
