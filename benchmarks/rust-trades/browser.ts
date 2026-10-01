import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const corpusPath = path.resolve(
  process.argv[2] ??
    path.join(root, 'data/trade-history/rust-benchmark/corpus.json'),
);
const runs = Number(process.argv[3] ?? 3);
if (!Number.isInteger(runs) || runs < 1)
  throw new Error('RUNS must be a positive integer');
const wasmPath = path.join(
  root,
  'engine/trade-scorer/target/wasm32-unknown-unknown/release/trade_scorer.wasm',
);

type Result = {
  engine: string;
  count: number;
  byteLength: number;
  fetchMs: number;
  parseMs: number;
  compileMs: number;
  wasmBytes?: number;
  initializationMs: number;
  runsMs: number[];
  runsWallMs: number[];
  checksum: number;
  parity: boolean;
  mainThreadTicks: number;
};
async function main() {
  await Promise.all([fs.access(corpusPath), fs.access(wasmPath)]);
  const sources = new Map<string, string>();
  for (const name of ['weekly-trades', 'trades', 'types']) {
    const source = await fs.readFile(path.join(root, `lib/${name}.ts`), 'utf8');
    const javascript = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
        fileName: `${name}.ts`,
      })
      .outputText.replace(/from (['"])\.\/([^'"]+)\1/g, 'from "$2.js"');
    // Relative imports need an explicit ./ for browser ESM.
    sources.set(
      `/lib/${name}.js`,
      javascript.replace(/from "([^/][^"]*\.js)"/g, 'from "./$1"'),
    );
  }
  const worker = await fs.readFile(
    path.join(root, 'benchmarks/rust-trades/browser-worker.mjs'),
    'utf8',
  );
  const server = createServer((req, res) => {
    const url = req.url?.split('?')[0];
    if (url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Local scoring benchmark</title>');
    } else if (url === '/worker.mjs') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(worker);
    } else if (url && sources.has(url)) {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(sources.get(url));
    } else if (url === '/corpus.json' || url === '/scorer.wasm') {
      res.setHeader(
        'Content-Type',
        url === '/scorer.wasm' ? 'application/wasm' : 'application/json',
      );
      const stream = createReadStream(
        url === '/corpus.json' ? corpusPath : wasmPath,
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
    // tsx preserves function names using this helper. Playwright serializes
    // callbacks without their surrounding module, so provide it on this
    // isolated benchmark page for nested callbacks in page.evaluate.
    await page.addInitScript({ content: 'globalThis.__name = (fn) => fn;' });
    await page.goto(`http://127.0.0.1:${address.port}`);
    let last = 0;
    await page.exposeFunction(
      'benchmarkProgress',
      (message: {
        type: string;
        engine: string;
        run: number;
        checked: number;
        count: number;
        ms: number;
      }) => {
        const now = performance.now();
        if (message.type === 'run')
          console.log(
            `${message.engine} run ${message.run + 1}: ${(message.ms / 1000).toFixed(3)} s`,
          );
        else if (message.type === 'loaded')
          console.log(`${message.engine}: corpus loaded in worker`);
        else if (now - last > 10000) {
          console.log(
            `${message.engine}: run ${message.run + 1}, ${message.checked}/${message.count} rosters`,
          );
          last = now;
        }
      },
    );
    const results: Result[] = [];
    for (const engine of ['typescript', 'wasm']) {
      console.log(`Starting ${engine} in Chromium worker…`);
      const result = await page.evaluate(
        ({ engine, runs }) =>
          new Promise<Result>((resolve, reject) => {
            const worker = new Worker('/worker.mjs', { type: 'module' });
            let ticks = 0;
            const heartbeat = setInterval(() => ticks++, 10);
            const stop = () => {
              clearInterval(heartbeat);
              clearTimeout(timeout);
              worker.terminate();
            };
            const timeout = setTimeout(() => {
              stop();
              reject(new Error(`${engine} benchmark timed out`));
            }, 300000);
            worker.onerror = (event) => {
              stop();
              reject(new Error(event.message));
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
                    benchmarkProgress: (message: unknown) => Promise<void>;
                  }
                ).benchmarkProgress(data);
            };
            worker.postMessage({ engine, runs, corpusUrl: '/corpus.json' });
          }),
        { engine, runs },
      );
      if (!result.parity || result.mainThreadTicks < 1)
        throw new Error(`${engine}: parity or main-thread heartbeat failed`);
      results.push(result);
    }
    const [typescript, wasm] = results;
    if (
      typescript.count !== wasm.count ||
      Math.abs(typescript.checksum - wasm.checksum) > 1e-4
    )
      throw new Error('Browser engine parity mismatch');
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const report = {
      generatedAt: new Date().toISOString(),
      scope:
        'Browser worker numeric scoring replay, not full Rust trade search',
      browser: browser.version(),
      typescript,
      wasm,
      scoringSpeedup: median(typescript.runsMs) / median(wasm.runsMs),
      wallSpeedup: median(typescript.runsWallMs) / median(wasm.runsWallMs),
      parity: true,
      note: 'Both workers receive the identical local corpus and check every roster/weekly result. TypeScript uses precomputed projections and specialist pools. Initialization is separate; the large trace corpus is not representative of a live league payload.',
    };
    const output = path.resolve(
      process.argv[4] ??
        path.join(
          root,
          'data/trade-history/rust-benchmark/browser-report.json',
        ),
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report: ${output}`);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
