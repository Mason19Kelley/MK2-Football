import { test, expect } from '@playwright/test';
import { demoLeague } from '../../lib/demo';
test('rosters filter, switch projection periods, and browse other teams', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'My roster', exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Search players' }).fill('Josh');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Josh Allen');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: 'RB', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Rest of season', exact: true })
    .click();
  await expect(page.locator('thead')).toContainText('ROS PROJ.');
  await page
    .getByRole('button', { name: 'League rosters', exact: true })
    .click();
  await expect(page.locator('.league-table tbody tr')).toHaveCount(8);
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.locator('.league-table tbody tr').first()).toContainText(
    'Fourth & Long',
  );
  await page
    .getByRole('button', { name: 'Gridiron Gang', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Gridiron Gang', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Set as my team' }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Gridiron Gang', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('trade simulator updates projected lineup value and resets', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  await page.getByRole('checkbox', { name: /James Conner/ }).check();
  await page.getByRole('checkbox', { name: /Bijan Robinson/ }).check();
  await expect(
    page.getByRole('heading', { name: 'Your starting lineup gets stronger.' }),
  ).toBeVisible();
  await expect(page.locator('.trade-impact').first()).toContainText('+73.8');
  await page.getByRole('button', { name: 'Reset trade' }).click();
  await expect(
    page.getByRole('heading', { name: 'What does the trade change?' }),
  ).toBeVisible();
});
test('connect handles errors, imports data, and never persists ESPN credentials', async ({
  page,
}) => {
  let call = 0;
  await page.route('**/api/espn', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.espnS2).toBe('secret-session');
    expect(body.swid).toBe('{secret-owner}');
    call++;
    await route.fulfill({
      status: call === 1 ? 401 : 200,
      json:
        call === 1
          ? { error: 'ESPN session expired.' }
          : {
              league: {
                ...demoLeague,
                id: '42',
                name: 'Imported league',
                source: 'espn',
                syncedAt: new Date().toISOString(),
              },
            },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect ESPN league' });
  await dialog.getByLabel('ESPN league URL or ID').fill('42');
  await dialog.getByLabel('My league is private').check();
  await dialog.getByLabel('espn_s2', { exact: true }).fill('secret-session');
  await dialog.getByLabel('SWID', { exact: true }).fill('{secret-owner}');
  await dialog
    .getByRole('button', { name: 'Connect league', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toHaveText('ESPN session expired.');
  await dialog
    .getByRole('button', { name: 'Connect league', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.connected-banner')).toContainText(
    'Imported league',
  );
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain('secret-session');
  expect(storage).not.toContain('secret-owner');
  await page.getByRole('button', { name: 'Sync ESPN', exact: true }).click();
  await dialog.getByLabel('My league is private').check();
  await expect(dialog.getByLabel('espn_s2', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('SWID', { exact: true })).toHaveValue('');
});
test('custom projection upload rejects bad data, applies good data, and restores originals', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Rest of season', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Projection settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Projection settings' });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('player_id,ros_points\n999999,300'),
  });
  await expect(dialog.getByRole('alert')).toContainText(
    'not on a league roster',
  );
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'good.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('player_id,ros_points\n3918298,500'),
  });
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator('tbody tr').filter({ hasText: 'Josh Allen' }),
  ).toContainText('500.0');
  await expect(
    page.locator('tbody tr').filter({ hasText: 'Josh Allen' }),
  ).toContainText('CUSTOM');
  await page
    .getByRole('button', { name: 'Projection settings', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Restore original' }).click();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(
    page.locator('tbody tr').filter({ hasText: 'Josh Allen' }),
  ).toContainText('310.0');
});
test('mobile navigation and dialogs work without horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'League rosters', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'The whole league.' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Connect ESPN league' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Connect ESPN league' }),
  ).not.toBeVisible();
});

test('waiver wire filters available players and compares pickups in both projection periods', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Waiver wire', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Find your next upgrade.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'RB', exact: true }).click();
  const lists = page.locator('.waiver-grid .trade-player-list');
  await expect(lists.nth(0).locator('.waiver-player')).toHaveCount(3);
  await expect(lists.nth(1).locator('.waiver-player')).toHaveCount(2);
  await page.getByRole('radio', { name: /James Conner/ }).check();
  await page.getByRole('radio', { name: /Rico Dowdle/ }).check();
  await expect(
    page.getByRole('heading', { name: 'Your best starting lineup improves.' }),
  ).toBeVisible();
  await expect(
    page.locator('.waiver-results .trade-impact').first(),
  ).toContainText('+18.8');
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await expect(
    page.locator('.waiver-results .trade-impact').first(),
  ).toContainText('+1.5');
  await page
    .getByRole('textbox', { name: 'Search available players' })
    .fill('not a player');
  await expect(page.getByText('No available players found')).toBeVisible();
  await page.getByRole('button', { name: 'Clear waiver search' }).click();
  await page.getByLabel('Availability filter').selectOption('On waivers');
  await expect(lists.nth(1).locator('.waiver-player')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset comparison' }).click();
  await expect(
    page.getByRole('heading', { name: 'Could this pickup improve your team?' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('saved ESPN league without a waiver pool prompts sync without showing sample players', async ({
  page,
}) => {
  const old = {
    ...demoLeague,
    id: '42',
    name: 'Saved ESPN league',
    source: 'espn',
  };
  delete old.waiverWire;
  await page.addInitScript(
    (data) =>
      localStorage.setItem(
        'sunday-league-v1',
        JSON.stringify({ league: data, original: data, myTeamId: 1 }),
      ),
    old,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Waiver wire', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Load your league’s waiver wire' }),
  ).toBeVisible();
  await expect(page.locator('.waiver-player')).toHaveCount(0);
  await page
    .locator('.waiver-load-state')
    .getByRole('button', { name: 'Sync ESPN' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Connect ESPN league' }),
  ).toBeVisible();
});

test('trade finder searches the league, reviews a result, and clears stale results', async ({
  page,
}) => {
  await page.addInitScript((demo) => {
    const makePlayer = (id: number, ros: number, slot: number) => ({
      ...demo.teams[0].players[0],
      id,
      name: `Player ${id}`,
      ros,
      position: slot === 2 ? 'RB' : 'WR',
      slotId: 20,
      eligibleSlots: [slot],
    });
    const league = {
      ...demo,
      slots: [
        { id: 2, label: 'RB', count: 1 },
        { id: 4, label: 'WR', count: 1 },
      ],
      teams: [
        {
          ...demo.teams[0],
          players: [
            makePlayer(1, 100, 2),
            makePlayer(2, 90, 2),
            makePlayer(3, 40, 4),
          ],
        },
        {
          ...demo.teams[1],
          players: [
            makePlayer(4, 40, 2),
            makePlayer(5, 100, 4),
            makePlayer(6, 90, 4),
          ],
        },
      ],
    };
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league, original: league, myTeamId: 1 }),
    );
  }, demoLeague);
  await page.goto('/');
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  const finder = page.getByRole('region', {
    name: 'Trade finder',
    exact: true,
  });
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await expect(finder.getByRole('status')).toContainText('improving trades');
  const first = finder.locator('.finder-card').first();
  await expect(first.locator('.finder-gains')).toContainText('+');
  const partner = await first.getByRole('heading').innerText();
  await first.getByText('See starting lineup changes').click();
  await expect(first.locator('.finder-lineup').first()).toContainText(
    'Before:',
  );
  await first.getByRole('button', { name: 'Review in trade lab' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Trade partner', exact: true }),
  ).toHaveValue(String(demoLeague.teams.find((t) => t.name === partner)!.id));
  await expect(
    page.getByRole('heading', { name: 'Your starting lineup gets stronger.' }),
  ).toBeVisible();
  await expect(page.locator('.trade-picker input:checked')).toHaveCount(2);
  await finder.getByLabel('Minimum ROS gain per team').fill('99999');
  await expect(finder.locator('.finder-card')).toHaveCount(0);
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await expect(finder.getByRole('status')).toContainText(
    'No trades met these criteria',
  );
});

test('trade finder fits mobile and searches a selected partner', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await expect(finder.getByRole('status')).toContainText('checked');
  for (const heading of await finder
    .locator('.finder-card h4')
    .allTextContents()) {
    expect(heading).toBe(demoLeague.teams.find((t) => t.id === 2)!.name);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await finder.getByLabel('Trade size').selectOption('2');
  await finder
    .getByRole('button', { name: 'Find trades', exact: true })
    .click();
  await finder.getByRole('button', { name: 'Cancel search' }).click();
  await expect(
    finder.getByRole('button', { name: 'Find trades', exact: true }),
  ).toBeEnabled();
  await expect(finder.locator('.finder-card')).toHaveCount(0);
});

test('saved defensive players and slots are removed throughout the app and both stored snapshots', async ({
  page,
}) => {
  await page.addInitScript((demo) => {
    const defense = {
      ...demo.teams[0].players[0],
      id: 999,
      name: 'Hidden Team Defense',
      position: 'D/ST',
      slotId: 16,
      eligibleSlots: [16, 20],
    };
    const idp = {
      ...defense,
      id: 998,
      name: 'Hidden Defensive Player',
      position: 'IDP',
      slotId: 20,
      eligibleSlots: [15, 20],
    };
    const league = {
      ...demo,
      teams: demo.teams.map((t, i) => ({
        ...t,
        players: i ? t.players : [...t.players, defense, idp],
      })),
      slots: [
        ...demo.slots,
        { id: 16, label: 'D/ST', count: 1 },
        { id: 15, label: 'IDP', count: 1 },
      ],
      waiverWire: {
        ...demo.waiverWire,
        players: [
          ...demo.waiverWire!.players,
          { ...defense, availability: 'FREEAGENT', percentOwned: 5 },
        ],
      },
    };
    localStorage.setItem(
      'sunday-league-v1',
      JSON.stringify({ league, original: league, myTeamId: 1 }),
    );
  }, demoLeague);
  await page.goto('/');
  await expect(page.locator('.position-tabs')).not.toContainText('D/ST');
  await expect(page.locator('.position-tabs')).not.toContainText('IDP');
  await expect(page.getByText('Hidden Team Defense')).toHaveCount(0);
  await expect(page.getByText('Hidden Defensive Player')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('sunday-league-v1')!);
        return [saved.league, saved.original].every(
          (l) =>
            l.teams.every((t: { players: { position: string }[] }) =>
              t.players.every((p) => !['D/ST', 'IDP'].includes(p.position)),
            ) &&
            l.slots.every((s: { id: number }) => ![15, 16].includes(s.id)) &&
            l.waiverWire.players.every(
              (p: { position: string }) => p.position !== 'D/ST',
            ),
        );
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: /^Trade lab/ }).click();
  await expect(page.getByText('Hidden Team Defense')).toHaveCount(0);
  await expect(page.getByText('Hidden Defensive Player')).toHaveCount(0);
});
