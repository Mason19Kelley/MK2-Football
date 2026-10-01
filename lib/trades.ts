import { League, Player } from './types';
// Maximum-weight bipartite matching via min-cost flow. Handles flex, superflex,
// duplicate position slots without assigning any player twice.
export function optimalLineup(
  players: Player[],
  slots: League['slots'],
  metric: 'weekly' | 'ros' = 'ros',
) {
  const expanded = slots.flatMap((s) =>
    Array.from({ length: s.count }, () => s),
  );
  if (expanded.length > 50)
    throw new Error(
      'Lineups with more than 50 starting slots are not supported.',
    );
  const usable = players.filter((p) => p[metric] !== null && p.slotId !== 21);
  const fast = conventionalLineup(usable, expanded, metric);
  if (fast)
    return {
      ...fast,
      slots: expanded.length,
      complete: expanded.length > 0 && fast.filled === expanded.length,
      missing: players.filter((p) => p[metric] === null).length,
    };
  const source = 0,
    playerStart = 1,
    slotStart = 1 + usable.length,
    sink = slotStart + expanded.length,
    n = sink + 1;
  type Edge = { to: number; rev: number; cap: number; cost: number };
  const graph: Edge[][] = Array.from({ length: n }, () => []);
  function add(from: number, to: number, cost: number) {
    graph[from].push({ to, rev: graph[to].length, cap: 1, cost });
    graph[to].push({
      to: from,
      rev: graph[from].length - 1,
      cap: 0,
      cost: -cost,
    });
  }
  usable.forEach((p, i) => {
    add(source, playerStart + i, 0);
    expanded.forEach((slot, j) => {
      if (p.eligibleSlots.includes(slot.id))
        add(playerStart + i, slotStart + j, -p[metric]!);
    });
  });
  expanded.forEach((_, j) => add(slotStart + j, sink, 0));
  let flow = 0,
    cost = 0;
  while (flow < expanded.length) {
    const dist = Array(n).fill(Infinity),
      prevNode = Array(n).fill(-1),
      prevEdge = Array(n).fill(-1);
    dist[source] = 0;
    for (let k = 0; k < n - 1; k++) {
      let changed = false;
      for (let u = 0; u < n; u++) {
        if (!Number.isFinite(dist[u])) continue;
        const edges = graph[u];
        for (let ei = 0; ei < edges.length; ei++) {
          const e = edges[ei];
          if (e.cap && dist[u] + e.cost < dist[e.to] - 1e-8) {
            dist[e.to] = dist[u] + e.cost;
            prevNode[e.to] = u;
            prevEdge[e.to] = ei;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    if (!Number.isFinite(dist[sink])) break;
    for (let v = sink; v !== source; v = prevNode[v]) {
      const e = graph[prevNode[v]][prevEdge[v]];
      e.cap--;
      graph[v][e.rev].cap++;
    }
    flow++;
    cost += dist[sink];
  }
  const selected = usable.filter((_, i) =>
    graph[playerStart + i].some(
      (e) => e.to >= slotStart && e.to < sink && e.cap === 0,
    ),
  );
  return {
    total: cost === 0 ? 0 : -cost,
    filled: flow,
    slots: expanded.length,
    players: selected,
    complete: expanded.length > 0 && flow === expanded.length,
    missing: players.filter((p) => p[metric] === null).length,
  };
}

// With ordinary position slots and one RB/WR/TE flex, the optimum is the
// strongest players at each position followed by the strongest remaining flex.
// Keep matching for unusual eligibility and ambiguous ties so its assignment
// behavior remains unchanged for superflex, custom slots and equal forecasts.
function conventionalLineup(
  players: Player[],
  slots: League['slots'],
  metric: 'weekly' | 'ros',
) {
  const native: Record<string, number> = {
    QB: 0,
    RB: 2,
    WR: 4,
    TE: 6,
    'D/ST': 16,
    K: 17,
  };
  const counts = new Map<number, number>();
  for (const slot of slots) {
    if (![0, 2, 4, 6, 16, 17, 23].includes(slot.id)) return;
    counts.set(slot.id, (counts.get(slot.id) ?? 0) + 1);
  }
  if ((counts.get(23) ?? 0) > 1) return;
  const groups = new Map<number, Player[]>();
  for (const p of players) {
    const eligibility = [
      ...new Set(p.eligibleSlots.filter((id) => counts.has(id))),
    ];
    if (!eligibility.length) continue;
    if (!Number.isFinite(p[metric])) return;
    const position = native[p.position];
    const expected = [
      ...(counts.has(position) ? [position] : []),
      ...(counts.has(23) && [2, 4, 6].includes(position) ? [23] : []),
    ];
    if (
      eligibility.length !== expected.length ||
      expected.some((id) => !eligibility.includes(id))
    )
      return;
    const group = groups.get(position) ?? [];
    group.push(p);
    groups.set(position, group);
  }
  const selected = new Set<Player>();
  const flex: Player[] = [];
  const order = (a: Player, b: Player) => b[metric]! - a[metric]!;
  for (const [position, group] of groups) {
    group.sort(order);
    const count = Math.min(counts.get(position) ?? 0, group.length);
    if (
      count &&
      count < group.length &&
      Math.abs(group[count - 1][metric]! - group[count][metric]!) <= 1e-8
    )
      return;
    group.slice(0, count).forEach((p) => selected.add(p));
    if ([2, 4, 6].includes(position)) flex.push(...group.slice(count));
  }
  if (counts.has(23) && flex.length) {
    flex.sort(order);
    if (
      flex.length > 1 &&
      Math.abs(flex[0][metric]! - flex[1][metric]!) <= 1e-8
    )
      return;
    selected.add(flex[0]);
  }
  const lineup = players.filter((p) => selected.has(p));
  return {
    total: lineup.reduce((sum, p) => sum + p[metric]!, 0),
    filled: lineup.length,
    players: lineup,
  };
}
export function applyTrade(
  mine: Player[],
  theirs: Player[],
  send: number[],
  receive: number[],
) {
  if (
    new Set(send).size !== send.length ||
    new Set(receive).size !== receive.length
  )
    throw new Error('Duplicate trade selection.');
  if (
    send.some((id) => !mine.some((p) => p.id === id)) ||
    receive.some((id) => !theirs.some((p) => p.id === id))
  )
    throw new Error('Selected player is not on this roster.');
  return {
    mine: [
      ...mine.filter((p) => !send.includes(p.id)),
      ...theirs.filter((p) => receive.includes(p.id)),
    ],
    theirs: [
      ...theirs.filter((p) => !receive.includes(p.id)),
      ...mine.filter((p) => send.includes(p.id)),
    ],
  };
}
