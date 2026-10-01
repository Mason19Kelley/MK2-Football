import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';

test('manual and automatic refresh preserve custom projections and selection, then pause for reconnect', async ({
  page,
}) => {
  const now = new Date('2026-09-30T12:00:00Z');
  await page.clock.install({ time: now });
  const saved = {
    ...demoLeague,
    id: '42',
    source: 'espn',
    syncedAt: now.toISOString(),
    teams: demoLeague.teams.map((t) => ({
      ...t,
      players: t.players.map((p) =>
        p.id === 3918298 ? { ...p, ros: 500, projectionSource: 'custom' } : p,
      ),
    })),
  };
  await page.addInitScript((league) => {
    if (!localStorage.getItem('sunday-league-v1'))
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league, original: league, myTeamId: 2 }),
      );
  }, saved);
  let requests = 0;
  let expired = false;
  await page.route('**/api/espn', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ json: { disconnected: true } });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({
      refresh: true,
      leagueId: '42',
      season: 2026,
    });
    requests++;
    await route.fulfill({
      status: expired ? 401 : 200,
      json: expired
        ? { error: 'ESPN session expired.', reconnect: true }
        : {
            league: {
              ...demoLeague,
              id: '42',
              source: 'espn',
              syncedAt: new Date(
                now.getTime() + (requests - 1) * 300000,
              ).toISOString(),
              week: 5,
            },
          },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Refresh ESPN', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Refresh ESPN', exact: true }),
  ).toBeEnabled();
  expect(requests).toBe(1);
  await expect(
    page.getByRole('heading', { name: 'Gridiron Gang', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const cached = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('sunday-league-v1')!),
  );
  expect(
    cached.league.teams[0].players.find((p: { id: number }) => p.id === 3918298)
      .ros,
  ).toBe(500);
  expect(
    cached.original.teams[0].players.find(
      (p: { id: number }) => p.id === 3918298,
    ).ros,
  ).toBe(310);
  await page.clock.fastForward(300001);
  await expect.poll(() => requests).toBe(2);
  await expect(
    page.getByRole('button', { name: 'Refresh ESPN', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Gridiron Gang', exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
  expired = true;
  await page.getByRole('button', { name: 'Refresh ESPN', exact: true }).click();
  await expect(page.locator('.form-error[role=alert]')).toContainText(
    'ESPN session expired.',
  );
  await page.clock.fastForward(600001);
  expect(requests).toBe(3);
  await expect(
    page.getByRole('heading', { name: 'Gridiron Gang', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Reconnect ESPN', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Connect ESPN league' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('.demo-banner')).toBeVisible();
});

test('reopening a stale league refreshes automatically and a temporary failure keeps the saved roster', async ({
  page,
}) => {
  const now = new Date('2026-09-30T12:00:00Z');
  await page.clock.install({ time: now });
  await page.addInitScript((demo) => {
    const league = {
      ...demo,
      id: '42',
      source: 'espn',
      syncedAt: '2026-09-30T11:00:00Z',
    };
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league, original: league, myTeamId: 1 }),
    );
  }, demoLeague);
  let requests = 0;
  await page.route('**/api/espn', async (route) => {
    expect(route.request().postDataJSON().refresh).toBe(true);
    requests++;
    await route.fulfill({
      status: requests === 1 ? 502 : 200,
      json:
        requests === 1
          ? { error: 'ESPN is temporarily unavailable.' }
          : {
              league: {
                ...demoLeague,
                id: '42',
                source: 'espn',
                syncedAt: now.toISOString(),
              },
            },
    });
  });
  await page.goto('/');
  await expect(page.locator('.form-error[role=alert]')).toContainText(
    'Your saved league is still available.',
  );
  await expect(page.locator('tbody')).toContainText('Josh Allen');
  expect(requests).toBe(1);
  await page.clock.fastForward(60000);
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Refresh ESPN', exact: true }).click();
  await expect(page.locator('.form-error[role=alert]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Refresh ESPN', exact: true }),
  ).toBeEnabled();
  expect(requests).toBe(2);
});
