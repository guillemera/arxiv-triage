/**
 * Playwright fixtures: Chromium with the unpacked e2e build loaded, the local fixture server, and
 * network isolation. Every request outside localhost is blocked, except that arXiv's stylesheet on
 * static.arxiv.org is served from the vendored copy and MathJax is replaced by a stub that records
 * what the overlay asks it to typeset.
 */

import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_DIR, MATHJAX_STUB, startFixtureServer, type FixtureServer } from './server';

export { MATHJAX_STUB };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION_DIRS = { e2e: join(ROOT, 'dist-e2e', 'chrome'), production: join(ROOT, 'dist', 'chrome') };

export interface Options {
  /** Allow arXiv's static assets (fonts, real MathJax) from the network, for screenshots only. */
  liveStatic: boolean;
  /** Which build to load: the e2e variant (stand-in embedder) or the real one. */
  extension: keyof typeof EXTENSION_DIRS;
  /** Extra hosts (and their subdomains) allowed through, for opt-in tests against live services. */
  allowHosts: string[];
  /** Serve https://arxiv.org/list/... from the local fixtures, so the production build runs on them. */
  arxivFromFixtures: boolean;
  /** Serve hep-th/new as the made-up listing of `demo.ts`. */
  demo: boolean;
}

export const test = base.extend<
  Options & { server: FixtureServer; context: BrowserContext; worker: Worker },
  {}
>({
  liveStatic: [false, { option: true }],
  extension: ['e2e', { option: true }],
  allowHosts: [[], { option: true }],
  arxivFromFixtures: [false, { option: true }],
  demo: [false, { option: true }],
  server: async ({ demo }, use) => {
    const server = await startFixtureServer(0, { demo });
    await use(server);
    await server.close();
  },
  context: async ({ liveStatic, extension, allowHosts, arxivFromFixtures, server }, use, testInfo) => {
    const dir = EXTENSION_DIRS[extension];
    const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
      channel: 'chromium',
      viewport: { width: 1100, height: 900 },
      args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
    });
    const designCss = await readFile(join(FIXTURE_DIR, 'static', 'design-system-components.css'));
    const allowed = (host: string) => allowHosts.some((h) => host === h || host.endsWith(`.${h}`));
    await context.route(/.*/, async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return route.continue();
      }
      if (arxivFromFixtures && url.hostname === 'arxiv.org') {
        const res = await route.fetch({ url: server.origin + url.pathname });
        return route.fulfill({ response: res });
      }
      if (allowed(url.hostname)) return route.continue();
      if (url.hostname === 'static.arxiv.org') {
        if (url.pathname.endsWith('/design-system-components.css')) {
          return route.fulfill({ body: designCss, contentType: 'text/css' });
        }
        if (url.pathname.includes('/MathJax') && !liveStatic) {
          return route.fulfill({ body: MATHJAX_STUB, contentType: 'text/javascript' });
        }
        if (liveStatic) return route.continue();
      }
      return route.abort('blockedbyclient');
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
});

export const expect = test.expect;

export interface TestSeed {
  key: string;
  source: 'own' | 'refs' | 'followed' | 'pasted';
  arxivId: string | null;
  title: string;
  abstract: string | null;
  label: string;
}

/**
 * Puts seed papers into the extension's IndexedDB (which the extension must already have created,
 * e.g. by scoring a page) and bumps the profile version so open listings re-score.
 */
export async function addSeeds(worker: Worker, seeds: TestSeed[]): Promise<void> {
  await worker.evaluate(async (records) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('arxiv-triage');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('seeds', 'readwrite');
      for (const r of records) tx.objectStore('seeds').put({ ...r, inspireId: null, addedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const local = (globalThis as unknown as { chrome: { storage: { local: { set(o: object): Promise<void> } } } }).chrome
      .storage.local;
    await local.set({ profileVersion: Date.now() });
  }, seeds);
}

/** Reads a paper's feedback record from the extension's IndexedDB. */
export async function getLabel(worker: Worker, id: string): Promise<{ explicit: 0 | 1 | null; signals: Record<string, number> } | undefined> {
  return worker.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('arxiv-triage');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rec = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('labels').objectStore('labels').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rec as { explicit: 0 | 1 | null; signals: Record<string, number> } | undefined;
  }, id);
}

/** Writes settings straight into the extension's storage.sync, from its service worker. */
export async function setSettings(worker: Worker, patch: Record<string, unknown>): Promise<void> {
  await worker.evaluate(async (p) => {
    type Area = { get(key: string): Promise<Record<string, unknown>>; set(items: object): Promise<void> };
    const sync = (globalThis as unknown as { chrome: { storage: { sync: Area } } }).chrome.storage.sync;
    const { settings } = await sync.get('settings');
    await sync.set({ settings: { ...((settings as object) ?? {}), ...p } });
  }, patch);
}
