import { League, Player } from './types';
export function parseProjectionCSV(
  text: string,
  league: League,
): Map<number, number> {
  const rows = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .filter((r) => r.trim());
  if (rows.length < 2)
    throw new Error('Add a header and at least one player row.');
  const headers = rows[0].split(',').map((s) => s.trim().toLowerCase());
  const idCol = headers.indexOf('player_id'),
    pointsCol = headers.indexOf('ros_points');
  if (idCol < 0 || pointsCol < 0)
    throw new Error('CSV needs player_id and ros_points columns.');
  const ids = new Set(
    [
      ...league.teams.flatMap((t) => t.players),
      ...(league.waiverWire?.players ?? []),
    ].map((p) => p.id),
  );
  const result = new Map<number, number>();
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(',');
    const id = Number(cells[idCol]?.trim()),
      value = Number(cells[pointsCol]?.trim());
    if (
      !cells[idCol]?.trim() ||
      !cells[pointsCol]?.trim() ||
      !Number.isInteger(id) ||
      !Number.isFinite(value) ||
      value < 0
    )
      throw new Error(`Invalid player ID or points on row ${i + 1}.`);
    if (!ids.has(id))
      throw new Error(
        `Player ${id} on row ${i + 1} is not on a league roster or the waiver wire.`,
      );
    if (result.has(id))
      throw new Error(`Duplicate player ${id} on row ${i + 1}.`);
    result.set(id, value);
  }
  return result;
}
export function applyProjections(
  league: League,
  values: Map<number, number>,
): League {
  const update = <T extends Player>(p: T): T =>
    values.has(p.id)
      ? {
          ...p,
          ros: values.get(p.id)!,
          projectionSource: 'custom',
          forecastUpdatedAt: new Date().toISOString(),
          forecastProvenance: 'Manager ROS CSV (league scoring)',
        }
      : p;
  return {
    ...league,
    ...(league.waiverWire
      ? {
          waiverWire: {
            ...league.waiverWire,
            players: league.waiverWire.players.map(update),
          },
        }
      : {}),
    teams: league.teams.map((t) => ({
      ...t,
      players: t.players.map(update),
    })),
  };
}

export type ForecastRow = {
  playerId: number;
  week: number;
  points?: number;
  bounds?: { lower: number; upper: number };
  availabilityProbability?: number;
  returnWeek?: number;
  scoreStdDev?: number;
  roleStdDev?: number;
};
// week=0 is a ROS total; other weeks are league-scoring weekly points.
export function parseForecastCSV(text: string, league: League): ForecastRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2)
    throw new Error('Add a header and at least one forecast row.');
  const headers = lines[0].split(',').map((s) => s.trim().toLowerCase());
  if (!headers.includes('player_id') || !headers.includes('week'))
    throw new Error('Forecast CSV needs player_id and week columns.');
  if (new Set(headers).size !== headers.length)
    throw new Error('Forecast CSV has duplicate columns.');
  const ids = new Set(
    [
      ...league.teams.flatMap((t) => t.players),
      ...(league.waiverWire?.players ?? []),
    ].map((p) => p.id),
  );
  const seen = new Set<string>(),
    metadata = new Map<number, Record<string, number>>();
  return lines.slice(1).map((line, index) => {
    const cells = line.split(','),
      row = index + 2;
    const number = (key: string) => {
      const column = headers.indexOf(key),
        raw = column < 0 ? '' : cells[column]?.trim();
      if (!raw) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Invalid ${key} on row ${row}.`);
      return n;
    };
    const playerId = number('player_id'),
      week = number('week');
    if (
      playerId === undefined ||
      !Number.isInteger(playerId) ||
      !ids.has(playerId)
    )
      throw new Error(`Unknown player on row ${row}.`);
    if (
      week === undefined ||
      !Number.isInteger(week) ||
      week < 0 ||
      week > league.finalWeek
    )
      throw new Error(`Invalid week on row ${row}.`);
    const key = `${playerId}:${week}`;
    if (seen.has(key)) throw new Error(`Duplicate player/week on row ${row}.`);
    seen.add(key);
    const points = number('weekly_points'),
      lower = number('lower_points'),
      upper = number('upper_points');
    if (
      (lower === undefined) !== (upper === undefined) ||
      (lower !== undefined && upper !== undefined && lower > upper)
    )
      throw new Error(
        `Supply ordered lower_points and upper_points on row ${row}.`,
      );
    if (
      points !== undefined &&
      lower !== undefined &&
      (points < lower || points > upper!)
    )
      throw new Error(`Forecast is outside its bounds on row ${row}.`);
    if (
      week === 0 &&
      [points, lower, upper].some((n) => n !== undefined && n < 0)
    )
      throw new Error(`ROS points cannot be negative on row ${row}.`);
    const availabilityProbability = number('availability_probability'),
      returnWeek = number('return_week'),
      scoreStdDev = number('score_stddev'),
      roleStdDev = number('role_stddev');
    if (
      availabilityProbability !== undefined &&
      (availabilityProbability < 0 || availabilityProbability > 1)
    )
      throw new Error(`Invalid availability probability on row ${row}.`);
    if (
      returnWeek !== undefined &&
      (!Number.isInteger(returnWeek) ||
        returnWeek < league.week ||
        returnWeek > league.finalWeek)
    )
      throw new Error(`Invalid return week on row ${row}.`);
    if (
      (scoreStdDev !== undefined && scoreStdDev < 0) ||
      (roleStdDev !== undefined && (roleStdDev < 0 || roleStdDev > 2))
    )
      throw new Error(`Invalid standard deviation on row ${row}.`);
    const fields = {
      availabilityProbability,
      returnWeek,
      scoreStdDev,
      roleStdDev,
    };
    const previous = metadata.get(playerId) ?? {};
    for (const [name, value] of Object.entries(fields))
      if (value !== undefined) {
        if (previous[name] !== undefined && previous[name] !== value)
          throw new Error(`Conflicting ${name} for player ${playerId}.`);
        previous[name] = value;
      }
    metadata.set(playerId, previous);
    if (
      points === undefined &&
      lower === undefined &&
      Object.values(fields).every((v) => v === undefined)
    )
      throw new Error(`Empty forecast row ${row}.`);
    return {
      playerId,
      week,
      points,
      bounds: lower === undefined ? undefined : { lower, upper: upper! },
      ...fields,
    };
  });
}
export function applyForecasts(league: League, rows: ForecastRow[]): League {
  const timestamp = new Date().toISOString();
  const update = <T extends Player>(p: T): T => {
    const own = rows.filter((row) => row.playerId === p.id);
    if (!own.length) return p;
    const next = {
      ...p,
      weeklyOverrides: { ...p.weeklyOverrides },
      projectionBounds: {
        ros: p.projectionBounds?.ros,
        weekly: { ...p.projectionBounds?.weekly },
      },
      forecastUpdatedAt: timestamp,
      forecastProvenance: 'Manager CSV (league scoring)',
    };
    for (const row of own) {
      if (row.points !== undefined) {
        if (row.week === 0) {
          next.ros = row.points;
          next.projectionSource = 'custom';
        } else {
          next.weeklyOverrides[row.week] = row.points;
          if (row.week === league.week) next.weekly = row.points;
        }
      }
      if (row.bounds) {
        if (row.week === 0) next.projectionBounds.ros = row.bounds;
        else next.projectionBounds.weekly[row.week] = row.bounds;
      }
      for (const field of [
        'availabilityProbability',
        'returnWeek',
        'scoreStdDev',
        'roleStdDev',
      ] as const)
        if (row[field] !== undefined) next[field] = row[field];
    }
    return next;
  };
  return {
    ...league,
    teams: league.teams.map((t) => ({ ...t, players: t.players.map(update) })),
    ...(league.waiverWire
      ? {
          waiverWire: {
            ...league.waiverWire,
            players: league.waiverWire.players.map(update),
          },
        }
      : {}),
  };
}

// Refresh live ESPN data without losing manager forecasts for the same league/season.
export function preserveForecastOverrides(
  fresh: League,
  previous: League,
): League {
  if (fresh.id !== previous.id || fresh.season !== previous.season)
    return fresh;
  const old = new Map(
    [
      ...previous.teams.flatMap((t) => t.players),
      ...(previous.waiverWire?.players ?? []),
    ].map((p) => [p.id, p]),
  );
  const update = <T extends Player>(p: T): T => {
    const prior = old.get(p.id);
    if (!prior) return p;
    const next = { ...p };
    if (prior.projectionSource === 'custom' && prior.ros !== null) {
      next.ros = prior.ros;
      next.projectionSource = 'custom';
    }
    for (const key of [
      'weeklyOverrides',
      'projectionBounds',
      'forecastUpdatedAt',
      'forecastProvenance',
      'availabilityProbability',
      'returnWeek',
      'scoreStdDev',
      'roleStdDev',
    ] as const) {
      if (prior[key] !== undefined) Object.assign(next, { [key]: prior[key] });
    }
    return next;
  };
  return {
    ...fresh,
    teams: fresh.teams.map((t) => ({ ...t, players: t.players.map(update) })),
    ...(fresh.waiverWire
      ? {
          waiverWire: {
            ...fresh.waiverWire,
            players: fresh.waiverWire.players.map(update),
          },
        }
      : {}),
  };
}
