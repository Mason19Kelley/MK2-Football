import { test, expect } from '@playwright/test';

test('waiver finder ranks pickups, filters results, and reviews a weekly ROS gain', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Waiver wire', exact: true }).click();
  const finder = page.getByRole('region', { name: 'Waiver wire finder' });
  await finder
    .getByRole('button', { name: 'Find pickups', exact: true })
    .click();
  await expect(finder.locator('.finder-card').first()).toBeVisible();
  await expect(finder).toContainText('THROUGH WEEK 17');
  const first = finder.locator('.finder-card').first();
  const gain = await first.locator('.green-text').innerText();
  await first.getByRole('button', { name: 'Review pickup' }).click();
  await expect(page.locator('.waiver-results .partner-impact')).toContainText(
    gain.replace(' ROS pts', ''),
  );
  await page
    .getByRole('textbox', { name: 'Search available players' })
    .fill('no such player');
  await expect(finder.locator('.finder-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear waiver search' }).click();
  await expect(finder.locator('.finder-card').first()).toBeVisible();
  await page.getByLabel('Waiver comparison team').selectOption('2');
  await expect(finder.locator('.finder-card')).toHaveCount(0);
});
