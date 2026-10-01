import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';

test('team overview shares standings forecasts and shows selected team schedule', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Team overview', exact: true }),
  ).toBeVisible();
  const projections = page.getByRole('region', {
    name: 'Team season projections',
  });
  await expect(projections.locator('.stat-value').first()).toHaveText(
    /\d+\.\d–\d+\.\d/,
    { timeout: 30000 },
  );
  const values = await projections.locator('.stat-value').allTextContents();
  await page
    .getByRole('button', { name: 'League rosters', exact: true })
    .click();
  const row = page.locator('.league-table .my-team-row');
  for (const value of values) await expect(row).toContainText(value);
  await page
    .getByRole('button', { name: 'Team overview', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  const schedule = page.locator('.schedule-table');
  const expected = demoLeague.matchups!.filter(
    (m) =>
      (m.homeId === 1 || m.awayId === 1) &&
      m.weeks.every(
        (w) => w >= demoLeague.week && w < demoLeague.playoffStartWeek!,
      ),
  );
  await expect(schedule.locator('tbody tr')).toHaveCount(expected.length);
  await expect(schedule.locator('tbody tr').first()).toContainText(/\d+\.\d%/);
  await expect(page.getByRole('heading', { name: 'The lineup' })).toBeHidden();
  await page.getByLabel('View team').selectOption('2');
  await expect(page.getByRole('tabpanel')).toContainText(
    demoLeague.teams.find((t) => t.id === 2)!.name,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The lineup' })).toBeVisible();
});

test('schedule explains missing imported schedule', async ({ page }) => {
  await page.addInitScript((demo) => {
    const league = { ...demo, matchups: [] };
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league, original: league, myTeamId: 1 }),
    );
  }, demoLeague);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(page.locator('.schedule-empty')).toContainText('Sync ESPN', {
    timeout: 30000,
  });
});
