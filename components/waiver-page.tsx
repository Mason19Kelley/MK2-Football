'use client';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CircleHelp,
  Search,
  Shield,
  Sparkles,
  RefreshCw,
  X,
  UserPlus,
} from 'lucide-react';
import { League, Player, Team, WaiverPlayer, points } from '@/lib/types';
import { compareWaiverMove } from '@/lib/waivers';
import Avatar from './player-avatar';
import WaiverFinder from './waiver-finder';
const positionOrder: Player['position'][] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'D/ST',
];
export default function WaiverPage({
  league,
  mine,
  onTeamChange,
  onSync,
}: {
  league: League;
  mine: Team;
  onTeamChange: (id: number) => void;
  onSync: () => void;
}) {
  const [position, setPosition] = useState('All'),
    [query, setQuery] = useState(''),
    [availability, setAvailability] = useState('All available'),
    [metric, setMetric] = useState<'weekly' | 'ros'>('ros'),
    [dropId, setDropId] = useState<number | null>(null),
    [addId, setAddId] = useState<number | null>(null),
    [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [position, query, availability]);
  const wire = league.waiverWire;
  const add = wire?.players.find((p) => p.id === addId),
    drop = mine.players.find((p) => p.id === dropId);
  const sort = (a: Player, b: Player) =>
    positionOrder.indexOf(a.position) - positionOrder.indexOf(b.position) ||
    (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity) ||
    a.name.localeCompare(b.name);
  const owned = mine.players
    .filter((p) => position === 'All' || p.position === position)
    .sort(sort);
  const available = (wire?.players ?? [])
    .filter(
      (p) =>
        (position === 'All' || p.position === position) &&
        `${p.name} ${p.nflTeam}`.toLowerCase().includes(query.toLowerCase()) &&
        (availability === 'All available' ||
          p.availability ===
            (availability === 'Free agents' ? 'FREEAGENT' : 'WAIVERS')),
    )
    .sort(sort);
  const openSpot =
    mine.rosterCapacity !== undefined &&
    mine.players.filter((p) => p.slotId !== 21).length < mine.rosterCapacity;
  const comparison =
    add && (drop || openSpot)
      ? compareWaiverMove(mine.players, add, drop, league.slots, metric, league)
      : null;
  const playerDelta =
    add && drop && add[metric] !== null && drop[metric] !== null
      ? add[metric]! - drop[metric]!
      : null;
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${points(value)}`;
  const period = metric === 'ros' ? 'ROS' : `Week ${league.week}`;
  const title =
    !add || (!drop && !openSpot)
      ? 'Could this pickup improve your team?'
      : !comparison?.complete
        ? 'Player comparison ready. Lineup data incomplete.'
        : comparison.delta! > 0.05
          ? 'Your best starting lineup improves.'
          : comparison.delta! < -0.05
            ? 'Your best starting lineup loses projected points.'
            : 'Your best starting projection stays about the same.';
  return (
    <>
      <div className="trade-explanation">
        <Sparkles size={19} />
        <div>
          <strong>Find value beyond your roster.</strong>
          <p>
            Select one player you could drop and one available player to compare
            their projections and your best eligible starting lineup. This is a
            local simulation; claims, FAAB, and waiver priority are not modeled.
            The finder checks roster limits and includes weekly byes.
          </p>
        </div>
      </div>
      <div className="waiver-controls">
        <label className="waiver-team-select">
          Your team
          <select
            aria-label="Waiver comparison team"
            value={mine.id}
            onChange={(e) => onTeamChange(Number(e.target.value))}
          >
            {league.teams.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" aria-label="Waiver projection period">
          <button
            className={metric === 'weekly' ? 'current' : ''}
            onClick={() => setMetric('weekly')}
          >
            This week
          </button>
          <button
            className={metric === 'ros' ? 'current' : ''}
            onClick={() => setMetric('ros')}
          >
            Rest of season
          </button>
        </div>
      </div>
      {!wire ? (
        <div className="panel waiver-load-state">
          <UserPlus size={30} />
          <h3>Load your league’s waiver wire</h3>
          <p>
            This saved snapshot doesn’t include available players yet. Sync ESPN
            to import free agents and players on waivers with projections for
            your league.
          </p>
          <button className="button primary" onClick={onSync}>
            <RefreshCw size={15} />
            Sync ESPN
          </button>
        </div>
      ) : (
        <>
          <div className="panel waiver-filters">
            <div className="position-tabs" aria-label="Waiver position filter">
              {['All', ...positionOrder].map((p) => (
                <button
                  key={p}
                  className={position === p ? 'active' : ''}
                  onClick={() => setPosition(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="waiver-search-controls">
              <div className="search-field">
                <Search size={15} />
                <input
                  aria-label="Search available players"
                  placeholder="Search available players…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    aria-label="Clear waiver search"
                    onClick={() => setQuery('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <select
                aria-label="Availability filter"
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
              >
                <option>All available</option>
                <option>Free agents</option>
                <option>On waivers</option>
              </select>
            </div>
          </div>
          <WaiverFinder
            league={league}
            mine={mine}
            position={position}
            query={query}
            availability={availability}
            onReview={(pickup) => {
              setAddId(pickup.add.id);
              setDropId(pickup.drops[0]?.id ?? null);
              setMetric('ros');
            }}
          />
          <div className="trade-grid waiver-grid">
            <section className="panel trade-picker">
              <div className="trade-picker-heading">
                <div>
                  <span className="eyebrow">YOU COULD DROP</span>
                  <h3>{mine.name}</h3>
                </div>
                <span className="count-chip">{owned.length} players</span>
              </div>
              <div className="trade-player-list">
                {owned.map((p) => (
                  <WaiverRow
                    key={p.id}
                    player={p}
                    metric={metric}
                    selected={dropId === p.id}
                    group="waiver-drop"
                    onSelect={() => setDropId(p.id)}
                  />
                ))}
                {!owned.length && (
                  <div className="empty-state">
                    <p>No roster players at this position.</p>
                  </div>
                )}
              </div>
              <SelectionFooter player={drop} metric={metric} />
            </section>
            <section className="panel trade-picker">
              <div className="trade-picker-heading">
                <div>
                  <span className="eyebrow">YOU COULD ADD</span>
                  <h3>Available players</h3>
                </div>
                <span className="count-chip">{available.length} found</span>
              </div>
              <div className="trade-player-list">
                {available.slice(0, limit).map((p) => (
                  <WaiverRow
                    key={p.id}
                    player={p}
                    metric={metric}
                    selected={addId === p.id}
                    group="waiver-add"
                    onSelect={() => setAddId(p.id)}
                  />
                ))}
                {available.length > limit && (
                  <button
                    className="waiver-show-more"
                    onClick={() => setLimit(limit + 100)}
                  >
                    Show more players ({available.length - limit} remaining)
                    <ArrowRight size={14} />
                  </button>
                )}
                {!available.length && (
                  <div className="empty-state">
                    <Search size={23} />
                    <strong>No available players found</strong>
                    <p>Try another name, position, or availability filter.</p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setQuery('');
                        setPosition('All');
                        setAvailability('All available');
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
              <SelectionFooter player={add} metric={metric} />
            </section>
          </div>
          <div className="waiver-snapshot-note">
            <CircleHelp size={14} />
            <span>
              {league.source === 'demo'
                ? 'Illustrative sample player pool'
                : `${wire.players.length} available players · Synced ${new Date(wire.syncedAt).toLocaleString()}`}
              . Availability reflects this snapshot; sync before making a claim.
              {wire.truncated
                ? ' Pool limited to ESPN’s 4,000 most-owned available active players.'
                : ''}{' '}
              ROS estimates use the same method as your roster and end at week
              17.
            </span>
          </div>
          <div
            className="panel trade-results waiver-results"
            aria-live="polite"
          >
            <div>
              <span className="eyebrow">
                PROJECTED PICKUP IMPACT · {period.toUpperCase()}
              </span>
              <h3>{title}</h3>
              <p>
                {!add || (!drop && !openSpot)
                  ? 'Choose one player on each side. You can compare different positions, including a bench drop.'
                  : `${drop ? drop.name : 'Open roster spot'} → ${add.name}. ${!comparison?.complete ? 'Missing projections or unfilled eligible slots prevent a complete lineup comparison.' : 'Starting lineups are optimized independently before and after the move; ROS sums each remaining week through week 17.'}`}
              </p>
            </div>
            <div className="trade-impact">
              <span>Selected player change</span>
              <strong
                className={
                  playerDelta !== null && playerDelta >= 0 ? 'green-text' : ''
                }
              >
                {playerDelta === null ? '—' : signed(playerDelta)}
              </strong>
              {add && drop && (
                <small>
                  {points(drop[metric])} → {points(add[metric])} pts
                </small>
              )}
            </div>
            <div className="trade-impact partner-impact">
              <span>Best lineup change</span>
              <strong
                className={
                  comparison?.delta !== null &&
                  comparison?.delta !== undefined &&
                  comparison.delta >= 0
                    ? 'green-text'
                    : ''
                }
              >
                {comparison?.delta === null || comparison?.delta === undefined
                  ? '—'
                  : signed(comparison.delta)}
              </strong>
              {comparison?.complete && (
                <small>
                  {points(comparison.before.total)} →{' '}
                  {points(comparison.after.total)} pts
                </small>
              )}
            </div>
          </div>
          <div className="trade-bottom">
            <span>
              <Shield size={14} />
              Local comparison · no claims submitted
            </span>
            <button
              className="button secondary"
              onClick={() => {
                setAddId(null);
                setDropId(null);
              }}
            >
              Reset comparison
            </button>
          </div>
        </>
      )}
    </>
  );
}
function WaiverRow({
  player: p,
  metric,
  selected,
  group,
  onSelect,
}: {
  player: Player | WaiverPlayer;
  metric: 'weekly' | 'ros';
  selected: boolean;
  group: string;
  onSelect: () => void;
}) {
  return (
    <label className={`trade-player waiver-player ${selected ? 'chosen' : ''}`}>
      <input type="radio" name={group} checked={selected} onChange={onSelect} />
      <Avatar player={p} />
      <span className="trade-player-name">
        <strong>{p.name}</strong>
        <small>
          {p.position} · {p.nflTeam}
          {metric === 'ros' && p.projectionSource === 'estimate'
            ? ' · EST.'
            : ''}
          {!('availability' in p) ? ` · ${p.slot}` : ''}
          {!['ACTIVE', 'NORMAL'].includes(p.status)
            ? ` · ${p.status.toLowerCase().replaceAll('_', ' ')}`
            : ''}
        </small>
        {'availability' in p && (
          <span
            className={`waiver-availability ${p.availability === 'WAIVERS' ? 'on-waivers' : ''}`}
          >
            {p.availability === 'WAIVERS' ? 'On waivers' : 'Free agent'}
            {p.percentOwned !== null
              ? ` · ${Math.round(p.percentOwned)}% owned`
              : ''}
          </span>
        )}
      </span>
      <span className="trade-player-points">
        {points(p[metric])}
        <small>{metric === 'ros' ? 'ROS' : 'WK'}</small>
      </span>
    </label>
  );
}
function SelectionFooter({
  player,
  metric,
}: {
  player: Player | undefined;
  metric: 'weekly' | 'ros';
}) {
  return (
    <div className="trade-picker-footer">
      <span>{player ? player.name : 'Choose a player'}</span>
      <strong>
        {player ? points(player[metric]) : '—'}{' '}
        <span className="league-cell-detail">
          {metric === 'ros' ? 'ROS points' : 'Weekly points'}
        </span>
      </strong>
    </div>
  );
}
