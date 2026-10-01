import { League, Player } from './types';
import {
  horizonWeeks,
  playerWeek,
  specialistStreamingCandidates,
  TradeEvaluation,
  TradeHorizon,
} from './weekly-trades';
import type { FindTradeOptions } from './trade-finder';

const slotIds = [0, 2, 4, 6, 16, 17, 23];
const positionIndex = { QB: 0, RB: 1, WR: 2, TE: 3, 'D/ST': 4, K: 5 };
const slotMask = (p: Player) =>
  p.eligibleSlots.reduce((mask, id) => {
    const index = slotIds.indexOf(id);
    return index < 0 ? mask : mask | (1 << index);
  }, 0);
export type TradeRosterEngine = {
  evaluate: (
    roster: Player[],
    horizon: TradeHorizon,
  ) => TradeEvaluation | undefined;
  // Search summaries defer display metadata until a surviving offer reads it.
  evaluateForSearch?: TradeRosterEngine['evaluate'];
  dispose: () => void;
};
type ScorerExports = {
  memory: WebAssembly.Memory;
  benchmark_alloc: (length: number) => number;
  benchmark_free: (pointer: number, length: number) => void;
  benchmark_error_ptr: () => number;
  benchmark_error_len: () => number;
  scorer_load: (pointer: number, length: number) => number;
  scorer_evaluate: (
    pointer: number,
    length: number,
    first: number,
    last: number,
  ) => number;
  scorer_output_ptr: () => number;
  scorer_output_len: () => number;
  scorer_clear: () => void;
  scorer_version: () => number;
};

export function supportsWasmScoring(league: League, options: FindTradeOptions) {
  const horizon = options.horizon ?? 'ros';
  return (
    (options.objective ?? 'points') === 'points' &&
    !options.scenarios &&
    (options.waiverBaseline ?? true) &&
    horizon !== 'ros' &&
    (!options.partnerHorizon || options.partnerHorizon === horizon) &&
    league.slots.every((s) => slotIds.includes(s.id)) &&
    league.slots.reduce((count, s) => count + s.count, 0) <= 50 &&
    ![
      ...league.teams.flatMap((t) => t.players),
      ...(league.waiverWire?.players ?? []),
    ].some((p) => p.projectionBounds)
  );
}

// All imports/forecasts are immutable for the lifetime of this search worker.
// Unsupported model modes retain the existing TypeScript evaluator.
export async function createWasmScorer(
  league: League,
  options: FindTradeOptions,
  bytes?: BufferSource,
): Promise<TradeRosterEngine | undefined> {
  if (
    !supportsWasmScoring(league, options) ||
    typeof WebAssembly === 'undefined'
  )
    return;
  const moduleBytes =
    bytes ??
    (await (async () => {
      const response = await fetch('/trade-scorer-v1.wasm', {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new Error(`Scorer fetch failed: ${response.status}`);
      return response.arrayBuffer();
    })());
  const { instance } = await WebAssembly.instantiate(moduleBytes, {});
  const api = instance.exports as unknown as ScorerExports;
  if (typeof api.scorer_version !== 'function' || api.scorer_version() !== 1)
    throw new Error('Unsupported scorer ABI');
  const error = () =>
    new TextDecoder().decode(
      new Uint8Array(
        api.memory.buffer,
        api.benchmark_error_ptr(),
        api.benchmark_error_len(),
      ),
    );
  const allWeeks = horizonWeeks(league, 'remaining');
  const wire = new Map(league.waiverWire?.players.map((p) => [p.id, p]));
  type Entry = {
    player: Player;
    values: ReturnType<typeof playerWeek>[];
    projected: Player[];
  };
  const entries: Entry[] = [];
  // Active and IR entries for the same player are scored separately.
  const indices = {
    active: new Map<number, number>(),
    ir: new Map<number, number>(),
  };
  const indexMap = (p: Player) =>
    p.slotId === 21 ? indices.ir : indices.active;
  const add = (p: Player) => {
    const values = allWeeks.map((week) => playerWeek(p, league, week));
    const index = entries.length;
    entries.push({
      player: p,
      values,
      projected: values.map((value) => ({
        ...p,
        weekly: value.points,
        eligibleSlots: value.unavailable ? [] : p.eligibleSlots,
      })),
    });
    return index;
  };
  for (const p of [
    ...league.teams.flatMap((t) => t.players),
    ...(league.waiverWire?.players ?? []),
  ]) {
    if (!indexMap(p).has(p.id)) indexMap(p).set(p.id, add(p));
  }
  const specialistIndices = new Map<number, number>();
  const specialistCache = new Map<number, Player[]>();
  const specialists = allWeeks.map((week, offset) =>
    specialistStreamingCandidates(league, [], week, specialistCache).map(
      (p) => {
        let index = specialistIndices.get(p.id);
        if (index === undefined) {
          index = add({
            ...wire.get(p.id)!,
            slotId: 20,
            slot: 'BN',
            eligibleSlots: p.eligibleSlots,
          });
          specialistIndices.set(p.id, index);
        }
        entries[index].projected[offset] = p;
        return index;
      },
    ),
  );
  const model = {
    slots: league.slots.flatMap((s) =>
      Array.from({ length: s.count }, () => slotIds.indexOf(s.id)),
    ),
    players: entries.map(({ player: p, values }) => ({
      id: p.id,
      position: positionIndex[p.position],
      eligibility: slotMask(p),
      ir: p.slotId === 21,
      ros: p.ros,
      weekly: values.map((v) => v.points),
      unavailable: values.map((v) => v.unavailable),
    })),
    specialists,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(model));
  const loadPointer = api.benchmark_alloc(encoded.length);
  try {
    new Uint8Array(api.memory.buffer, loadPointer, encoded.length).set(encoded);
    if (!api.scorer_load(loadPointer, encoded.length)) throw new Error(error());
  } finally {
    api.benchmark_free(loadPointer, encoded.length);
  }
  // Reuse one small buffer for roster indices instead of allocating per score.
  const capacity = entries.length + 2;
  const pointer = api.benchmark_alloc(capacity * 4);
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    api.benchmark_free(pointer, capacity * 4);
    api.scorer_clear();
  };
  const starting = new Set(
    league.slots.filter((s) => s.count > 0).map((s) => s.id),
  );
  // Roster clones (e.g. benched pickups) share their eligibleSlots array.
  const relevance = new WeakMap<number[], boolean>();
  const isRelevant = (p: Player) => {
    let known = relevance.get(p.eligibleSlots);
    if (known === undefined) {
      known = p.eligibleSlots.some((id) => starting.has(id));
      relevance.set(p.eligibleSlots, known);
    }
    return known;
  };
  const periods = new Map<
    TradeHorizon,
    { weeks: number[]; first: number; last: number }
  >();
  const period = (horizon: TradeHorizon) => {
    let known = periods.get(horizon);
    if (!known) {
      const weeks = horizonWeeks(league, horizon);
      const first = weeks.length ? allWeeks.indexOf(weeks[0]) : allWeeks.length;
      known = { weeks, first, last: first + weeks.length };
      periods.set(horizon, known);
    }
    return known;
  };
  let indexView: Uint32Array | undefined;
  const evaluate = (
    roster: Player[],
    horizon: TradeHorizon,
    eager: boolean,
  ): TradeEvaluation | undefined => {
    if (!active || horizon === 'ros') return;
    const relevant: Player[] = [];
    const offsets: number[] = [];
    for (const p of roster) {
      if (!isRelevant(p)) continue;
      const index = indexMap(p).get(p.id);
      if (index === undefined) return;
      relevant.push(p);
      offsets.push(index);
    }
    if (relevant.length > capacity) return;
    const { weeks, first, last } = period(horizon);
    try {
      // Memory growth detaches earlier views; rebuild only when that happens.
      if (indexView?.buffer !== api.memory.buffer)
        indexView = new Uint32Array(api.memory.buffer, pointer, capacity);
      indexView.set(offsets);
      if (!api.scorer_evaluate(pointer, offsets.length, first, last))
        throw new Error(error());
      const result = new Float64Array(
        api.memory.buffer,
        api.scorer_output_ptr(),
        api.scorer_output_len(),
      );
      const filled = result[1],
        slots = result[2],
        complete = Boolean(result[3]);
      // WASM overwrites its output on the next score. Keep a compact numeric
      // snapshot, then reconstruct Player arrays only for baseline/final offers.
      const snapshot = result.slice();
      let cursor = 4 + filled;
      let total = 0,
        missing = 0;
      for (let w = 0; w < weeks.length; w++) {
        total += snapshot[cursor++];
        const selected = snapshot[cursor++];
        missing += snapshot[cursor++];
        cursor += selected;
      }
      // Only drop pruning reads used players; collect them on first access.
      let usedPlayerIds: number[] | undefined;
      const collectUsed = () => {
        if (usedPlayerIds) return usedPlayerIds;
        const used = new Set<number>();
        let cursor = 4 + filled;
        for (let w = 0; w < weeks.length; w++) {
          const selected = snapshot[cursor + 1];
          cursor += 3;
          for (let i = 0; i < selected; i++)
            used.add(entries[snapshot[cursor++]].player.id);
        }
        return (usedPlayerIds = [...used]);
      };
      let details: Pick<TradeEvaluation, 'players' | 'weeks'> | undefined;
      const materialize = () => {
        if (details) return details;
        let cursor = 4;
        const current = new Map(
          offsets.map((index, i) => [index, relevant[i]]),
        );
        const players = Array.from({ length: filled }, () =>
          current.get(snapshot[cursor++])!,
        );
        const owned = new Set(roster.map((p) => p.id));
        const lineups = weeks.map((week, w) => {
          const total = snapshot[cursor++],
            filled = snapshot[cursor++],
            missing = snapshot[cursor++];
          const selected = Array.from(
            { length: filled },
            () => snapshot[cursor++],
          );
          const players = selected.map(
            (index) => entries[index].projected[first + w],
          );
          return {
            total,
            filled,
            slots,
            players,
            complete: slots > 0 && filled === slots,
            missing,
            week,
            replacements: players.filter((p) => !owned.has(p.id)),
            estimated: selected.filter(
              (index) => entries[index].values[first + w].estimated,
            ).length,
            unknownByes: players.filter((p) => p.byeWeek === undefined).length,
          };
        });
        return (details = { players, weeks: lineups });
      };
      if (eager) materialize();
      return {
        total,
        filled,
        slots,
        get players() {
          return materialize().players;
        },
        complete,
        missing,
        get weeks() {
          return materialize().weeks;
        },
        upperTotal: total,
        bounded: false,
        get usedPlayerIds() {
          return collectUsed();
        },
      };
    } catch (failure) {
      dispose();
      console.warn('WASM scoring failed; continuing with TypeScript.', failure);
      return;
    }
  };
  return {
    dispose,
    evaluate: (roster, horizon) => evaluate(roster, horizon, true),
    evaluateForSearch: (roster, horizon) => evaluate(roster, horizon, false),
  };
}
