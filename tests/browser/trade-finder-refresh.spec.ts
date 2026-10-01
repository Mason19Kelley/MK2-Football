import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';

function fixture(stale = false) {
  const player = (id: number, points: number, slot: number) => ({
    ...demoLeague.teams[0].players[0],
    id,
    name: `Refresh Player ${id}`,
    position: slot === 2 ? ('RB' as const) : ('WR' as const),
    slotId: 20,
    slot: 'BN',
    status: 'ACTIVE',
    eligibleSlots: [slot],
    ros: points,
    weekly: points,
    weeklyProjections: { 1: points },
    byeWeek: 0,
  });
  return {
    ...demoLeague,
    id: '42',
    source: 'espn' as const,
    syncedAt: new Date(Date.now() - (stale ? 360000 : 0)).toISOString(),
    week: 1,
    finalWeek: 1,
    matchups: [],
    playoffStartWeek: undefined,
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      {
        ...demoLeague.teams[0],
        players: [player(1, 20, 2), player(2, 19, 2), player(3, 5, 4)],
      },
      {
        ...demoLeague.teams[1],
        players: [player(4, 5, 2), player(5, 20, 4), player(6, 19, 4)],
      },
    ],
    waiverWire: { syncedAt: '', truncated: false, players: [] },
  };
}

test('completed offers and lineup details retain their snapshot after refresh, and reruns use new data', async ({
  page,
}) => {
  const league = fixture();
  const updated = {
    ...league,
    week: 2,
    finalWeek: 2,
    syncedAt: new Date().toISOString(),
    teams: league.teams.map((t) => ({
      ...t,
      name: `Updated ${t.name}`,
      players: t.players.map((p) => ({ ...p, name: `Updated ${p.name}` })),
    })),
  };
  await page.addInitScript(
    (data) =>
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league: data, original: data, myTeamId: 1 }),
      ),
    league,
  );
  await page.route('**/api/espn', (route) =>
    route.fulfill({ json: { league: updated } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  const finder = page.getByRole('region', {
    name: 'Trade finder',
    exact: true,
  });
  await finder.getByLabel('Search teams').selectOption('2');
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await expect(finder.getByRole('status')).toContainText('improving trades');
  const status = await finder.getByRole('status').innerText();
  await page.getByRole('button', { name: 'Refresh ESPN', exact: true }).click();
  await expect(finder).toContainText('New league data is available.');
  await expect(finder.getByRole('status')).toHaveText(status);
  await expect(finder.getByLabel('Search teams')).toHaveValue('2');
  await expect(
    finder.locator('.finder-card').first().getByRole('heading', { level: 4 }),
  ).toHaveText(league.teams[1].name);
  await finder.getByText('See starting lineup changes').first().click();
  await expect(
    finder
      .getByRole('region', { name: `${league.teams[1].name} weekly impact` })
      .first(),
  ).toBeVisible();
  await finder.getByText('See weekly starters and coverage').first().click();
  await expect(
    finder.locator('.weekly-impact-table tbody th').first(),
  ).toHaveText('1');
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await expect(finder.getByRole('status')).toContainText('improving trades');
  await expect(finder).not.toContainText('New league data is available.');
  await expect(
    finder.locator('.finder-card').first().getByRole('heading', { level: 4 }),
  ).toHaveText(updated.teams[1].name);
  await finder.getByLabel('Minimum gain per team', { exact: true }).fill('100');
  await expect(finder.getByRole('status', { includeHidden: true })).toBeEmpty();
});

test('an automatic refresh does not terminate an active search or discard its eventual result', async ({
  page,
}) => {
  const league = fixture(true);
  await page.addInitScript((data) => {
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league: data, original: data, myTeamId: 1 }),
    );
    const state = window as typeof window & { releaseTradeResult?: () => void };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let released = false;
        this.addEventListener('message', (event) => {
          if (
            !released &&
            event.data.type === 'result' &&
            event.data.result?.candidates
          ) {
            event.stopImmediatePropagation();
            state.releaseTradeResult = () => {
              released = true;
              this.dispatchEvent(
                new MessageEvent('message', { data: event.data }),
              );
            };
          }
        });
      }
    };
  }, league);
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route('**/api/espn', async (route) => {
    await refreshGate;
    await route.fulfill({
      json: { league: { ...league, syncedAt: new Date().toISOString() } },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  const finder = page.getByRole('region', {
    name: 'Trade finder',
    exact: true,
  });
  await finder.getByLabel('Search teams').selectOption('2');
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await page.waitForFunction(() =>
    Boolean(
      (window as typeof window & { releaseTradeResult?: () => void })
        .releaseTradeResult,
    ),
  );
  releaseRefresh();
  await expect(finder).toContainText('New league data is available.');
  await expect(
    finder.getByRole('button', { name: 'Searching…', exact: true }),
  ).toBeDisabled();
  await expect(finder.getByLabel('Search teams')).toHaveValue('2');
  await page.evaluate(() =>
    (window as typeof window & { releaseTradeResult?: () => void })
      .releaseTradeResult!(),
  );
  await expect(finder.getByRole('status')).toContainText('improving trades');
  await expect(finder).toContainText(
    'These results use the data from when the search started.',
  );
});
