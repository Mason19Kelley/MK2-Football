'use client';

import { useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import {
  League,
  Player,
  points,
  slotNames,
  fantasyFinalWeek,
} from '@/lib/types';
import Avatar from './player-avatar';

export default function PlayerModal({
  player,
  owner,
  league,
  onClose,
}: {
  player: Player;
  owner: string;
  league: League;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      previousFocus?.focus();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const weeks = Array.from(
    { length: fantasyFinalWeek(league) },
    (_, i) => i + 1,
  );
  const projections = { ...player.weeklyProjections };
  if (player.weekly !== null && projections[league.week] === undefined)
    projections[league.week] = player.weekly;
  const maxProjection = Math.max(1, ...Object.values(projections));
  const percent = (value: number | null | undefined) =>
    value == null ? '—' : `${value.toFixed(1)}%`;
  const source = league.source === 'demo' ? 'Sample' : 'ESPN';
  return (
    <dialog
      ref={ref}
      className="modal player-modal"
      aria-labelledby="player-modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <button
          className="icon-button modal-close"
          aria-label="Close player details"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <div className="player-modal-header">
          <Avatar player={player} />
          <div>
            <span className="eyebrow">{league.season} PLAYER DETAILS</span>
            <h2 id="player-modal-title">{player.name}</h2>
            <p>
              {player.position} · {player.nflTeam} · {owner}
            </p>
          </div>
        </div>
        <dl className="player-detail-stats">
          <div>
            <dt>Week {league.week} projection</dt>
            <dd>{points(player.weekly)}</dd>
          </div>
          <div>
            <dt>Rest of season</dt>
            <dd>{points(player.ros)}</dd>
          </div>
          <div>
            <dt>Season projection</dt>
            <dd>{points(player.season)}</dd>
          </div>
          <div>
            <dt>Season actual</dt>
            <dd>{points(player.actual)}</dd>
          </div>
        </dl>
        <dl className="player-detail-facts">
          <div>
            <dt>Injury status</dt>
            <dd>{player.status.toLowerCase().replaceAll('_', ' ')}</dd>
          </div>
          <div>
            <dt>Bye week</dt>
            <dd>{player.byeWeek ? `Week ${player.byeWeek}` : 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Rostered in ESPN leagues</dt>
            <dd>{percent(player.percentOwned)}</dd>
          </div>
          <div>
            <dt>Started in ESPN leagues</dt>
            <dd>{percent(player.percentStarted)}</dd>
          </div>
          <div>
            <dt>Eligible slots</dt>
            <dd>
              {player.eligibleSlots
                .filter((id) => ![20, 21, 25].includes(id))
                .map((id) => slotNames[id])
                .filter(Boolean)
                .join(', ') || player.position}
            </dd>
          </div>
          <div>
            <dt>ROS source</dt>
            <dd>
              {
                (
                  {
                    sample: 'Sample',
                    estimate: 'Season average estimate',
                    'weekly-sum': 'Weekly projection sum',
                    unavailable: 'Unavailable',
                    custom: 'Custom projection',
                  } as const
                )[player.projectionSource]
              }
            </dd>
          </div>
        </dl>
        <div className="player-weekly-heading">
          <h3>Weekly projections</h3>
          <span>{league.scoring} · Fantasy points</span>
        </div>
        <p className="player-weekly-note">
          {source} weekly projections for the full season. — means unavailable.
        </p>
        <table className="player-weekly-table">
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col" className="number">
                Projected
              </th>
              <th scope="col" className="number">
                Actual
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const projected = projections[week] ?? null;
              const actual = player.weeklyActuals?.[week] ?? null;
              return (
                <tr
                  key={week}
                  className={week === league.week ? 'current-week' : ''}
                  aria-current={week === league.week ? 'true' : undefined}
                >
                  <th scope="row">
                    Week {week}
                    {week === league.week && (
                      <span className="week-tag">Current</span>
                    )}
                    {week === player.byeWeek && (
                      <span className="week-tag">Bye</span>
                    )}
                    {league.playoffStartWeek !== undefined &&
                      week >= league.playoffStartWeek &&
                      week <= league.finalWeek && (
                        <span className="week-tag">Playoffs</span>
                      )}
                  </th>
                  <td className="number">
                    <div className="weekly-projection-value">
                      <span
                        className="weekly-projection-track"
                        aria-hidden="true"
                      >
                        <span
                          style={{
                            width: `${(Math.max(0, projected ?? 0) / maxProjection) * 100}%`,
                          }}
                        />
                      </span>
                      <span>{points(projected)}</span>
                    </div>
                  </td>
                  <td className="number">{points(actual)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {league.source === 'espn' &&
          player.position !== 'D/ST' &&
          player.id > 0 && (
            <a
              className="player-espn-link"
              href={`https://www.espn.com/nfl/player/_/id/${player.id}`}
              target="_blank"
              rel="noreferrer"
            >
              View profile and news on ESPN <ExternalLink size={13} />
            </a>
          )}
      </div>
    </dialog>
  );
}
