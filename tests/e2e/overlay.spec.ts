import type { Page } from '@playwright/test';
import { addSeeds, expect, setSettings, test } from './fixtures';

const HEP_TH_NEW = '/list/hep-th/new';

/** The dd of the first collapsed new submission, pinned by arXiv ID so it survives class changes. */
async function firstCollapsed(page: Page) {
  const id = await page
    .locator('dl#articles')
    .first()
    .locator('dd.axt-collapsed')
    .first()
    .evaluate((dd) => dd.previousElementSibling!.querySelector('a[title=Abstract]')!.id);
  return { id, dd: page.locator(`dt:has(a[id="${id}"]) + dd`) };
}

test('badges appear and low-scored abstracts collapse and re-expand', async ({ context, server }) => {
  const page = await context.newPage();
  await page.goto(server.origin + HEP_TH_NEW);
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  await expect(page.locator('.axt-summary')).toContainText('28 new · 30 cross-lists · 32 replacements');

  const { id, dd } = await firstCollapsed(page);
  const abstract = dd.locator('.meta > p.mathjax');
  await expect(abstract).toBeHidden();
  const toggle = page.locator(`dt:has(a[id="${id}"]) + dd .axt-toggle`);
  await expect(toggle).toHaveText('show abstract');
  await toggle.click();
  await expect(abstract).toBeVisible();
  // The main-world bridge asked MathJax to typeset the revealed abstract.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __mathjaxCalls: unknown[] }).__mathjaxCalls)).toContainEqual([
    'Typeset',
    id,
  ]);
  await toggle.click();
  await expect(abstract).toBeHidden();
});

test("following an author expands that author's papers", async ({ context, server }) => {
  const page = await context.newPage();
  await page.goto(server.origin + HEP_TH_NEW);
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(90);

  const { dd } = await firstCollapsed(page);
  const author = dd.locator('.list-authors a').first();
  await author.hover();
  const menu = page.locator('.axt-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Follow/ }).click();

  await expect(dd).not.toHaveClass(/axt-collapsed/);
  await expect(dd.locator('.list-authors .axt-star').first()).toBeVisible();
  await expect(page.locator('.axt-summary')).toContainText(/[1-9]\d* by followed authors/);
});

test('switching off restores the original DOM exactly', async ({ context, server, worker }) => {
  await setSettings(worker, { enabled: false });
  const page = await context.newPage();
  await page.goto(server.origin + HEP_TH_NEW);
  await page.waitForLoadState('load');
  const snapshot = await page.evaluate(() => document.documentElement.outerHTML);
  expect(snapshot).not.toContain('data-axt');

  await setSettings(worker, { enabled: true });
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(90);
  // Interact: expand an abstract, sort, reveal hidden replacements, label, use the review panel.
  await page.locator('dd.axt-collapsed .axt-toggle').first().click();
  await page.locator('.axt-summary input[type=checkbox]').check();
  await page.locator('.axt-note .axt-link').first().click();
  await page.locator('.list-title .axt-fb-no').nth(2).click();
  await page.locator('details.axt-review summary').click();
  await page.locator('details.axt-review tr a').nth(5).click();

  await page.locator('.axt-summary').getByRole('button', { name: 'turn off' }).click();
  await expect(page.locator('[data-axt]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(snapshot);

  // And back on again without a reload.
  await setSettings(worker, { enabled: true });
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(90);
});

test('seeds drive the scores, and an open page re-scores when they change', async ({ context, server, worker }) => {
  const page = await context.newPage();
  await page.goto(server.origin + HEP_TH_NEW);
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(90);
  const setup = page.locator('.axt-summary').getByRole('button', { name: /set up your profile/ });
  await expect(setup).toBeVisible();

  // Seed with the text of one listed paper; with the stand-in embedder it is its nearest match.
  const target = '2610.28319';
  const dd = page.locator(`dt:has(a[id="${target}"]) + dd`);
  const title = (await dd.locator('.list-title').evaluate((el) => el.firstChild?.nextSibling?.textContent ?? '')).trim();
  const abstract = (await dd.locator('.meta > p.mathjax').textContent())!.trim();
  await addSeeds(worker, [
    { key: 'arxiv:2401.01234', source: 'own', arxivId: '2401.01234', title, abstract, label: 'your paper 2401.01234' },
  ]);

  const badge = dd.locator('.axt-badge');
  await expect(badge).toHaveAttribute('title', /similar to your paper 2401\.01234/);
  const best = await page.locator('.axt-badge').evaluateAll((els) => Math.max(...els.map((e) => Number(e.textContent))));
  expect(Number(await badge.textContent())).toBe(best);
  expect(best).toBeGreaterThan(0.8);
  await expect(setup).toBeHidden();
  await expect(dd).not.toHaveClass(/axt-collapsed/);
});

test('runs on /recent pages without abstracts', async ({ context, server }) => {
  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/recent');
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(50);
  await expect(page.locator('.axt-summary')).toContainText('50 papers');
});

test('leaves an unrecognised page untouched and shows a warning', async ({ context, server }) => {
  const page = await context.newPage();
  await page.route('**/list/hep-th/pastweek', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><p>arXiv is down for maintenance.</p></body></html>' }),
  );
  await page.goto(server.origin + '/list/hep-th/pastweek');
  await expect(page.locator('.axt-warning')).toContainText('page layout not recognised');
  expect(await page.locator('body > p').textContent()).toBe('arXiv is down for maintenance.');
});
