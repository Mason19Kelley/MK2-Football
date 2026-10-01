'use client';

import { useMemo, useState } from 'react';
import { League, Team, Player, points, positions } from '@/lib/types';
import { playerWeek, evaluateRoster } from '@/lib/weekly-trades';
import type { SeasonForecast } from '@/lib/season-forecast';
import Avatar from './player-avatar';

type Matchup = SeasonForecast['matchups'][number];

function MatchupRoster({
  team,
  league,
  week,
}: {
  team: Team;
  league: League;
  week: number;
}) {
  const { starters, bench, ir, lineup } = useMemo(() => {
    const roster = team.players.map((player) => {
      const forecast = playerWeek(player, league, week);
      return { player, forecast };
    });
    const lineup = evaluateRoster(
      league,
      team.players,
      'remaining',
      undefined,
      undefined,
      { streaming: false },
    ).weeks.find((w) => w.week === week)!;
    const pickups = lineup.replacements.map((player) => ({
      player,
      forecast: playerWeek(player, league, week),
    }));
    const ids = new Set(lineup.players.map((p) => p.id));
    return {
      lineup,
      starters: [
        ...roster.filter(({ player }) => ids.has(player.id)),
        ...pickups,
      ],
      bench: roster.filter(
        ({ player }) => !ids.has(player.id) && player.slotId !== 21,
      ),
      ir: roster.filter(({ player }) => player.slotId === 21),
    };
  }, [team, league, week]);
  const pickupIds = new Set(lineup.replacements.map((p) => p.id));
  const groups = [
    { label: 'Starting lineup', players: starters },
    { label: 'Bench', players: bench },
    ...(ir.length ? [{ label: 'Injured reserve', players: ir }] : []),
  ];
  const status = (player: Player, unavailable: boolean) =>
    player.byeWeek === week
      ? 'Bye'
      : player.slotId === 21
        ? 'IR'
        : unavailable
          ? player.status
          : week === league.week && player.status !== 'ACTIVE'
            ? player.status
            : '';
  return (
    <section
      className="matchup-roster"
      aria-label={`${team.name} Week ${week} roster`}
    >
      <div className="matchup-roster-heading">
        <h3>{team.name}</h3>
        <span>
          Week {week} starter projections{' '}
          <strong>{points(lineup.total)}</strong>
        </span>
      </div>
      {groups.map(({ label, players }) => (
        <div className="matchup-roster-group" key={label}>
          <h4>
            {label}
            <span>{players.length}</span>
          </h4>
          {players.length ? (
            <ul>
              {[...players]
                .sort(
                  (a, b) =>
                    positions.indexOf(a.player.position) -
                    positions.indexOf(b.player.position),
                )
                .map(({ player, forecast }) => (
                  <li key={player.id} data-player-id={player.id}>
                    <Avatar player={player} />
                    <div className="matchup-player-name">
                      <strong>{player.name}</strong>
                      <small>
                        {player.position} · {player.nflTeam}
                        {pickupIds.has(player.id) && (
                          <span className="waiver-pickup-label">
                            {' '}
                            · Waiver wire pickup
                          </span>
                        )}
                        {status(player, forecast.unavailable) &&
                          ` · ${status(player, forecast.unavailable)}`}
                      </small>
                    </div>
                    <div className="matchup-player-projection">
                      <strong>{points(forecast.points)}</strong>
                      <small>
                        {forecast.points === null
                          ? 'Unavailable'
                          : forecast.estimated
                            ? 'Estimated'
                            : ''}
                      </small>
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="matchup-empty">No players</p>
          )}
          {label === 'Starting lineup' && !lineup.complete && (
            <p className="matchup-empty">
              {lineup.slots - lineup.filled} starting slot(s) unfilled with
              available projections.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

export default function MatchupDetails({
  league,
  team,
  matchup,
}: {
  league: League;
  team: Team;
  matchup: Matchup;
}) {
  const weeks = [...matchup.weeks].sort((a, b) => a - b);
  const [week, setWeek] = useState(weeks[0]);
  const home = matchup.homeId === team.id;
  const opponent = league.teams.find(
    (t) => t.id === (home ? matchup.awayId : matchup.homeId),
  )!;
  return (
    <>
      <div className="eyebrow">
        MATCHUP PREVIEW ·{' '}
        {weeks.length === 1 ? `WEEK ${week}` : `WEEKS ${weeks.join(', ')}`}
      </div>
      <h2>
        {team.name} <span className="matchup-versus">vs.</span> {opponent.name}
      </h2>
      <div className="matchup-scoreline">
        <span>
          {team.name}
          <strong>
            {points(home ? matchup.homePoints : matchup.awayPoints)}
          </strong>
        </span>
        <span className="matchup-win-chance">
          Chance to win
          <strong>
            {(
              (home ? matchup.homeWinChance : matchup.awayWinChance) * 100
            ).toFixed(1)}
            %
          </strong>
        </span>
        <span>
          {opponent.name}
          <strong>
            {points(home ? matchup.awayPoints : matchup.homePoints)}
          </strong>
        </span>
      </div>
      <p className="matchup-projection-note">
        Projected starting lineups are optimized for each week from current
        rosters, including projected K/D/ST waiver wire pickups. Player points
        sum to the projected lineup totals
        {weeks.length > 1 ? ' across all matchup weeks' : ''}. Win chances use
        simulations that account for availability and scoring variation.
      </p>
      {weeks.length > 1 && (
        <label className="matchup-week-select">
          Show player projections for{' '}
          <select
            aria-label="Matchup projection week"
            value={week}
            onChange={(event) => setWeek(Number(event.target.value))}
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="matchup-rosters">
        <MatchupRoster team={team} league={league} week={week} />
        <MatchupRoster team={opponent} league={league} week={week} />
      </div>
    </>
  );
}
