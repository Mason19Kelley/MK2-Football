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

for (const mode of [
  'loaded',
  'unavailable',
  'malformed',
  'unsupported',
] as const) {
  test(`trade worker completes with WASM ${mode}`, async ({ page }) => {
    const league = fixture();
    await page.addInitScript(
      (data) =>
        localStorage.setItem(
          'sunday-league-v1',
          JSON.stringify({ league: data, original: data, myTeamId: 1 }),
        ),
      league,
    );
    let requests = 0;
    await page.route('**/trade-scorer-v1.wasm', async (route) => {
      requests++;
      if (mode === 'unavailable')
        await route.fulfill({ status: 503, body: 'Unavailable' });
      else if (mode === 'malformed')
        await route.fulfill({
          contentType: 'application/wasm',
          body: 'invalid module',
        });
      else await route.continue();
    });
    await page.goto('/');
    await page.getByRole('button', { name: /^Trade lab/ }).click();
    const finder = page.getByRole('region', {
      name: 'Trade finder',
      exact: true,
    });
    await finder.getByLabel('Search teams').selectOption('2');
    if (mode === 'unsupported') {
      await finder.getByText('Evaluation assumptions', { exact: true }).click();
      await finder
        .getByLabel(/Compare against each team's best no-trade/)
        .uncheck();
    }
    await finder
      .getByRole('button', { name: 'Find trades', exact: true })
      .click();
    await expect(finder.getByRole('status')).toContainText('improving trades');
    expect(requests).toBe(mode === 'unsupported' ? 0 : 1);
    await expect(finder.locator('.finder-card').first()).toBeVisible();
    await finder.getByText('See starting lineup changes').first().click();
    await expect(
      finder
        .getByRole('region', { name: `${league.teams[1].name} weekly impact` })
        .first(),
    ).toBeVisible();
  });
}

test('cancel terminates a worker while its WASM asset is loading', async ({
  page,
}) => {
  const league = fixture();
  await page.addInitScript(
    (data) =>
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league: data, original: data, myTeamId: 1 }),
      ),
    league,
  );
  let requested = false;
  await page.route('**/trade-scorer-v1.wasm', () => {
    requested = true;
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
  await expect.poll(() => requested).toBe(true);
  await finder
    .getByRole('button', { name: 'Cancel search', exact: true })
    .click();
  await expect(
    finder.getByRole('button', { name: 'Find trades', exact: true }),
  ).toBeEnabled();
  await expect(finder.locator('.finder-card')).toHaveCount(0);
});
