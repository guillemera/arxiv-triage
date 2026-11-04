import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const FIXTURES = {
  hepThNew: { file: 'arxiv/hep-th-new.html', url: 'https://arxiv.org/list/hep-th/new' },
  grQcNew: { file: 'arxiv/gr-qc-new.html', url: 'https://arxiv.org/list/gr-qc/new' },
  hepThRecent: { file: 'arxiv/hep-th-recent.html', url: 'https://arxiv.org/list/hep-th/recent' },
  hepThPastweek: {
    file: 'arxiv/hep-th-pastweek.html',
    url: 'https://arxiv.org/list/hep-th/pastweek?skip=0&show=25',
  },
} as const;

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function readFixture(file: string): string {
  return readFileSync(join(FIXTURE_DIR, file), 'utf8');
}

/** Loads a fixture into its own jsdom window (scripts are not run). */
export function loadFixture(name: keyof typeof FIXTURES): { doc: Document; url: string; window: JSDOM['window'] } {
  const { file, url } = FIXTURES[name];
  const dom = new JSDOM(readFixture(file), { url });
  return { doc: dom.window.document, url, window: dom.window };
}
