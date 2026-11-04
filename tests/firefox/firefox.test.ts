/**
 * The Firefox build in a real Firefox, through WebDriver (`npm run test:firefox`). Selenium Manager
 * fetches geckodriver, and a Firefox build if none is installed, into .cache/selenium.
 *
 * WebDriver may not script the extension's own moz-extension:// pages, so everything goes through
 * the listing: the overlay's own controls, and (e2e builds only) settings changes posted to the
 * content script. Switching off persists, so a reload shows arXiv's untouched page.
 *
 * - The e2e build (stand-in embedder, also matching localhost) on the local hep-th/new fixture.
 * - The e2e build with the real model, which needs the network (Hugging Face): REAL=1.
 */

import { createServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, type WebDriver, type WebElement } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Settings } from '../../src/settings';
import { startFixtureServer, type FixtureServer } from '../e2e/server';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A free port, probed on loopback. Selenium's own probe listens on every interface, which makes
 * Windows Firewall ask about Node.js.
 */
function loopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function launch(build: 'dist-e2e' | 'dist-e2e-real'): Promise<WebDriver> {
  const options = new firefox.Options().addArguments('-headless');
  // Lets Selenium Manager download a Firefox build when none is installed.
  options.setBrowserVersion('stable');
  const service = new firefox.ServiceBuilder().setPort(await loopbackPort());
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  await (driver as firefox.Driver).installAddon(join(ROOT, build, 'firefox'), true);
  return driver;
}

/** Changes settings through the content script's test hook (e2e builds only). */
async function setSettings(driver: WebDriver, patch: Partial<Settings>): Promise<void> {
  await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     window.addEventListener('message', function on(e) {
       if (e.data && e.data.axtTestDone) { window.removeEventListener('message', on); done(); }
     });
     window.postMessage({ axtTest: arguments[0] }, location.origin);`,
    patch,
  );
}

async function waitFor<T>(driver: WebDriver, fn: () => Promise<T | false | null | undefined>, timeout = 20_000, what = 'condition'): Promise<T> {
  return driver.wait(async () => (await fn()) || false, timeout, `timed out waiting for ${what}`) as Promise<T>;
}

const badgeCount = (driver: WebDriver) =>
  driver.executeScript<number>(`return document.querySelectorAll('.list-title .axt-badge:not(.axt-pending)').length`);

async function openListing(driver: WebDriver, server: FixtureServer, timeout = 30_000): Promise<void> {
  await driver.get(`${server.origin}/list/hep-th/new`);
  await waitFor(driver, async () => (await badgeCount(driver)) === 90, timeout, '90 badges');
}

const scoresOnPage = (driver: WebDriver) =>
  driver.executeScript<Record<string, number>>(
    `return Object.fromEntries([...document.querySelectorAll('dl#articles dt')].map((dt) =>
       [dt.querySelector('a[title=Abstract]').id, Number(dt.nextElementSibling.querySelector('.axt-badge').textContent)]))`,
  );

describe('Firefox: the overlay', () => {
  let driver: WebDriver;
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer(0, { mathjaxStub: true });
    driver = await launch('dist-e2e');
  });

  afterAll(async () => {
    await driver?.quit();
    await server?.close();
  });

  it('opens its settings page from the summary bar', async () => {
    await openListing(driver, server);
    const listing = await driver.getWindowHandle();
    const before = await driver.getAllWindowHandles();
    await driver.findElement(By.xpath(`//*[contains(@class,'axt-summary')]//button[starts-with(normalize-space(.),'set up your profile')]`)).click();
    const tab = await waitFor(driver, async () => (await driver.getAllWindowHandles()).find((h) => !before.includes(h)), 10_000, 'a new tab');
    await driver.switchTo().window(tab);
    await waitFor(driver, async () => /^moz-extension:\/\/[^/]+\/options\.html#setup$/.test(await driver.getCurrentUrl()), 10_000, 'the settings page');
    await driver.switchTo().window(listing);
  });

  it('scores, collapses and re-expands, follows, labels, and restores the page exactly', async () => {
    await openListing(driver, server);

    // A collapsed abstract expands on request and is handed to MathJax (main-world bridge).
    const id = await driver.executeScript<string>(
      `return document.querySelector('dl#articles dd.axt-collapsed').previousElementSibling.querySelector('a[title=Abstract]').id`,
    );
    const dd = await driver.findElement(By.css(`dt:has(a[id="${id}"]) + dd`));
    const abstract = await dd.findElement(By.css('.meta > p.mathjax'));
    expect(await abstract.isDisplayed()).toBe(false);
    await dd.findElement(By.css('.axt-toggle')).click();
    expect(await abstract.isDisplayed()).toBe(true);
    await waitFor(
      driver,
      () => driver.executeScript<boolean>(`return (window.__mathjaxCalls || []).some((c) => c[0] === 'Typeset' && c[1] === ${JSON.stringify(id)})`),
      5_000,
      'MathJax typesetting',
    );

    // Following an author from the hover menu stars them.
    const author: WebElement = await dd.findElement(By.css('.list-authors a'));
    await driver.actions().move({ origin: author }).perform();
    const follow = await waitFor(driver, async () => (await driver.findElements(By.css('.axt-menu button')))[0], 5_000, 'the author menu');
    expect(await follow.getText()).toContain('Follow');
    await follow.click();
    await waitFor(driver, async () => (await dd.findElements(By.css('.list-authors .axt-star'))).length === 1, 10_000, 'the star');

    // ✓ registers, and stays on while the re-scores started by the follow and the label come back.
    const yes = await driver.findElement(By.css('dl#articles dd .axt-fb-yes'));
    await yes.click();
    expect(await yes.getAttribute('aria-pressed')).toBe('true');
    await driver.sleep(1500);
    expect(await yes.getAttribute('aria-pressed')).toBe('true');

    // Switching off removes every trace; a reload (now with the overlay off) is arXiv's own page,
    // and the restored DOM must be identical to it.
    await driver.findElement(By.css('.axt-summary .axt-off')).click();
    await waitFor(driver, async () => (await driver.findElements(By.css('[data-axt]'))).length === 0, 10_000, 'the overlay to go');
    const restored = await driver.executeScript<string>('return document.documentElement.outerHTML');
    await driver.navigate().refresh();
    await waitFor(driver, () => driver.executeScript<boolean>('return !!window.MathJax'), 10_000, 'the MathJax stand-in');
    await driver.sleep(1000);
    const pristine = await driver.executeScript<string>('return document.documentElement.outerHTML');
    expect(pristine).not.toContain('data-axt');
    expect(restored).toBe(pristine);
  });
});

describe.skipIf(!process.env.REAL)('Firefox: the real model', () => {
  let driver: WebDriver;
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer(0, { mathjaxStub: true });
    driver = await launch('dist-e2e-real');
  });

  afterAll(async () => {
    await driver?.quit();
    await server?.close();
  });

  it('downloads and runs the embedding model in the background page', async () => {
    const t0 = Date.now();
    await openListing(driver, server, 5 * 60_000); // first scoring: download + embedding
    const firstRun = (Date.now() - t0) / 1000;
    const statusText = () => driver.executeScript<string>(`return document.querySelector('.axt-summary .axt-status').textContent`);
    expect(await statusText()).not.toMatch(/failed/);
    const before = JSON.stringify(await scoresOnPage(driver));

    // Give it something to score against; the open listing re-scores with the interests.
    await setSettings(driver, { interests: 'Holography and AdS/CFT, supergravity, N=4 super Yang-Mills, black holes in string theory.' });
    const p = await waitFor(
      driver,
      async () => {
        if (/updating|scoring/.test(await statusText())) return false;
        const scores = await scoresOnPage(driver);
        return JSON.stringify(scores) !== before ? scores : false;
      },
      2 * 60_000,
      'scores that depend on the interests',
    );
    expect(await statusText()).not.toMatch(/failed/);
    const holography = ['2610.28319', '2601.15736', '2608.27410', '2610.27097', '2610.27246'];
    const unrelated = ['2610.27396', '2610.27308', '2609.26676', '2610.18629', '2309.10133'];
    const mean = (ids: string[]) => ids.reduce((s, id) => s + p[id]!, 0) / ids.length;
    console.log(
      `Firefox real model: first scoring ${firstRun.toFixed(1)} s; holography ${mean(holography).toFixed(2)}, unrelated ${mean(unrelated).toFixed(2)}`,
    );
    expect(mean(holography)).toBeGreaterThan(mean(unrelated) + 0.2);
  });
});
