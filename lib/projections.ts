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
      ? { ...p, ros: values.get(p.id)!, projectionSource: 'custom' }
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
