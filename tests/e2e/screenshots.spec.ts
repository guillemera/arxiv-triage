/**
 * Screenshots for judging how close the overlay stays to the arXiv look (docs/screenshots):
 * the production build with the real model, on a made-up hep-th/new listing (demo.ts) served at
 * its arxiv.org URL with arXiv's real MathJax and fonts, for a made-up researcher whose papers come
 * from a fake INSPIRE. No real paper or person appears.
 *
 *   npm run build && SCREENSHOTS=1 npm run test:e2e -- screenshots
 *
 * Network: the Hugging Face hub and its file CDN, static.arxiv.org.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { DEMO_FOLLOWED, DEMO_INTERESTS, DEMO_NOT_INTERESTED, DEMO_PAPERS, DEMO_PROFILE_URL, demoInspireResponse } from './demo';
import { expect, setSettings, test } from './fixtures';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'screenshots');

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 (after npm run build) to take screenshots');
test.use({
  extension: 'production',
  liveStatic: true,
  arxivFromFixtures: true,
  demo: true,
  allowHosts: ['huggingface.co', 'hf.co', 'xethub.hf.co'],
});
test.setTimeout(5 * 60_000);

async function mathJaxSettled(page: Page) {
  await page.waitForFunction(() => (window as unknown as { MathJax?: { isReady?: boolean } }).MathJax?.isReady === true, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
}

/** Waits for a re-score to finish. */
async function scoresSettled(page: Page) {
  await expect(page.locator('.axt-summary .axt-status')).not.toHaveText(/updating|scoring/, { timeout: 60_000 });
}

test('hep-th/new with the overlay on and off', async ({ context, worker }) => {
  await mkdir(OUT, { recursive: true });
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  await context.route('https://inspirehep.net/api/**', (route) => {
    const body = demoInspireResponse(new URL(route.request().url()));
    return body ? route.fulfill({ json: body }) : route.abort();
  });

  // First-run setup: the made-up researcher's INSPIRE profile and interests.
  const options = await context.newPage();
  await options.setViewportSize({ width: 900, height: 1000 });
  await options.goto(`${base}/options.html#setup`);
  await options.fill('#inspireProfile', DEMO_PROFILE_URL);
  await options.fill('#interests', DEMO_INTERESTS);
  await options.fill('#negativeInterests', DEMO_NOT_INTERESTED);
  await options.locator('#negativeInterests').blur();
  await options.getByRole('button', { name: 'Fetch my papers from INSPIRE' }).click();
  await expect(options.locator('#seed-inspire-status')).toContainText('Ana Ferreira: 3 papers, 9 cited papers', { timeout: 30_000 });

  const page = await context.newPage();
  await page.goto('https://arxiv.org/list/hep-th/new');
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(DEMO_PAPERS.length, { timeout: 4 * 60_000 });

  // Follow one author from the page, to show the star, and mark two papers.
  await page.locator('.list-authors a', { hasText: DEMO_FOLLOWED }).first().hover();
  await page.locator('.axt-menu').getByRole('menuitem', { name: /Follow/ }).click();
  await expect(page.locator('.axt-star').first()).toBeVisible();
  await page.mouse.move(0, 0);
  await scoresSettled(page);
  const entry = (id: string) => page.locator(`dt:has(a[id="${id}"]) + dd`);
  await entry('2611.90503').locator('.axt-fb-yes').click();
  await entry('2611.90468').locator('.axt-fb-no').click();
  await scoresSettled(page);
  // The page keeps its layout while you read; a reload shows every paper as now scored.
  await page.reload();
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(DEMO_PAPERS.length, { timeout: 60_000 });
  await mathJaxSettled(page);

  const top = { x: 0, y: 0, width: 1100, height: 1700 };
  await page.screenshot({ path: join(OUT, 'hep-th-new-on.png'), clip: top, fullPage: true });

  const replacements = await page
    .locator('dl#articles')
    .nth(2)
    .evaluate((dl) => dl.getBoundingClientRect().top + window.scrollY);
  await page.screenshot({
    path: join(OUT, 'hep-th-new-on-lower.png'),
    clip: { x: 0, y: Math.max(0, replacements - 700), width: 1100, height: 1300 },
    fullPage: true,
  });

  const review = page.locator('details.axt-review');
  await review.locator('summary').click();
  await page.waitForTimeout(1500); // MathJax typesets the titles
  await review.screenshot({ path: join(OUT, 'review-panel.png') });
  await review.locator('summary').click();

  // Off: the page is arXiv's own again.
  await setSettings(worker, { enabled: false });
  await expect(page.locator('[data-axt]')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'hep-th-new-off.png'), clip: top, fullPage: true });
  await setSettings(worker, { enabled: true });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 330, height: 140 });
  await popup.goto(`${base}/popup.html`);
  await popup.screenshot({ path: join(OUT, 'popup.png'), fullPage: true });

  await options.goto(`${base}/options.html`);
  await options.screenshot({ path: join(OUT, 'settings.png'), clip: { x: 0, y: 0, width: 900, height: 1400 }, fullPage: true });
});
