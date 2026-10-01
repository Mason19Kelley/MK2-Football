import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`player modal shows a whole season and supports keyboard dismissal${mobile ? ' on mobile' : ''}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Players', exact: true }).click();
    const trigger = page.getByRole('button', {
      name: 'View Josh Allen details',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', {
      name: 'Josh Allen',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Weekly projections' }),
    ).toBeVisible();
    await expect(dialog.locator('tbody tr')).toHaveCount(17);
    await expect(dialog.locator('tbody tr').first()).toContainText('Week 1');
    await expect(dialog.locator('tbody tr').last()).toContainText('Week 17');
    await expect(dialog).toContainText('Injury status');
    await expect(dialog).toContainText('Bye week');
    await expect(dialog).toContainText('Sample weekly projections');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close player details' }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .locator('.players-table tbody tr')
      .first()
      .locator('td')
      .last()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}
