/**
 * Static server for the saved arXiv fixtures, laid out under arXiv's own paths so the e2e build
 * (which also matches http://localhost/*) runs on them exactly as on the live site.
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { renderDemoListing } from './demo';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'arxiv');

/** Stands in for MathJax and records what the overlay asks it to typeset (as [method, arXiv ID]). */
export const MATHJAX_STUB = `
  window.__mathjaxCalls = [];
  window.MathJax = { Hub: { Queue: (...calls) => {
    for (const c of calls) if (Array.isArray(c)) {
      const el = c[2];
      const dd = el && el.closest ? el.closest('dd') : null;
      const id = dd && dd.previousElementSibling ? dd.previousElementSibling.querySelector('a[title=Abstract]').id : null;
      window.__mathjaxCalls.push([c[0], id]);
    }
  } } };`;

const ROUTES: Record<string, string> = {
  '/list/hep-th/new': 'hep-th-new.html',
  '/list/gr-qc/new': 'gr-qc-new.html',
  '/list/hep-th/recent': 'hep-th-recent.html',
  '/list/hep-th/pastweek': 'hep-th-pastweek.html',
  '/static/browse/0.3.4/css/arXiv.css': 'static/arXiv.css',
  '/static/browse/0.3.4/css/browse_search.css': 'static/browse_search.css',
  '/static/browse/0.3.4/js/mathjaxToggle.min.js': 'static/mathjaxToggle.min.js',
};

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
};

export interface FixtureServer {
  origin: string;
  close(): Promise<void>;
}

const MATHJAX_URL = '//static.arxiv.org/MathJax-2.7.3/MathJax.js';

export interface FixtureServerOptions {
  /**
   * Serve the MathJax stand-in locally (for browsers where requests cannot be intercepted, such as
   * Firefox under WebDriver) by pointing arXiv's MathJax loader at it.
   */
  mathjaxStub?: boolean;
  /** Serve the made-up listing of `demo.ts` as hep-th/new (for the screenshots). */
  demo?: boolean;
}

export async function startFixtureServer(port = 0, opts: FixtureServerOptions = {}): Promise<FixtureServer> {
  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/$/, '');
    if (opts.mathjaxStub && path === '/static/mathjax-stub.js') {
      res.writeHead(200, { 'content-type': TYPES.js! }).end(MATHJAX_STUB);
      return;
    }
    const file = ROUTES[path];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    try {
      let body: Buffer | string = await readFile(join(FIXTURE_DIR, file));
      if (opts.mathjaxStub && file.endsWith('mathjaxToggle.min.js')) {
        body = body.toString('utf8').replace(MATHJAX_URL, '/static/mathjax-stub.js');
      }
      if (opts.demo && path === '/list/hep-th/new') body = renderDemoListing(body.toString('utf8'));
      res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()!] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${actual}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
