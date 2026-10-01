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
  await expect(odds.locator('tbody tr')).toHaveCount(6);
  await expect(odds.locator('tbody tr').nth(0)).toContainText('Odds Team 1');
  await expect(odds.locator('tbody tr').nth(1)).toContainText(/-\d+\.\d pp/);
  await expect(odds.locator('tbody tr').nth(2)).toContainText(
    'Win championship',
  );
  await expect(odds.locator('tbody tr').nth(5)).toContainText(/\+\d+\.\d pp/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel('Trade partner', { exact: true }).selectOption('2');
  await expect(odds).toHaveCount(0);
  await page.locator('.trade-grid').getByRole('checkbox').nth(1).check();
  await expect(odds.locator('tbody tr').nth(3)).toContainText('Odds Team 2');
  expect(errors).toEqual([]);
});

test('every point-ranked finder result shows record, playoff and championship impacts for both teams', async ({
  page,
}) => {
  const fantasyPlayer = (id: number, value: number, position: 'RB' | 'WR') => ({
    ...league.teams[0].players[0],
    id,
    name: `Finder Player ${id}`,
    position,
    eligibleSlots: [position === 'RB' ? 2 : 4],
    slotId: 20,
    slot: 'BN',
    weekly: value,
    ros: value * 3,
    weeklyProjections: { 1: value, 2: value, 3: value },
  });
  const data = {
    ...league,
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: league.teams.map((t, i) => ({
      ...t,
      players:
        i === 0
          ? [
              fantasyPlayer(1, 20, 'RB'),
              fantasyPlayer(2, 19, 'RB'),
              fantasyPlayer(3, 5, 'WR'),
            ]
          : i === 1
            ? [
                fantasyPlayer(4, 5, 'RB'),
                fantasyPlayer(5, 20, 'WR'),
                fantasyPlayer(6, 19, 'WR'),
              ]
            : [
                fantasyPlayer(10 + i * 2, 16, 'RB'),
                fantasyPlayer(11 + i * 2, 16, 'WR'),
              ],
    })),
  };
  await page.addInitScript(
    (data) =>
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league: data, original: data, myTeamId: 1 }),
      ),
    data,
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
  await expect(finder.locator('.finder-card')).not.toHaveCount(0);
  const cards = finder.locator('.finder-card');
  for (let i = 0; i < (await cards.count()); i++) {
    const table = cards.nth(i).locator('.trade-odds-table');
    await expect(table.locator('tbody tr')).toHaveCount(6);
    await expect(table).toContainText('Expected W–L');
    await expect(table).toContainText('Make playoffs');
    await expect(table).toContainText('Win championship');
    await expect(
      table.locator('tbody tr').nth(0).locator('td').nth(1),
    ).toHaveText(/\d+\.\d{2}–\d+\.\d{2}/);
    await expect(
      table.locator('tbody tr').nth(0).locator('td').nth(3),
    ).toHaveText(/\+\d+\.\d{2} W \/ -\d+\.\d{2} L/);
    await expect(
      table.locator('tbody tr').nth(1).locator('td').nth(3),
    ).toHaveText(/\+\d+\.\d pp/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await finder.getByLabel('Minimum gain per team', { exact: true }).fill('100');
  await expect(cards).toHaveCount(0);
  await expect(finder.locator('.trade-odds-table')).toHaveCount(0);
});
