import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { demoLeague } from '../../lib/demo';
import { League, Player } from '../../lib/types';
import {
  evaluateRoster,
  horizonWeeks,
  playerWeek,
  specialistStreamingCandidates,
  TradeEvaluation,
} from '../../lib/weekly-trades';

// This prototype measures native Rust roster scoring, not a deployed backend
// or a complete Rust port of trade planning. The full TS search supplies the
// exact roster workload; Rust receives it once and evaluates the whole batch.
const root = path.resolve(import.meta.dirname, '../..');
const slotIndex = new Map([
  [0, 0],
  [2, 1],
  [4, 2],
  [6, 3],
  [16, 4],
  [17, 5],
  [23, 6],
]);
const positionIndex = { QB: 0, RB: 1, WR: 2, TE: 3, 'D/ST': 4, K: 5 };
type Entry = {
  id: number;
  position: number;
  eligibility: number;
  ir: boolean;
  ros: number | null;
  weekly: (number | null)[];
  unavailable: boolean[];
};
type Expected = {
  total: number;
  missing: number;
  complete: boolean;
  weekTotals: number[];
  weekFilled: number[];
  weekSelected: number[][];
};
async function main() {
  const args = process.argv.slice(2);
  const snapshotPath = args[0];
  if (!snapshotPath)
    throw new Error(
      'Usage: npm run benchmark:rust -- SNAPSHOT.json MY_TEAM PARTNER [RUNS] (or --demo)',
    );
  const myTeamId = Number(args[1] ?? (snapshotPath === '--demo' ? 1 : 3));
  const partnerId = Number(args[2] ?? (snapshotPath === '--demo' ? 2 : 1));
  const runs = Number(args[3] ?? 3);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('RUNS must be a positive integer');
  const player = (p: Player) => ({
    ...p,
    name: p.name ?? String(p.id),
    slot: p.slot ?? String(p.slotId),
    season: p.season ?? null,
    actual: p.actual ?? null,
  });
  const snapshot =
    snapshotPath === '--demo'
      ? {
          league: demoLeague,
          settings: {
            horizon: 'remaining',
            objective: 'points',
            waiverBaseline: true,
          },
        }
      : JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  const league: League = {
    name: 'Benchmark',
    source: 'espn',
    warnings: [],
    syncedAt: snapshot.sourceSyncedAt,
    ...snapshot.league,
    teams: snapshot.league.teams.map((t: League['teams'][number]) => ({
      ...t,
      name: t.name ?? `Team ${t.id}`,
      abbreviation: t.abbreviation ?? String(t.id),
      owner: t.owner ?? '',
      players: t.players.map(player),
    })),
    waiverWire: snapshot.league.waiverWire && {
      ...snapshot.league.waiverWire,
      players: snapshot.league.waiverWire.players.map(player),
    },
  };
  const horizon = snapshot.settings.horizon;
  if (
    !['remaining', 'next3', 'playoffs'].includes(horizon) ||
    snapshot.settings.scenarios ||
    snapshot.settings.objective !== 'points' ||
    !snapshot.settings.waiverBaseline ||
    league.slots.some((s) => s.count && !slotIndex.has(s.id)) ||
    [
      ...league.teams.flatMap((t) => t.players),
      ...(league.waiverWire?.players ?? []),
    ].some((p) => p.projectionBounds)
  ) {
    throw new Error(
      'Prototype supports deterministic weekly point searches with the waiver baseline, ordinary slots, and no projection bounds.',
    );
  }
  const weeks = horizonWeeks(league, horizon);
  const entries: Entry[] = [];
  const sourcePlayers: Player[] = [];
  const ids = new Map<string, number>();
  const mask = (p: Player) =>
    p.eligibleSlots.reduce(
      (value, id) => value | (slotIndex.has(id) ? 1 << slotIndex.get(id)! : 0),
      0,
    );
  const register = (p: Player) => {
    const key = JSON.stringify([p.id, p.slotId, p.eligibleSlots]);
    let index = ids.get(key);
    if (index !== undefined) return index;
    index = entries.length;
    ids.set(key, index);
    const values = weeks.map((week) => playerWeek(p, league, week));
    entries.push({
      id: p.id,
      position: positionIndex[p.position],
      eligibility: mask(p),
      ir: p.slotId === 21,
      ros: p.ros,
      weekly: values.map((v) => v.points),
      unavailable: values.map((v) => v.unavailable),
    });
    sourcePlayers.push(p);
    return index;
  };
  const specialistIds = new Map<number, number>();
  const specialistCache = new Map<number, Player[]>();
  const specialists = weeks.map((week, w) =>
    specialistStreamingCandidates(league, [], week, specialistCache).map(
      (p) => {
        let index = specialistIds.get(p.id);
        if (index === undefined) {
          index = entries.length;
          specialistIds.set(p.id, index);
          entries.push({
            id: p.id,
            position: positionIndex[p.position],
            eligibility: mask(p),
            ir: false,
            ros: p.ros,
            weekly: weeks.map(() => null),
            unavailable: weeks.map(() => false),
          });
          sourcePlayers.push(p);
        }
        entries[index].weekly[w] = p.weekly;
        return index;
      },
    ),
  );
  const rosters: number[][] = [],
    expected: Expected[] = [];
  let referenceKernelMs = 0;
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ff-rust-benchmark-'),
  );
  const hook = globalThis as typeof globalThis & {
    __tradeBenchmark?: (
      roster: Player[],
      value: TradeEvaluation,
      elapsed: number,
    ) => void;
  };
  try {
    await fs.cp(path.join(root, 'lib'), path.join(temporary, 'lib'), {
      recursive: true,
    });
    const weeklyFile = path.join(temporary, 'lib/weekly-trades.ts');
    const code = (await fs.readFile(weeklyFile, 'utf8')).replace(
      'export function evaluateRoster(',
      'function originalEvaluateRoster(',
    );
    await fs.writeFile(
      weeklyFile,
      code +
        `\nexport function evaluateRoster(...args: Parameters<typeof originalEvaluateRoster>) {\n const start=performance.now();\n const result=originalEvaluateRoster(...args);\n const elapsed=performance.now()-start;\n (globalThis as any).__tradeBenchmark?.(args[1],result,elapsed);\n return result;\n}\n`,
    );
    hook.__tradeBenchmark = (roster, value, elapsed) => {
      referenceKernelMs += elapsed;
      rosters.push(roster.map(register));
      expected.push({
        total: value.total,
        missing: value.missing,
        complete: value.complete,
        weekTotals: value.weeks.map((w) => w.total),
        weekFilled: value.weeks.map((w) => w.filled),
        weekSelected: value.weeks.map((w) => w.players.map((p) => p.id)),
      });
    };
    const { findTrades } = await import(
      pathToFileURL(path.join(temporary, 'lib/trade-finder.ts')).href
    );
    console.log('Capturing the exact TypeScript search workload…');
    const start = performance.now();
    let last = start;
    const result = await findTrades(league, myTeamId, {
      ...snapshot.settings,
      partnerId,
      maxPlayers: 1,
      minimumGain: 1,
      partnerMinimumGain: 1,
      ranking: 'mine',
      onProgress: (checked: number) => {
        const now = performance.now();
        if (now - last > 10000) {
          console.log(
            `Captured ${checked} trades, ${rosters.length} roster evaluations`,
          );
          last = now;
        }
      },
    });
    const captureSearchMs = performance.now() - start;
    delete hook.__tradeBenchmark;
    const output = path.join(root, 'data/trade-history/rust-benchmark');
    await fs.mkdir(output, { recursive: true });
    const corpusPath = path.join(output, 'corpus.json');
    const corpus = {
      slots: league.slots.flatMap((s) =>
        Array.from({ length: s.count }, () => slotIndex.get(s.id)!),
      ),
      players: entries,
      specialists,
      rosters,
      expected,
    };
    await fs.writeFile(corpusPath, JSON.stringify(corpus));
    console.log(
      `Captured ${rosters.length} evaluations; replaying the TypeScript kernel…`,
    );
    const projectionCache = new Map();
    const replacementCache = new Map();
    let checksum = 0;
    const replayStart = performance.now();
    for (let i = 0; i < rosters.length; i++) {
      const value = evaluateRoster(
        league,
        rosters[i].map((index) => sourcePlayers[index]),
        horizon,
        projectionCache,
        replacementCache,
        { streaming: false, specialistCache },
      );
      const target = expected[i];
      assert.ok(Math.abs(value.total - target.total) < 1e-7);
      assert.equal(value.missing, target.missing);
      assert.equal(value.complete, target.complete);
      for (let w = 0; w < weeks.length; w++) {
        assert.ok(Math.abs(value.weeks[w].total - target.weekTotals[w]) < 1e-7);
        assert.equal(value.weeks[w].filled, target.weekFilled[w]);
        assert.deepEqual(
          value.weeks[w].players.map((p) => p.id),
          target.weekSelected[w],
        );
      }
      checksum += value.total;
    }
    const typescriptReplayMs = performance.now() - replayStart;
    const binary = path.join(
      root,
      'benchmarks/rust-trades/target/release/trade-kernel-benchmark',
    );
    const processStart = performance.now();
    const native = spawnSync(binary, [corpusPath, String(runs)], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const nativeProcessMs = performance.now() - processStart;
    if (native.status !== 0)
      throw new Error(
        native.stderr || native.error?.message || 'Rust benchmark failed',
      );
    const rust = JSON.parse(native.stdout);
    assert.ok(Math.abs(rust.checksum - checksum) < 1e-4);
    const median = [...rust.runsMs].sort((a, b) => a - b)[Math.floor(runs / 2)];
    const report = {
      generatedAt: new Date().toISOString(),
      scope:
        'Native roster-scoring replay; not full Rust trade search or browser WASM',
      leagueId: league.id,
      myTeamId,
      partnerId,
      checked: result.checked,
      matched: result.matched,
      rosters: rosters.length,
      weeks: weeks.length,
      captureSearchMs,
      referenceKernelMs,
      typescriptReplayMs,
      rust,
      nativeProcessMs,
      kernelSpeedup: referenceKernelMs / median,
      validatedReplaySpeedup: typescriptReplayMs / median,
      parity: true,
      compiler: spawnSync('rustc', ['--version'], {
        encoding: 'utf8',
      }).stdout.trim(),
      node: process.version,
      hardware: `${os.arch()} ${os.cpus()[0]?.model}`,
      note: 'Capture adds tracing overhead. Rust runs include parity checks; TS referenceKernelMs excludes tracing and checks. Precomputed projections and specialist pools are supplied to Rust.',
    };
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    console.log(`Local corpus and report: ${output}`);
  } finally {
    delete hook.__tradeBenchmark;
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
