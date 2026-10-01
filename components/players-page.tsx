'use client';

import { useMemo, useState } from 'react';
import { ArrowDownUp, Search, Settings2, X } from 'lucide-react';
import { League, Player, points, positions } from '@/lib/types';
import Avatar from './player-avatar';
import PlayerModal from './player-modal';

type SortKey = 'name' | 'weekly' | 'ros';
const sources: Record<Player['projectionSource'], string> = {
  sample: 'Sample',
  estimate: 'Estimate',
  'weekly-sum': 'Weekly sum',
  unavailable: 'Unavailable',
  custom: 'Custom',
};

export default function PlayersPage({
  league,
  onProjectionSettings,
}: {
  league: League;
  onProjectionSettings: () => void;
}) {
  const [selected, setSelected] = useState<{
    player: Player;
    owner: string;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('All');
  const [roster, setRoster] = useState('all');
  const [sort, setSort] = useState<SortKey>('ros');
  const [ascending, setAscending] = useState(false);
  const [limit, setLimit] = useState(100);
  const players = useMemo(() => {
    const pool = new Map<
      number,
      { player: Player; roster: string; owner: string }
    >();
    for (const team of league.teams) {
      for (const player of team.players) {
        pool.set(player.id, {
          player,
          roster: String(team.id),
          owner: team.name,
        });
      }
    }
    for (const player of league.waiverWire?.players ?? []) {
      if (!pool.has(player.id)) {
        pool.set(player.id, {
          player,
          roster: 'available',
          owner:
            player.availability === 'WAIVERS' ? 'On waivers' : 'Free agent',
        });
      }
    }
    return [...pool.values()];
  }, [league]);
  const displayed = players
    .filter(
      ({ player, roster: owner }) =>
        (position === 'All' || player.position === position) &&
        (roster === 'all' ||
          owner === roster ||
          (roster === 'rostered' && owner !== 'available')) &&
        `${player.name} ${player.nflTeam}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => {
      const left = a.player[sort],
        right = b.player[sort];
      // Missing projections stay last in either direction; zero is a real projection.
      if (left === null)
        return right === null ? a.player.name.localeCompare(b.player.name) : 1;
      if (right === null) return -1;
      const comparison =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return (
        (ascending ? comparison : -comparison) ||
        a.player.name.localeCompare(b.player.name)
      );
    });
  function changeSort(next: SortKey) {
    setSort(next);
    setAscending(sort === next ? !ascending : next === 'name');
    setLimit(100);
  }
  function clearFilters() {
    setQuery('');
    setPosition('All');
    setRoster('all');
    setLimit(100);
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Player projections</h2>
          <p>Rostered players and the loaded waiver pool · {league.scoring}</p>
        </div>
        <button className="button secondary" onClick={onProjectionSettings}>
          <Settings2 size={15} /> Projection settings
        </button>
      </div>
      <section className="panel players-panel" aria-label="Player projections">
        <div className="table-toolbar players-toolbar">
          <div className="search-field">
            <Search size={15} />
            <input
              aria-label="Search players"
              placeholder="Search by name or NFL team…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(100);
              }}
            />
            {query && (
              <button
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  setLimit(100);
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            aria-label="Player roster filter"
            value={roster}
            onChange={(e) => {
              setRoster(e.target.value);
              setLimit(100);
            }}
          >
            <option value="all">All players</option>
            <option value="rostered">Rostered players</option>
            <option value="available">Available players</option>
            {league.teams.map((team) => (
              <option key={team.id} value={String(team.id)}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div className="position-tabs" aria-label="Player position filter">
          {['All', ...positions].map((value) => (
            <button
              key={value}
              className={position === value ? 'active' : ''}
              onClick={() => {
                setPosition(value);
                setLimit(100);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="table-scroll">
          <table className="players-table">
            <thead>
              <tr>
                {(['name', 'weekly', 'ros'] as const).map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className={key === 'name' ? '' : 'number'}
                    aria-sort={
                      sort === key
                        ? ascending
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button onClick={() => changeSort(key)}>
                      {key === 'name'
                        ? 'Player'
                        : key === 'weekly'
                          ? `Week ${league.week} proj.`
                          : 'ROS proj.'}
                      <ArrowDownUp size={12} />
                    </button>
                  </th>
                ))}
                <th scope="col">Fantasy team / availability</th>
                <th scope="col">ROS source</th>
              </tr>
            </thead>
            <tbody>
              {displayed.slice(0, limit).map(({ player, owner }) => (
                <tr
                  key={player.id}
                  className="player-detail-row"
                  onClick={() => setSelected({ player, owner })}
                >
                  <td>
                    <button
                      className="player-cell player-detail-trigger"
                      aria-label={`View ${player.name} details`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected({ player, owner });
                      }}
                    >
                      <Avatar player={player} />
                      <div>
                        <strong>{player.name}</strong>
                        <small>
                          {player.position} · {player.nflTeam}
                          {!['ACTIVE', 'NORMAL'].includes(player.status)
                            ? ` · ${player.status.toLowerCase().replaceAll('_', ' ')}`
                            : ''}
                        </small>
                      </div>
                    </button>
                  </td>
                  <td className="number projection-number">
                    {points(player.weekly)}
                  </td>
                  <td className="number projection-number">
                    {points(player.ros)}
                  </td>
                  <td>{owner}</td>
                  <td>{sources[player.projectionSource]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!displayed.length && (
          <div className="empty-state">
            <Search size={23} />
            <strong>No players found</strong>
            <p>Try another name, position, or roster filter.</p>
            <button className="button secondary" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
        <div className="table-footer">
          <span>
            Showing {Math.min(limit, displayed.length)} of {displayed.length}{' '}
            players
          </span>
          <span>Projected fantasy points · — unavailable</span>
        </div>
        {displayed.length > limit && (
          <button
            className="waiver-show-more"
            onClick={() => setLimit(limit + 100)}
          >
            Show more players ({displayed.length - limit} remaining)
          </button>
        )}
      </section>
      {selected && (
        <PlayerModal
          key={selected.player.id}
          player={selected.player}
          owner={selected.owner}
          league={league}
          onClose={() => setSelected(null)}
        />
      )}
      <p className="players-note">
        ROS means rest of season. ESPN estimates are labeled by source.
        {!league.waiverWire
          ? ' This snapshot includes rostered players only. Sync ESPN to load available players.'
          : league.waiverWire.truncated
            ? ' The available pool is limited to ESPN’s 4,000 most-owned available active players.'
            : ''}
      </p>
    </>
  );
}
