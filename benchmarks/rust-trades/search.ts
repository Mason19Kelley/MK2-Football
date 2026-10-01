import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '../..');
function parity(actual: unknown, expected: unknown, at = 'result'): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert.ok(
      Math.abs(actual - expected) < 1e-7,
      `${at}: ${actual} vs ${expected}`,
    );
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, at);
    expected.forEach((value, i) => parity(actual[i], value, `${at}[${i}]`));
    return;
  }
  if (
    actual &&
    expected &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      at,
    );
    for (const key of Object.keys(expected))
      parity(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${at}.${key}`,
      );
    return;
  }
  assert.deepEqual(actual, expected, at);
}
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath)
    throw new Error(
      'Usage: npm run benchmark:search -- SNAPSHOT.json MY_TEAM PARTNER',
    );
  const snapshot = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const myTeamId = Number(process.argv[3] ?? 3),
    partnerId = Number(process.argv[4] ?? 1);
  const player = (p: Record<string, unknown>) => ({
    name: String(p.id),
    slot: String(p.slotId),
    season: null,
    actual: null,
    ...p,
  });
  const league = {
    name: 'Benchmark',
    source: 'espn',
    syncedAt: snapshot.sourceSyncedAt,
    warnings: [],
    ...snapshot.league,
    teams: snapshot.league.teams.map(
      (t: { id: number; players: Record<string, unknown>[] }) => ({
        name: `Team ${t.id}`,
        abbreviation: String(t.id),
        owner: '',
        ...t,
        players: t.players.map(player),
      }),
    ),
    waiverWire: snapshot.league.waiverWire && {
      ...snapshot.league.waiverWire,
      players: snapshot.league.waiverWire.players.map(player),
    },
  };
  const options = {
    ...snapshot.settings,
    partnerId,
    maxPlayers: 1,
    minimumGain: 1,
    partnerMinimumGain: 1,
    ranking: 'mine',
  };
  const sources = new Map<string, string>();
  for (const filename of await fs.readdir(path.join(root, 'lib'))) {
    if (!filename.endsWith('.ts')) continue;
    const source = await fs.readFile(path.join(root, 'lib', filename), 'utf8');
    sources.set(
      `/lib/${filename.replace(/\.ts$/, '.js')}`,
      ts
        .transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
          fileName: filename,
        })
        .outputText.replace(/from (['"])\.\/([^'"]+)\1/g, 'from "./$2.js"'),
    );
  }
  const worker = await fs.readFile(
    path.join(root, 'benchmarks/rust-trades/search-worker.mjs'),
    'utf8',
  );
  const server = createServer((req, res) => {
    const url = req.url;
    if (url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Search benchmark</title>');
    } else if (url === '/worker.mjs') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(worker);
    } else if (url && sources.has(url)) {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(sources.get(url));
    } else if (url === '/trade-scorer-v1.wasm') {
      res.setHeader('Content-Type', 'application/wasm');
      const stream = createReadStream(
        path.join(root, 'public/trade-scorer-v1.wasm'),
      );
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No benchmark port');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript({ content: 'globalThis.__name=(fn)=>fn;' });
    await page.goto(`http://127.0.0.1:${address.port}`);
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' && m.text().includes('WASM'))
        warnings.push(m.text());
    });
    let last = 0;
    await page.exposeFunction(
      'progress',
      (data: { engine: string; checked: number; evaluatedRosters: number }) => {
        const now = performance.now();
        if (now - last > 10000) {
          console.log(
            `${data.engine}: ${data.checked} packages, ${data.evaluatedRosters} roster evaluations`,
          );
          last = now;
        }
      },
    );
    const results = [];
    for (const engine of ['typescript', 'wasm']) {
      console.log(`Running complete ${engine} trade search…`);
      const result = await page.evaluate(
        ({ engine, league, myTeamId, options }) =>
          new Promise<{
            engine: string;
            totalMs: number;
            initializationMs: number;
            result: unknown;
            mainThreadTicks: number;
          }>((resolve, reject) => {
            const worker = new Worker('/worker.mjs', { type: 'module' });
            let ticks = 0;
            const heartbeat = setInterval(() => ticks++, 10);
            const stop = () => {
              clearTimeout(timeout);
              clearInterval(heartbeat);
              worker.terminate();
            };
            const timeout = setTimeout(() => {
              stop();
              reject(new Error('Search benchmark timed out'));
            }, 300000);
            worker.onerror = (e) => {
              stop();
              reject(new Error(e.message));
            };
            worker.onmessage = ({ data }) => {
              if (data.type === 'error') {
                stop();
                reject(new Error(data.error));
              } else if (data.type === 'result') {
                stop();
                resolve({ ...data, mainThreadTicks: ticks });
              } else
                void (
                  window as unknown as {
                    progress: (data: unknown) => Promise<void>;
                  }
                ).progress(data);
            };
            worker.postMessage({ engine, league, myTeamId, options });
          }),
        { engine, league, myTeamId, options },
      );
      console.log(`${engine}: ${(result.totalMs / 1000).toFixed(3)} seconds`);
      results.push(result);
    }
    assert.deepEqual(warnings, [], 'WASM must score without falling back');
    parity(results[1].result, results[0].result);
    const report = {
      generatedAt: new Date().toISOString(),
      scope:
        'Complete browser-worker trade search including WASM startup and full metadata reconstruction',
      browser: browser.version(),
      myTeamId,
      partnerId,
      options,
      typescript: results[0],
      wasm: results[1],
      speedup: results[0].totalMs / results[1].totalMs,
      parity: true,
    };
    const file = path.join(
      root,
      'data/trade-history/rust-benchmark/search-report.json',
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          typescriptMs: results[0].totalMs,
          wasmMs: results[1].totalMs,
          speedup: report.speedup,
          parity: true,
          report: file,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
