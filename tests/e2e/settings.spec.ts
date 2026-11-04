/**
 * The settings page end to end: author manager and INSPIRE linking, export/import/reset, the
 * namesake check on a listing, and the popup.
 */

import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { readFixture } from '../unit/helpers';
import { expect, setSettings, test } from './fixtures';

const optionsUrl = (worker: Worker, hash = '') => `chrome-extension://${new URL(worker.url()).host}/options.html${hash}`;

/** Fake INSPIRE: author search answers with the made-up Jane Doe search; literature with `papers`. */
async function fakeInspire(context: BrowserContext, papers: Record<string, string[]> = {}) {
  const search = readFixture('api/inspire-authors-search.json');
  await context.route('https://inspirehep.net/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/authors') return route.fulfill({ contentType: 'application/json', body: search });
    if (url.pathname === '/api/literature') {
      const hits = Object.entries(papers).map(([id, ids]) => ({
        metadata: { arxiv_eprints: [{ value: id }], authors: ids.map((v) => ({ ids: [{ value: v }] })) },
      }));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ hits: { hits, total: hits.length } }) });
    }
    return route.abort();
  });
}

async function setFollowed(worker: Worker, followed: object[]) {
  await worker.evaluate(async (list) => {
    const sync = (globalThis as unknown as { chrome: { storage: { sync: { set(o: object): Promise<void> } } } }).chrome.storage.sync;
    await sync.set({ 'followed.n': 1, 'followed.0': list });
  }, followed);
}

async function acceptDialogs(page: Page) {
  page.on('dialog', (d) => void d.accept());
}

test('add an author, link them to INSPIRE, and unfollow', async ({ context, worker }) => {
  await fakeInspire(context);
  const page = await context.newPage();
  await page.goto(optionsUrl(worker, '#people'));
  await page.fill('#add-name', 'Jane Doe');
  await page.locator('#add-person').getByRole('button', { name: 'Follow' }).click();
  const row = page.locator('#followed li.person', { hasText: 'Jane Doe' });
  await expect(row).toBeVisible();
  await expect(page.locator('#followed-count')).toHaveText('1');

  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByLabel('Other spellings (comma-separated)').fill('J. Doe, Jane A. Doe');
  await row.getByRole('button', { name: 'Find on INSPIRE' }).click();
  await row.locator('.inspire-candidates li', { hasText: 'J.Doe.1' }).getByRole('button', { name: 'Use' }).click();
  await expect(row.getByLabel('INSPIRE identifier (BAI)')).toHaveValue('J.Doe.1');
  await expect(row.getByLabel('ORCID')).toHaveValue('0000-0002-1825-0097');
  await row.getByRole('button', { name: 'Save' }).click();

  const saved = page.locator('#followed li.person', { hasText: 'Jane Doe' });
  await expect(saved.locator('.linked')).toHaveText('INSPIRE: J.Doe.1');
  await expect(saved).toContainText('also J. Doe, Jane A. Doe');

  await saved.getByRole('button', { name: 'Unfollow' }).click();
  await expect(page.locator('#followed li.empty')).toBeVisible();
});

test('"Link INSPIRE profile…" on a listing opens the editor for that author', async ({ context, server, worker }) => {
  await fakeInspire(context);
  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/new');
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  const author = page.locator('dt:has(a[id="2610.27007"]) + dd .list-authors a').first();
  await author.hover();
  const opened = context.waitForEvent('page');
  await page.locator('.axt-menu').getByRole('menuitem', { name: 'Link INSPIRE profile…' }).click();
  const options = await opened;
  await options.waitForLoadState();
  expect(options.url()).toContain('options.html#link=Waheed');
  const row = options.locator('#followed li.person', { hasText: 'Waheed A. Dar' });
  await expect(row.locator('.person-editor')).toBeVisible();
  await expect(row.locator('.inspire-candidates li').first()).toBeVisible();
});

test('export, reset and import round-trip your data', async ({ context, worker }) => {
  const page = await context.newPage();
  await acceptDialogs(page);
  await page.goto(optionsUrl(worker, '#people'));
  await page.fill('#add-name', 'Tom Smith');
  await page.locator('#add-person').getByRole('button', { name: 'Follow' }).click();
  await page.fill('#add-name', 'Some Spammer');
  await page.locator('#add-person').getByRole('button', { name: 'Block' }).click();
  await page.locator('#interests').fill('precision holography');
  await page.locator('#interests').blur();
  await worker.evaluate(async () => {
    const local = (globalThis as unknown as { chrome: { storage: { local: { set(o: object): Promise<void> } } } }).chrome.storage.local;
    await local.set({ 'llmKey:openai': 'sk-should-not-leak' });
  });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to a file' }).click();
  const file = await (await download).path();
  const exported = JSON.parse(await readFile(file, 'utf8'));
  expect(exported).toMatchObject({ format: 'arxiv-triage-export', version: 1 });
  expect(exported.settings.interests).toBe('precision holography');
  expect(exported.people.followed.map((p: { name: string }) => p.name)).toEqual(['Tom Smith']);
  expect(exported.people.blocked.map((p: { name: string }) => p.name)).toEqual(['Some Spammer']);
  expect(JSON.stringify(exported)).not.toContain('sk-should-not-leak');

  await page.getByRole('button', { name: 'Reset everything' }).click();
  await page.waitForURL(/#setup$/);
  await expect(page.locator('#followed li.empty')).toBeVisible();
  await expect(page.locator('#interests')).toHaveValue('');

  await page.locator('#import-file').setInputFiles(file);
  await expect(page.locator('#data-status')).toContainText('Imported 2 authors');
  await expect(page.locator('#followed li.person', { hasText: 'Tom Smith' })).toBeVisible();
  await expect(page.locator('#interests')).toHaveValue('precision holography');
});

test('a namesake loses the star once INSPIRE says it is someone else', async ({ context, server, worker }) => {
  // INSPIRE lists the authors of 2610.27007 (Dar, Ganai, Kajuri) with these identifiers.
  await fakeInspire(context, { '2610.27007': ['W.A.Dar.1', 'P.A.Ganai.1', 'N.Kajuri.1'] });
  const star = (page: Page) => page.locator('dt:has(a[id="2610.27007"]) + dd .list-authors .axt-star');

  await setFollowed(worker, [{ id: 'p1', name: 'Waheed A. Dar', aliases: [], inspireBai: 'W.Dar.9', addedAt: 1 }]);
  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/new');
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  await expect(star(page)).toHaveCount(0);

  // The right person: starred.
  await setFollowed(worker, [{ id: 'p2', name: 'Waheed A. Dar', aliases: [], inspireBai: 'W.A.Dar.1', addedAt: 1 }]);
  await page.reload();
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  await expect(star(page)).toHaveCount(1);
});

test('the popup offers the AI switch only once a provider is chosen', async ({ context, worker }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await expect(popup.locator('#ai-row')).toBeHidden();
  await expect(popup.locator('.access-banner')).toHaveCount(0);
  await setSettings(worker, { llmProvider: 'ollama' });
  await popup.reload();
  await expect(popup.locator('#ai-row')).toBeVisible();
  await expect(popup.locator('#ai-provider')).toHaveText('Ollama (local, free)');
});

test('scoring does not wait for INSPIRE when it does not answer', async ({ context, server, worker }) => {
  await context.route('https://inspirehep.net/api/**', () => {}); // never answers
  await setFollowed(worker, [{ id: 'p1', name: 'Waheed A. Dar', aliases: [], inspireBai: 'W.Dar.9', addedAt: 1 }]);
  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/new');
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90, { timeout: 10_000 });
  // The name match stands while INSPIRE cannot say otherwise.
  await expect(page.locator('dt:has(a[id="2610.27007"]) + dd .list-authors .axt-star')).toHaveCount(1);
});
