import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';
import {
  normalizeTrade,
  buildTradeExamples,
  type TradeHistory,
} from '../../lib/trade-history';

const events = [
  normalizeTrade({
    id: 'offer',
    type: 'TRADE_PROPOSAL',
    items: [
      { type: 'TRADE', playerId: 10, fromTeamId: 1, toTeamId: 2 },
      { type: 'TRADE', playerId: 20, fromTeamId: 2, toTeamId: 1 },
    ],
  })!,
  normalizeTrade({
    id: 'accept',
    type: 'TRADE_ACCEPT',
    relatedTransactionId: 'offer',
    executionType: 'EXECUTE',
  })!,
];
const history: TradeHistory = {
  version: 1,
  leagueId: '42',
  season: 2025,
  fetchedAt: new Date().toISOString(),
  events,
  examples: buildTradeExamples(events),
  coverage: {
    requestedWeeks: [0, 1],
    loadedWeeks: [1],
    activity: 'unavailable',
  },
  warnings: ['Some transaction weeks could not be loaded. Sync ESPN to retry.'],
};

test('trade history import, partial coverage, export, and reload preserve the dataset without credentials', async ({
  page,
}) => {
  await page.route('**/api/espn', async (route) => {
    expect(route.request().postDataJSON().includeTradeHistory).toBe(true);
    await route.fulfill({
      json: {
        league: {
          ...demoLeague,
          id: '42',
          source: 'espn',
          syncedAt: new Date().toISOString(),
          tradeHistory: history,
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByLabel('Import trade history for this season'),
  ).toBeChecked();
  await dialog.getByLabel('ESPN league URL or ID').fill('42');
  await dialog.getByLabel('My league is private').check();
  await dialog.getByLabel('espn_s2', { exact: true }).fill('session-secret');
  await dialog.getByLabel('SWID', { exact: true }).fill('owner-secret');
  await dialog
    .getByRole('button', { name: 'Connect league', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  const panel = page.getByRole('region', {
    name: 'Trade history',
    exact: true,
  });
  await expect(panel).toContainText('1 labeled offers');
  await expect(panel).toContainText('1/2 transaction weeks loaded');
  await expect(panel).toContainText(
    'Some transaction weeks could not be loaded',
  );
  const downloaded = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export trade dataset' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('espn-trades-42-2025.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(history);
  await page.reload();
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  await expect(panel).toContainText('1 labeled offers');
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain('session-secret');
  expect(storage).not.toContain('owner-secret');
});
