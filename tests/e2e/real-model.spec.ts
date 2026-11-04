/**
 * Opt-in check of the production build with the real model and live services:
 * `REAL=1 npm run test:e2e -- real-model` (after `npm run build`).
 *
 * Seeds with classic holography papers pasted into the options page (abstracts from the live arXiv
 * API), then opens hep-th/new (served from the fixture at its real arxiv.org URL) and waits for the
 * model to download and score it.
 * Network: export.arxiv.org, the Hugging Face hub and its file CDN, static.arxiv.org.
 */

import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

test.skip(!process.env.REAL, 'set REAL=1 to run against the live arXiv API and the real model');
test.use({
  extension: 'production',
  liveStatic: true,
  arxivFromFixtures: true,
  allowHosts: ['export.arxiv.org', 'huggingface.co', 'hf.co', 'xethub.hf.co'],
});
test.setTimeout(5 * 60_000);

const SEEDS = 'hep-th/9711200, hep-th/9802109, hep-th/9802150, hep-th/9802042, hep-th/0209067, 0807.3324, 0712.2824';

test('seed with pasted papers and score hep-th/new with the real model', async ({ context, worker }, testInfo) => {
  const extensionId = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#setup`);
  await expect(options.locator('#inspireProfile')).toHaveValue(''); // nothing pre-filled
  await options.fill('#pastedIds', SEEDS);
  await options.getByRole('button', { name: 'Load these papers' }).click();
  await expect(options.locator('#seed-pasted-status')).toContainText('7 papers loaded.', { timeout: 60_000 });

  const page = await context.newPage();
  const statuses = new Map<string, number>();
  const t0 = Date.now();
  await page.goto('https://arxiv.org/list/hep-th/new');
  const status = page.locator('.axt-summary .axt-status');
  // Record when each kind of progress message first appeared.
  const poll = setInterval(async () => {
    const s = await status.textContent().catch(() => null);
    const kind = s?.replace(/\d+ of \d+( MB)?/, 'N of M$1');
    if (kind && !statuses.has(kind)) statuses.set(kind, Date.now() - t0);
  }, 250);
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(90, { timeout: 4 * 60_000 });
  clearInterval(poll);
  const firstRun = Date.now() - t0;

  const ranking = await page.locator('dl#articles dt').evaluateAll((dts) =>
    dts
      .map((dt) => {
        const dd = dt.nextElementSibling!;
        const badge = dd.querySelector('.axt-badge')!;
        const title = dd.querySelector('.list-title')!.firstChild!.nextSibling!.textContent!.trim();
        return { id: dt.querySelector('a[title=Abstract]')!.id, p: Number(badge.textContent), title, why: badge.getAttribute('title') };
      })
      .sort((a, b) => b.p - a.p),
  );

  // Second visit: everything is cached.
  const t1 = Date.now();
  await page.reload();
  await expect(page.locator('.axt-badge:not(.axt-pending)')).toHaveCount(90, { timeout: 60_000 });
  const secondRun = Date.now() - t1;

  const report = [
    `first run (download + embed): ${(firstRun / 1000).toFixed(1)} s`,
    `second run (cached): ${(secondRun / 1000).toFixed(1)} s`,
    `progress messages (first seen at): ${[...statuses].map(([s, t]) => `${(t / 1000).toFixed(1)} s ${s}`).join(' | ')}`,
    '',
    ...ranking.map((r) => `${r.p.toFixed(2)} ${r.id} ${r.title.slice(0, 70)}  [${r.why}]`),
  ].join('\n');
  await writeFile(testInfo.outputPath('ranking.txt'), report);
  console.log(report.split('\n').slice(0, 25).join('\n'));

  expect(ranking[0]!.why).toMatch(/similar to/);
  expect(ranking.filter((r) => r.p >= 0.5).length).toBeGreaterThan(5);
});
