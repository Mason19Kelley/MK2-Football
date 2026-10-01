'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, ArrowRight, Loader2 } from 'lucide-react';
import { League, Team, points } from '@/lib/types';
import { findWaiverPickups, WaiverPickup } from '@/lib/waiver-finder';

export default function WaiverFinder({
  league,
  mine,
  position,
  query,
  availability,
  onReview,
}: {
  league: League;
  mine: Team;
  position: string;
  query: string;
  availability: string;
  onReview: (pickup: WaiverPickup) => void;
}) {
  const [result, setResult] = useState<ReturnType<
    typeof findWaiverPickups
  > | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setResult(null);
    setError('');
    setLimit(20);
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, [league, mine.id]);
  useEffect(() => setLimit(20), [position, query, availability]);
  const pickups =
    result?.pickups.filter(
      ({ add }) =>
        (position === 'All' || add.position === position) &&
        `${add.name} ${add.nflTeam}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (availability === 'All available' ||
          add.availability ===
            (availability === 'Free agents' ? 'FREEAGENT' : 'WAIVERS')),
    ) ?? [];
  return (
    <section className="panel trade-picker" aria-label="Waiver wire finder">
      <div className="trade-picker-heading">
        <div>
          <span className="eyebrow">
            WAIVER WIRE FINDER · THROUGH WEEK {league.finalWeek}
          </span>
          <h3>Find pickups that increase your ROS points</h3>
        </div>
        <button
          className="button primary"
          disabled={running}
          onClick={() => {
            setError('');
            setLimit(20);
            worker.current?.terminate();
            setRunning(true);
            setResult(null);
            try {
              const searchWorker = new Worker(
                new URL('../lib/waiver-worker.ts', import.meta.url),
              );
              worker.current = searchWorker;
              searchWorker.onmessage = (
                event: MessageEvent<{
                  result?: ReturnType<typeof findWaiverPickups>;
                  error?: string;
                }>,
              ) => {
                if (worker.current !== searchWorker) return;
                setRunning(false);
                setResult(event.data.result ?? null);
                setError(event.data.error ?? '');
                searchWorker.terminate();
                worker.current = null;
              };
              searchWorker.onerror = () => {
                if (worker.current !== searchWorker) return;
                setRunning(false);
                setError('Unable to find pickups. Try again.');
                searchWorker.terminate();
                worker.current = null;
              };
              searchWorker.postMessage({ league, teamId: mine.id });
            } catch (cause) {
              setRunning(false);
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Unable to find pickups.',
              );
            }
          }}
        >
          {running ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Search size={15} />
          )}
          {running ? 'Finding pickups…' : 'Find pickups'}
        </button>
      </div>
      <p className="finder-note">
        Searches every available player and ranks their best legal add/drop move
        by total starting lineup gains, optimized each week. Includes byes and
        bench depth. Claims, FAAB, and waiver priority still determine
        availability.
      </p>
      <div className="finder-status" role="status">
        {running
          ? 'Checking every available pickup and legal drop…'
          : error ||
            (result
              ? `${pickups.length} improving pickups match your filters · ${result.pickups.length} total found`
              : 'Run the finder to see every improving pickup for your team.')}
      </div>
      {result?.capacityEstimated && (
        <p className="finder-note">
          Roster capacity uses your current non-IR roster size because this
          snapshot has no roster limit.
        </p>
      )}
      {result && !pickups.length && (
        <p className="finder-note">
          No improving pickups found. Try clearing filters, updating
          projections, or syncing ESPN.
        </p>
      )}
      <div className="finder-results">
        {pickups.slice(0, limit).map((pickup) => (
          <article className="finder-card" key={pickup.add.id}>
            <div className="finder-card-heading">
              <h4>{pickup.add.name}</h4>
              <span className="green-text">+{points(pickup.gain)} ROS pts</span>
            </div>
            <div className="finder-swap">
              <p>
                Add {pickup.add.name} · {pickup.add.position} ·{' '}
                {pickup.add.nflTeam}
              </p>
              <p>
                {pickup.drops.length
                  ? `Drop ${pickup.drops.map((p) => p.name).join(' + ')}`
                  : 'Use an open roster spot · no drop required'}
              </p>
            </div>
            <small>
              {pickup.add.availability === 'WAIVERS'
                ? 'On waivers'
                : 'Free agent'}{' '}
              · {points(pickup.before)} → {points(pickup.after)} lineup pts
            </small>
            {pickup.estimated > 0 && (
              <small>Includes estimated weekly projections.</small>
            )}
            <button
              className="button secondary"
              onClick={() => onReview(pickup)}
            >
              Review pickup <ArrowRight size={14} />
            </button>
          </article>
        ))}
      </div>
      {pickups.length > limit && (
        <button
          className="waiver-show-more"
          onClick={() => setLimit(limit + 50)}
        >
          Show more pickups ({pickups.length - limit} remaining)
          <ArrowRight size={14} />
        </button>
      )}
    </section>
  );
}
