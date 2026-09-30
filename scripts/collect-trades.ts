import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLeagueId } from '../lib/espn';
import { fetchTradeHistory } from '../lib/trade-history';

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(name) + 1];
  if (!args.includes('--league') || !args.includes('--seasons'))
    throw new Error(
      'Usage: npm run collect:trades -- --league 899513 --seasons 2024,2025 [--output data/trade-history]',
    );
  const leagueId = parseLeagueId(option('--league'));
  const seasons = [...new Set(option('--seasons').split(',').map(Number))];
  if (
    seasons.length > 10 ||
    seasons.some(
      (s) =>
        !Number.isInteger(s) || s < 2019 || s > new Date().getFullYear() + 1,
    )
  )
    throw new Error('Choose up to 10 seasons from 2019 through next year.');
  const directory = args.includes('--output')
    ? option('--output')
    : 'data/trade-history';
  const s2 = (process.env.ESPN_S2 ?? '').trim(),
    swid = (process.env.ESPN_SWID ?? '').trim();
  if (
    Boolean(s2) !== Boolean(swid) ||
    s2.length > 4096 ||
    swid.length > 100 ||
    /[\r\n;]/.test(s2 + swid)
  )
    throw new Error(
      'Set both ESPN_S2 and ESPN_SWID with valid session cookies, or neither for public leagues.',
    );
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (s2) headers.Cookie = `espn_s2=${s2}; SWID=${swid}`;
  await mkdir(directory, { recursive: true });
  let failures = 0;
  for (const season of seasons) {
    try {
      const url = new URL(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`,
      );
      url.searchParams.set('view', 'mSettings');
      const response = await fetch(url, {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('League unavailable.');
      const raw = await response.json();
      if (raw.id == null || typeof raw.scoringPeriodId !== 'number')
        throw new Error('Missing league metadata.');
      const history = await fetchTradeHistory(url, headers, {
        id: leagueId,
        season,
        week: raw.scoringPeriodId,
        finalWeek: raw.status?.finalScoringPeriod ?? 18,
      });
      const file = join(directory, `${leagueId}-${season}-${Date.now()}.json`);
      await writeFile(file, JSON.stringify(history, null, 2), { flag: 'wx' });
      console.log(
        `${season}: ${history.events.length} records, ${history.examples.length} labeled packages, ${history.coverage.loadedWeeks.length}/${history.coverage.requestedWeeks.length} weeks → ${file}`,
      );
      if (
        history.coverage.loadedWeeks.length !==
        history.coverage.requestedWeeks.length
      )
        failures++;
    } catch {
      failures++;
      console.error(
        `${season}: collection failed. Check league access, season, and session cookies.`,
      );
    }
  }
  if (failures) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Collection failed.');
  process.exitCode = 1;
});
