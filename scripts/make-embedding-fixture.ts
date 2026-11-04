/**
 * Computes real embeddings for the cold-start test fixture, so the unit tests can rank the
 * hep-th/new listing offline: every paper of tests/fixtures/arxiv/hep-th-new.html, the seed papers
 * of tests/fixtures/api/arxiv-api-seeds.xml (classic holography papers) and two interest texts. Run with `npx tsx scripts/make-embedding-fixture.ts`; downloads the model on first use.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createEngine } from '../src/embedder/engine';
import { EMBEDDING_MODEL, paperText } from '../src/embedder/model';
import { parseAtom } from '../src/parser/atom';
import { parseListing } from '../src/parser/listing';

export const PROFILE = {
  interests:
    'Holography and AdS/CFT, precision holography, supersymmetric localization, supergravity solutions, ' +
    'black hole microstates, correlation functions in N=4 SYM and non-conformal holography.',
  negativeInterests: 'Collider phenomenology, lattice QCD, condensed matter experiments.',
};

const read = (p: string) => readFileSync(new URL(`../tests/fixtures/${p}`, import.meta.url), 'utf8');

const dom = new JSDOM(read('arxiv/hep-th-new.html'), { url: 'https://arxiv.org/list/hep-th/new' });
const listing = parseListing(dom.window.document, 'https://arxiv.org/list/hep-th/new');
const seeds = parseAtom(read('api/arxiv-api-seeds.xml'));

const items: [string, string][] = [
  ...listing.entries.map((e): [string, string] => [`paper:${e.paper.id}`, paperText(e.paper.title, e.paper.abstract)]),
  ...seeds.map((e): [string, string] => [`seed:${e.id}`, paperText(e.title, e.abstract)]),
  ['text:interests', PROFILE.interests],
  ['text:negativeInterests', PROFILE.negativeInterests],
];

const engine = await createEngine({ device: 'cpu' });
const t0 = Date.now();
const vectors = await engine.embed(items.map(([, t]) => t));
console.log(`embedded ${items.length} texts in ${Date.now() - t0} ms`);

const out = {
  model: EMBEDDING_MODEL.id,
  dtype: EMBEDDING_MODEL.dtype,
  dim: EMBEDDING_MODEL.dim,
  profile: PROFILE,
  vectors: Object.fromEntries(items.map(([key], i) => [key, Buffer.from(vectors[i]!.buffer).toString('base64')])),
};
const dir = new URL('../tests/fixtures/embeddings/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('hep-th-new.json', dir), JSON.stringify(out));
console.log('wrote tests/fixtures/embeddings/hep-th-new.json');
