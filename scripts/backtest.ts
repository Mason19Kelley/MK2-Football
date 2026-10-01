// Backtests weekly scoring scenarios against a league's completed weeks.
//
//   npm run backtest -- --league 123456 --season 2026 [--weeks 1-4]
//     [--scoreCv 1.1 --roleCv 0.2 --teamCorrelation 0.2 --availability 0.95]
//     [--samples 512 --seed 2026 --refresh]
//
// Private leagues read ESPN_S2 and ESPN_SWID from the environment. Box scores
// are cached in data/backtest/. With any parameter override the candidate is
// compared with the defaults and the command fails unless it improves them.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ESPNResponse,
  fetchBacktestWeek,
  normalizeLeague,
  parseLeagueId,
} from '../lib/espn';
import {
  backtestImproves,
  completedWeeks,
  BacktestReport,
  BacktestTeamWeek,
  runBacktest,
} from '../lib/backtest';
import {
  defaultScenarioSettings,
  ScenarioSettings,
} from '../lib/trade-evaluation';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (!flag.startsWith('--')) throw new Error(`Unexpected argument ${flag}.`);
  const next = process.argv[i + 1];
  args.set(
    flag.slice(2),
    next === undefined || next.startsWith('--') ? 'true' : (i++, next),
  );
}
const number = (key: string) => {
  const value = args.get(key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number.`);
  return parsed;
};

async function main() {
  const leagueId = parseLeagueId(args.get('league') ?? '');
  const season = number('season') ?? new Date().getFullYear();
  const url = new URL(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`,
  );
  const headers: Record<string, string> = { Accept: 'application/json' };
  const { ESPN_S2: s2, ESPN_SWID: swid } = process.env;
  if (s2 && swid) headers.Cookie = `espn_s2=${s2}; SWID=${swid}`;

  const leagueUrl = new URL(url);
  for (const view of ['mTeam', 'mSettings', 'mMatchup'])
    leagueUrl.searchParams.append('view', view);
  const response = await fetch(leagueUrl, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `ESPN league request failed (HTTP ${response.status}). Private leagues need ESPN_S2 and ESPN_SWID.`,
    );
  const league = normalizeLeague(
    (await response.json()) as ESPNResponse,
    season,
  );

  const range = args.get('weeks')?.split('-').map(Number);
  if (
    range &&
    (range.some((n) => !Number.isInteger(n) || n < 1) || range.length > 2)
  )
    throw new Error('--weeks must look like 3 or 1-4.');
  const weeks = range
    ? Array.from(
        { length: Math.max(0, (range[1] ?? range[0]) - range[0] + 1) },
        (_, i) => range[0] + i,
      )
    : completedWeeks(league);
  if (!weeks.length) throw new Error('No completed weeks to backtest yet.');

  const cacheFile = path.join(
    process.cwd(),
    'data',
    'backtest',
    `${leagueId}-${season}.json`,
  );
  let cache: Record<
    number,
    { teamWeeks: BacktestTeamWeek[]; skipped: number }
  > = {};
  if (args.get('refresh') !== 'true')
    cache = JSON.parse(await readFile(cacheFile, 'utf8').catch(() => '{}'));
  for (const week of weeks) {
    if (cache[week]) continue;
    process.stderr.write(`Fetching week ${week} box scores…\n`);
    cache[week] = await fetchBacktestWeek(url, headers, season, week);
  }
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(cache));

  const teamWeeks = weeks.flatMap((w) => cache[w].teamWeeks);
  const skipped = weeks.reduce((s, w) => s + cache[w].skipped, 0);
  const data = {
    teamWeeks,
    // Matchups are scored only when every week is in range.
    matchups: league.matchups?.filter((m) =>
      m.weeks.every((w) => weeks.includes(w)),
    ),
  };
  const base: ScenarioSettings = {
    ...defaultScenarioSettings,
    samples: number('samples') ?? 512,
    seed: number('seed') ?? defaultScenarioSettings.seed,
  };
  const overrides = Object.fromEntries(
    (['scoreCv', 'roleCv', 'teamCorrelation', 'availability'] as const)
      .map((key) => [key, number(key)])
      .filter(([, value]) => value !== undefined),
  );
  console.log(
    `${league.name} ${season}, weeks ${weeks[0]}–${weeks.at(-1)}: ${teamWeeks.length} team-weeks${
      skipped ? ` (${skipped} skipped for missing projections)` : ''
    }\n`,
  );
  const baseline = runBacktest(data, base);
  print('Defaults', baseline);
  if (!Object.keys(overrides).length) return;
  const candidate = runBacktest(data, { ...base, ...overrides });
  print(`Candidate ${JSON.stringify(overrides)}`, candidate);
  const accepted = backtestImproves(baseline, candidate);
  console.log(
    accepted
      ? 'ACCEPT: candidate improves calibration without worsening any gate metric.'
      : 'REJECT: candidate does not improve on the defaults.',
  );
  if (!accepted) process.exitCode = 1;
}

function print(title: string, r: BacktestReport) {
  const f = (n: number, digits = 2) => n.toFixed(digits);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log(`${title}`);
  console.log(
    `  Teams    z SD ${f(r.teams.zSd)} (target 1.00), z mean ${f(r.teams.zMean)}, ` +
      `80% interval ${pct(r.teams.coverage80)}, 50% interval ${pct(r.teams.coverage50)}`,
  );
  console.log(
    `           actual RMSE ${f(r.teams.rmse, 1)} vs simulated SD ${f(r.teams.modelSd, 1)}, bias ${f(r.teams.bias, 1)}`,
  );
  if (r.matchups.count)
    console.log(
      `  Matchups ${r.matchups.count}: Brier ${f(r.matchups.brier, 3)} vs 0.250 coin flip ` +
        `(skill ${pct(r.matchups.skill)}), log loss ${f(r.matchups.logLoss, 3)}`,
    );
  console.log('  Position    n   z SD  80% int   RMSE  sim SD   bias');
  for (const [position, c] of Object.entries(r.players))
    console.log(
      `  ${position.padEnd(5)} ${String(c.count).padStart(6)} ${f(c.zSd).padStart(6)} ${pct(
        c.coverage80,
      ).padStart(
        8,
      )} ${f(c.rmse, 1).padStart(6)} ${f(c.modelSd, 1).padStart(7)} ${f(
        c.bias,
        1,
      ).padStart(6)}`,
    );
  console.log('');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
