import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';

test('league table displays sortable season forecasts and fits mobile', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'League rosters', exact: true })
    .click();
  const table = page.locator('.league-table');
  await expect(
    table.getByRole('columnheader', { name: 'Roster', exact: true }),
  ).toHaveCount(0);
  await expect(
    table.getByRole('columnheader', { name: 'ROS coverage' }),
  ).toHaveCount(0);
  await expect(page.locator('.league-table-footer')).toContainText(
    'Expected W–L excludes playoffs',
    { timeout: 30000 },
  );
  await expect(table.locator('tbody tr').first()).toContainText(
    /\d+\.\d–\d+\.\d/,
  );
  await table
    .getByRole('button', { name: 'Win championship', exact: true })
    .click();
  const chances = await table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => parseFloat(row.children[7].textContent!)),
    );
  expect(chances).toEqual([...chances].sort((a, b) => b - a));
  await page.getByText('Season forecast model', { exact: true }).click();
  await expect(page.locator('.league-forecast-details')).toContainText(
    '512 season simulations',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('missing schedule shows unavailable forecasts with a reason', async ({
  page,
}) => {
  await page.addInitScript((demo) => {
    const league = { ...demo, matchups: [] };
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league, original: league, myTeamId: 1 }),
    );
  }, demoLeague);
  await page.goto('/');
  await page
    .getByRole('button', { name: 'League rosters', exact: true })
    .click();
  await expect(page.locator('.league-table-footer')).toContainText(
    'Season forecasts unavailable',
  );
  await page.getByText('Season forecast model', { exact: true }).click();
  await expect(page.locator('.league-forecast-details')).toContainText(
    'Sync ESPN',
  );
});
