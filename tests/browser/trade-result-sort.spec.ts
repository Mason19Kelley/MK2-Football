import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';

test('finder results sort by points gain and by championship odds gain', async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((data) => {
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({
        league: data,
        original: data,
        myTeamId: data.teams[0].id,
      }),
    );
  }, demoLeague);
  await page.goto('/');
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  const finder = page.getByRole('region', {
    name: 'Trade finder',
    exact: true,
  });
  await finder.getByLabel('Trade size').selectOption('2');
  await finder.getByLabel('Minimum gain per team').fill('0');
  await finder.getByText('Evaluation assumptions').click();
  await finder
    .getByLabel(/Compare against each team's best no-trade/)
    .uncheck();
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await expect(finder.getByRole('status')).toContainText('improving trades', {
    timeout: 120000,
  });
  const sort = finder.getByLabel('Sort results by');

  await sort.selectOption('title');
  await expect(
    finder.getByText('Season odds are still calculating'),
  ).toHaveCount(0, { timeout: 120000 });
  const titleChanges = await finder
    .locator('.finder-card')
    .evaluateAll((cards) =>
      cards.map((card) => {
        const row = [
          ...card.querySelectorAll('.trade-odds-table tbody tr'),
        ].find((r) => r.textContent?.includes('Win championship'));
        return Number(
          row?.querySelectorAll('td')[3]?.textContent?.replace(/[^\d.+-]/g, ''),
        );
      }),
    );
  expect(titleChanges.length).toBeGreaterThan(1);
  // Displayed changes are rounded to 0.1 points.
  for (let i = 1; i < titleChanges.length; i++)
    expect(titleChanges[i]).toBeLessThanOrEqual(titleChanges[i - 1] + 0.05);

  await sort.selectOption('points');
  const pointGains = (
    await finder
      .locator('.finder-gains > div:first-child strong')
      .allTextContents()
  ).map(Number);
  for (let i = 1; i < pointGains.length; i++)
    expect(pointGains[i]).toBeLessThanOrEqual(pointGains[i - 1] + 0.05);
  expect(errors).toEqual([]);
});
