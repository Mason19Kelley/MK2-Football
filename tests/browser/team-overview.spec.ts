import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';
import { evaluateRoster } from '../../lib/weekly-trades';
import { points, League } from '../../lib/types';

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

test('matchup row opens both full rosters with the selected week projections', async ({
  page,
}) => {
  const week = demoLeague.week + 1;
  const fixture = {
    ...demoLeague,
    teams: demoLeague.teams.map((team, i) =>
      i === 0
        ? {
            ...team,
            players: team.players.map((player, index) =>
              index === 0
                ? { ...player, byeWeek: week }
                : index === 1
                  ? {
                      ...player,
                      byeWeek: 0,
                      projectionSource: 'weekly-sum' as const,
                      weeklyProjections: {
                        ...player.weeklyProjections,
                        [week]: 31.7,
                      },
                    }
                  : player,
            ),
          }
        : team,
    ),
  };
  await page.addInitScript((league) => {
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league, original: league, myTeamId: 1 }),
    );
  }, fixture);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  const row = page
    .locator('.schedule-table tbody tr')
    .filter({ hasText: `Week ${week}` });
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.locator('td').last().click();
  const dialog = page.getByRole('dialog', { name: 'Matchup details' });
  await expect(dialog).toBeVisible();
  const matchup = fixture.matchups!.find(
    (m) => m.weeks.includes(week) && (m.homeId === 1 || m.awayId === 1),
  )!;
  const opponent = fixture.teams.find(
    (t) => t.id === (matchup.homeId === 1 ? matchup.awayId : matchup.homeId),
  )!;
  for (const team of [fixture.teams[0], opponent]) {
    const roster = dialog.getByRole('region', {
      name: `${team.name} Week ${week} roster`,
      exact: true,
    });
    expect(await roster.locator('li').count()).toBeGreaterThanOrEqual(
      team.players.length,
    );
    for (const player of team.players)
      await expect(
        roster.locator(`[data-player-id="${player.id}"]`),
      ).toHaveCount(1);
  }
  const myRoster = dialog.getByRole('region', {
    name: `${fixture.teams[0].name} Week ${week} roster`,
    exact: true,
  });
  const byePlayer = myRoster.locator(
    `[data-player-id="${fixture.teams[0].players[0].id}"]`,
  );
  await expect(byePlayer).toContainText('Bye');
  await expect(byePlayer.locator('.matchup-player-projection')).toHaveText(
    '0.0',
  );
  await expect(
    myRoster.locator(
      `[data-player-id="${fixture.teams[0].players[1].id}"] .matchup-player-projection`,
    ),
  ).toHaveText('31.7');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const button = row.getByRole('button');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
});

test('ROS card uses weekly optimal lineups and matchup labels streamed specialists', async ({
  page,
}) => {
  const league: League = {
    ...demoLeague,
    waiverWire: {
      syncedAt: '',
      truncated: false,
      players: (['K', 'D/ST'] as const).map((position, i) => ({
        ...demoLeague.teams[0].players[0],
        id: 99000 + i,
        name: `Test streamer ${position}`,
        position,
        eligibleSlots: [position === 'K' ? 17 : 16],
        slotId: 20,
        slot: 'BN',
        status: 'ACTIVE',
        byeWeek: 0,
        weekly: 30,
        ros: 30 * (demoLeague.finalWeek - demoLeague.week + 1),
        weeklyProjections: {},
        weeklyOverrides: {},
        projectionSource: 'estimate',
        availability: 'FREEAGENT',
        percentOwned: 1,
      })),
    },
  };
  await page.addInitScript(
    (league) =>
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league, original: league, myTeamId: 1 }),
      ),
    league,
  );
  await page.goto('/');
  const expected = evaluateRoster(
    league,
    league.teams[0].players,
    'remaining',
    undefined,
    undefined,
    { streaming: false },
  );
  await expect(page.locator('.stat-grid .stat-value').nth(1)).toHaveText(
    points(expected.total),
  );
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(page.locator('.stat-grid .stat-value').first()).toHaveText(
    points(expected.weeks[0].total),
  );
  await expect(
    page.locator('.schedule-table tbody tr').first().locator('td').nth(2),
  ).toHaveText(points(expected.weeks[0].total));
  await page.locator('.schedule-table tbody tr').first().click();
  const dialog = page.getByRole('dialog', { name: 'Matchup details' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('.matchup-scoreline > span').first().locator('strong'),
  ).toHaveText(points(expected.weeks[0].total));
  const roster = dialog.getByRole('region', {
    name: `${league.teams[0].name} Week ${league.week} roster`,
    exact: true,
  });
  await expect(roster.locator('.waiver-pickup-label')).toHaveCount(2);
  await expect(roster).toContainText('Test streamer K');
  await expect(roster).toContainText('Test streamer D/ST');
  await expect(roster.locator('.matchup-roster-heading strong')).toHaveText(
    points(expected.weeks[0].total),
  );
});
