import type { Page } from '@playwright/test';
import { expect, getLabel, setSettings, test } from './fixtures';

const HEP_TH_NEW = '/list/hep-th/new';

async function open(page: Page, origin: string) {
  await page.goto(origin + HEP_TH_NEW);
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
}

/** A new submission whose abstract is collapsed, pinned by arXiv ID. */
async function collapsedPaper(page: Page) {
  const id = await page
    .locator('dl#articles')
    .first()
    .locator('dd.axt-collapsed')
    .first()
    .evaluate((dd) => dd.previousElementSibling!.querySelector('a[title=Abstract]')!.id);
  return { id, dd: page.locator(`dt:has(a[id="${id}"]) + dd`) };
}

test('marking a paper relevant persists, expands it and lifts its score', async ({ context, server, worker }) => {
  const page = await context.newPage();
  await open(page, server.origin);
  const { id, dd } = await collapsedPaper(page);
  const badge = dd.locator('.axt-badge');
  const before = Number(await badge.textContent());
  const yes = dd.getByRole('button', { name: 'Relevant', exact: true });

  await yes.click();
  await expect(yes).toHaveAttribute('aria-pressed', 'true');
  await expect(dd).not.toHaveClass(/axt-collapsed/);
  // The background re-scores: the paper is now its own positive example.
  await expect.poll(async () => Number(await badge.textContent())).toBeGreaterThan(before + 0.2);
  await expect(badge).toHaveAttribute('title', new RegExp(`similar to ${id.replace('.', '\\.')}, which you marked relevant`));
  expect((await getLabel(worker, id))?.explicit).toBe(1);

  await page.reload();
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  await expect(dd.getByRole('button', { name: 'Relevant', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Clicking again undoes it.
  await dd.getByRole('button', { name: 'Relevant', exact: true }).click();
  await expect(dd.getByRole('button', { name: 'Relevant', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await getLabel(worker, id))?.explicit).toBeNull();
});

test('with sorting on, feedback updates scores but papers only move on reload', async ({ context, server, worker }) => {
  await setSettings(worker, { sortByScore: true });
  const page = await context.newPage();
  await open(page, server.origin);
  const ids = () =>
    page
      .locator('dl#articles')
      .first()
      .locator(':scope > dt a[title=Abstract]')
      .evaluateAll((as) => as.map((a) => a.id));
  const before = await ids();
  const [last, secondLast] = [before[before.length - 1]!, before[before.length - 2]!];
  const lastDd = page.locator(`dt:has(a[id="${last}"]) + dd`);
  const badge = lastDd.locator('.axt-badge');
  const score = Number(await badge.textContent());

  // Mark the last paper relevant and follow an author of the one before it.
  await lastDd.getByRole('button', { name: 'Relevant', exact: true }).click();
  await expect.poll(async () => Number(await badge.textContent())).toBeGreaterThan(score + 0.2);
  await page.locator(`dt:has(a[id="${secondLast}"]) + dd .list-authors a`).first().hover();
  await page.locator('.axt-menu').getByRole('menuitem', { name: /Follow/ }).click();
  await expect(page.locator(`dt:has(a[id="${secondLast}"]) + dd .axt-star`).first()).toBeVisible();
  expect(await ids()).toEqual(before);

  // A reload sorts again with the new scores.
  await page.reload();
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  const after = await ids();
  expect(after.slice(0, 2).sort()).toEqual([last, secondLast].sort());
});

test('the daily review panel labels papers', async ({ context, server, worker }) => {
  const page = await context.newPage();
  await open(page, server.origin);
  const panel = page.locator('details.axt-review');
  await expect(panel.locator('summary')).toHaveText(/^Daily review: \d+ shown expanded, \d+ collapsed or hidden$/);
  await panel.locator('summary').click();
  await expect(panel.locator('tr')).toHaveCount(90);

  const row = panel.locator('tr').first();
  const id = (await row.locator('a').getAttribute('href'))!.slice(1);
  await row.getByRole('button', { name: /^Not relevant:/ }).click();
  await expect(row.getByRole('button', { name: /^Not relevant:/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('summary')).toContainText('1 marked');
  const entry = page.locator(`dt:has(a[id="${id}"]) + dd`);
  await expect(entry.getByRole('button', { name: 'Not relevant', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(entry).toHaveClass(/axt-collapsed/);
  await expect.poll(async () => (await getLabel(worker, id))?.explicit).toBe(0);
});

test('expanding an abstract is recorded as a weak signal, not a label', async ({ context, server, worker }) => {
  const page = await context.newPage();
  await open(page, server.origin);
  const { id, dd } = await collapsedPaper(page);
  await dd.locator('.axt-toggle').click();
  await expect.poll(async () => (await getLabel(worker, id))?.signals.expand).toBeGreaterThan(0);
  expect((await getLabel(worker, id))?.explicit).toBeNull();
});

test('papers shown expanded are remembered, for "shown and ignored"', async ({ context, server, worker }) => {
  // With no profile every new submission scores σ(−1.6) ≈ 0.17; a low threshold expands them.
  await setSettings(worker, { threshold: 0.1 });
  const page = await context.newPage();
  await open(page, server.origin);
  const expanded = page.locator('dl#articles').first().locator('dd:not(.axt-collapsed):not(.axt-hidden)').first();
  const id = await expanded.evaluate((d) => d.previousElementSibling!.querySelector('a[title=Abstract]')!.id);
  await expect.poll(async () => (await getLabel(worker, id))?.signals.shown).toBeGreaterThan(0);
});
