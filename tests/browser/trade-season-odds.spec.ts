import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';
import { League } from '../../lib/types';

const league: League = {
  ...demoLeague,
  week: 1,
  finalWeek: 3,
  playoffStartWeek: 3,
  playoffTeamCount: 2,
  playoffRoundWeeks: 1,
  slots: [{ id: 0, label: 'QB', count: 1 }],
  teams: demoLeague.teams.slice(0, 4).map((team, i) => ({
    ...team,
    id: i + 1,
    name: `Odds Team ${i + 1}`,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    players: [
      {
        ...demoLeague.teams[0].players[0],
        id: i + 1,
        name: `Odds Player ${i + 1}`,
        eligibleSlots: [0],
        weekly: 40 - i * 10,
        ros: (40 - i * 10) * 3,
        weeklyProjections: {},
        byeWeek: 0,
        status: 'ACTIVE',
        availabilityProbability: 1,
        scoreStdDev: 0,
        roleStdDev: 0,
      },
    ],
  })),
  matchups: [1, 2].flatMap((week) => [
    { id: week * 2, weeks: [week], homeId: 1, awayId: 3 },
    { id: week * 2 + 1, weeks: [week], homeId: 2, awayId: 4 },
  ]),
  waiverWire: { syncedAt: '', truncated: false, players: [] },
};

test('manual trade shows both teams playoff and title odds and clears stale comparisons', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((data) => {
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league: data, original: data, myTeamId: 1 }),
    );
  }, league);
  await page.goto('/');
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  await page.getByLabel('Trade partner', { exact: true }).selectOption('4');
  await page.getByLabel(/Compare with best no-trade add\/drop/).uncheck();
  await page.locator('.trade-grid').getByRole('checkbox').nth(0).check();
  await page.locator('.trade-grid').getByRole('checkbox').nth(1).check();
  const odds = page.getByRole('region', {
    name: 'Trade season odds',
    exact: true,
  });
  await expect(odds.locator('tbody tr')).toHaveCount(4);
  await expect(odds.locator('tbody tr').nth(0)).toContainText('Odds Team 1');
  await expect(odds.locator('tbody tr').nth(0)).toContainText(/-\d+\.\d pp/);
  await expect(odds.locator('tbody tr').nth(1)).toContainText(
    'Win championship',
  );
  await expect(odds.locator('tbody tr').nth(3)).toContainText(/\+\d+\.\d pp/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel('Trade partner', { exact: true }).selectOption('2');
  await expect(odds).toHaveCount(0);
  await page.locator('.trade-grid').getByRole('checkbox').nth(1).check();
  await expect(odds.locator('tbody tr').nth(2)).toContainText('Odds Team 2');
  expect(errors).toEqual([]);
});
