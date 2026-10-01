import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';
import { League, Player } from '../../lib/types';

function fixture(wire = false): League {
  const player = (id: number, points: number, slot: number): Player => ({
    ...demoLeague.teams[0].players[0],
    id,
    name: `Method Player ${id}`,
    position: slot === 2 ? 'RB' : 'WR',
    slotId: 20,
    slot: 'BN',
    status: 'ACTIVE',
    eligibleSlots: [slot],
    ros: points,
    weekly: points,
    weeklyProjections: { 1: points },
    byeWeek: 0,
    projectionSource: 'weekly-sum',
  });
  const team = (id: number, players: Player[]) => ({
    ...demoLeague.teams[0],
    id,
    name: `Method Team ${id}`,
    players,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
  });
  return {
    ...demoLeague,
    week: 1,
    finalWeek: 1,
    playoffStartWeek: undefined,
    slots: [
      { id: 2, label: 'RB', count: 1 },
      { id: 4, label: 'WR', count: 1 },
    ],
    teams: [
      team(1, [player(1, 20, 2), player(2, 19, 2), player(3, 5, 4)]),
      team(2, [player(4, 5, 2), player(5, 20, 4), player(6, 19, 4)]),
      team(3, [player(9, 20, 2), player(10, 10, 4)]),
      team(4, [player(11, 10, 2), player(12, 20, 4)]),
    ],
    matchups: [
      { id: 1, weeks: [1], homeId: 1, awayId: 3 },
      { id: 2, weeks: [1], homeId: 2, awayId: 4 },
    ],
    waiverWire: wire
      ? {
          syncedAt: '',
          truncated: false,
          players: [
            { ...player(7, 20, 4), availability: 'FREEAGENT', percentOwned: 1 },
            { ...player(8, 20, 2), availability: 'FREEAGENT', percentOwned: 1 },
          ],
        }
      : { syncedAt: '', truncated: false, players: [] },
  };
}

test('default waiver baseline rejects dominated offers and shows the concrete no-trade move', async ({
  page,
}) => {
  const league = fixture(true);
  await page.addInitScript((data) => {
    if (!localStorage.getItem('sunday-league-v1'))
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league: data, original: data, myTeamId: 1 }),
      );
  }, league);
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
  await expect(finder.getByRole('status')).toContainText(
    'No trades met these criteria',
  );
  await expect(finder).toContainText('Your no-trade baseline: 40.0');
  await expect(finder).toContainText('Add Method Player 7');
  await finder.getByText('Evaluation assumptions').click();
  await finder
    .getByLabel(/Compare against each team's best no-trade/)
    .uncheck();
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await expect(finder.getByRole('status')).toContainText('improving trades');
});

test('win scenarios, combined search and review carry the same gains into the simulator', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const league = fixture();
  await page.addInitScript((data) => {
    if (!localStorage.getItem('sunday-league-v1'))
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league: data, original: data, myTeamId: 1 }),
      );
  }, league);
  await page.goto('/');
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  const finder = page.getByRole('region', {
    name: 'Trade finder',
    exact: true,
  });
  await finder.getByLabel('Search teams').selectOption('2');
  await finder.getByLabel('Trade size').selectOption('all');
  await finder.getByText('Evaluation assumptions').click();
  await finder.getByLabel('Objective', { exact: true }).selectOption('wins');
  await finder.getByText('Scenario settings and backtest').click();
  await finder.getByLabel('Scenario samples').fill('8');
  await finder.getByLabel('Weekly availability probability').fill('1');
  await finder.getByLabel('Scoring variation (× position defaults)').fill('0');
  await finder.getByLabel('Role variation (fraction of forecast)').fill('0');
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await expect(finder.getByRole('status')).toContainText('(36 checked)');
  const card = finder.locator('.finder-card').first();
  await expect(
    card.locator('.trade-odds-table tbody tr').first(),
  ).toContainText('0.00–1.00');
  await expect(
    card.locator('.trade-odds-table tbody tr').first(),
  ).toContainText('1.00–0.00');
  const gains = await card.locator('.finder-gains strong').allTextContents();
  await card.getByRole('button', { name: 'Review in trade lab' }).click();
  await expect(
    page.locator('.trade-impact').first().locator('strong'),
  ).toHaveText(gains[0]);
  await expect(page.locator('.partner-impact strong')).toHaveText(gains[1]);
  // Outcome objectives re-rank their shortlist with a fixed simulation count.
  await expect(
    page.getByText('Reviewed using 512 outcome scenarios', { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('saved weekly uploads are replaced by source forecasts and stay removed on reload', async ({
  page,
}) => {
  const league = fixture();
  const custom = structuredClone(league);
  custom.teams[0].players[0].weekly = 0;
  custom.teams[0].players[0].weeklyOverrides = { 1: 0 };
  await page.addInitScript(
    ({ league, custom }) => {
      if (!localStorage.getItem('sunday-league-v1'))
        localStorage.setItem(
          'sunday-league-v1',
          JSON.stringify({ league: custom, original: league, myTeamId: 1 }),
        );
    },
    { league, custom },
  );
  await page.goto('/');
  const savedPlayer = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('sunday-league-v1')!).league.teams[0]
          .players[0],
    );
  await expect
    .poll(async () => (await savedPlayer()).weekly)
    .toBe(league.teams[0].players[0].weekly);
  expect((await savedPlayer()).weeklyOverrides).toBeUndefined();
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  const finder = page.getByRole('region', {
    name: 'Trade finder',
    exact: true,
  });
  await finder.getByText('Evaluation assumptions', { exact: true }).click();
  await expect(finder.locator('input[type=file]')).toHaveCount(0);
  await page.reload();
  await expect
    .poll(async () => (await savedPlayer()).weekly)
    .toBe(league.teams[0].players[0].weekly);
  expect((await savedPlayer()).weeklyOverrides).toBeUndefined();
});
