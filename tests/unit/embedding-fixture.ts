/**
 * The hep-th/new fixture with real embeddings (tests/fixtures/embeddings, made by
 * scripts/make-embedding-fixture.ts) and seeds: fourteen classic holography papers, as if pasted
 * into "arXiv IDs of papers you like" (metadata from the arXiv API, tests/fixtures/api).
 */

import { parseAtom } from '../../src/parser/atom';
import { parseListing } from '../../src/parser/listing';
import type { Example } from '../../src/scoring/features';
import type { ListingItem } from '../../src/scoring/rank';
import { fromBase64, type Vec } from '../../src/scoring/vectors';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { Paper } from '../../src/types';
import { loadFixture, readFixture } from './helpers';

export interface EmbeddingFixture {
  papers: Paper[];
  vec: (key: string) => Vec;
  /** The pasted papers, at the default weight for pasted seeds. */
  seeds: Example[];
  interests: Vec;
  negativeInterests: Vec;
}

export function loadEmbeddingFixture(): EmbeddingFixture {
  const raw = JSON.parse(readFixture('embeddings/hep-th-new.json')) as { vectors: Record<string, string> };
  const vec = (key: string) => {
    const b64 = raw.vectors[key];
    if (!b64) throw new Error(`no embedding for ${key}`);
    return fromBase64(b64);
  };
  const { doc, url } = loadFixture('hepThNew');
  const papers = parseListing(doc, url).entries.map((e) => e.paper);
  const seeds: Example[] = parseAtom(readFixture('api/arxiv-api-seeds.xml')).map((e) => ({
    key: `arxiv:${e.id}`,
    vec: vec(`seed:${e.id}`),
    weight: DEFAULT_SETTINGS.seedWeights.pasted,
    label: `${e.id} (from your list)`,
  }));
  return { papers, vec, seeds, interests: vec('text:interests'), negativeInterests: vec('text:negativeInterests') };
}

export function listingItems(f: EmbeddingFixture, followed: Record<string, string[]> = {}): ListingItem[] {
  return f.papers.map((paper) => ({
    paper,
    vec: f.vec(`paper:${paper.id}`),
    context: { followedAuthors: followed[paper.id]?.length ?? 0, blocked: false, llm: null },
    followedNames: followed[paper.id] ?? [],
    blockedNames: [],
    llmReason: null,
  }));
}
