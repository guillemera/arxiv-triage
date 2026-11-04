/**
 * Cold-start seeds: papers that count as positive examples before any feedback (docs/PLAN.md §6).
 * Each source is fetched as a whole and replaces its previous seeds.
 */

import { nameKeys } from '../authors/normalize';
import type { Person } from '../authors/people';
import * as db from '../storage/db';
import type { SeedRecord, SeedSource } from '../storage/db';
import { ArxivApi } from './arxiv-api';
import { InspireClient, parseAuthorRef, type InspireAuthor, type InspirePaper } from './inspire';

export interface SeedSummary {
  source: SeedSource;
  count: number;
  updatedAt: number;
  detail?: string;
}

const ARXIV_ID = /\b(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?\b/g;

export function parseIdList(text: string): string[] {
  return [...new Set([...text.matchAll(ARXIV_ID)].map((m) => m[1]!))];
}

function exampleKey(arxivId: string | null, inspireId: number | null): string {
  return arxivId ? `arxiv:${arxivId}` : `inspire:${inspireId}`;
}

function fromInspire(p: InspirePaper, source: SeedSource, label: (id: string) => string, now: number): SeedRecord {
  return {
    key: exampleKey(p.arxivId, p.inspireId),
    source,
    arxivId: p.arxivId,
    inspireId: p.inspireId,
    title: p.title,
    abstract: p.abstract,
    label: label(p.arxivId ?? `“${p.title.slice(0, 50)}${p.title.length > 50 ? '…' : ''}”`),
    addedAt: now,
  };
}

async function replaceSource(source: SeedSource, seeds: SeedRecord[], detail?: string): Promise<SeedSummary> {
  await db.deleteWhere('seeds', 'source', source);
  // Papers without any text can't be embedded; drop them.
  await db.putMany('seeds', seeds.filter((s) => s.title));
  const summary: SeedSummary = { source, count: seeds.length, updatedAt: Date.now(), detail };
  await db.put('meta', summary, `seeds:${source}`);
  return summary;
}

export async function seedSummaries(): Promise<Partial<Record<SeedSource, SeedSummary>>> {
  const sources: SeedSource[] = ['own', 'refs', 'followed', 'pasted'];
  const got = await db.getMany('meta', sources.map((s) => `seeds:${s}`));
  return Object.fromEntries(sources.flatMap((s, i) => (got[i] ? [[s, got[i] as SeedSummary]] : [])));
}

/** "My papers" (and optionally their references) from an INSPIRE profile. */
export async function seedFromInspire(
  profile: string,
  useReferences: boolean,
  inspire = new InspireClient(),
): Promise<{ author: InspireAuthor; own: SeedSummary; refs: SeedSummary | null }> {
  const ref = parseAuthorRef(profile);
  if (!ref) throw new Error('Enter an INSPIRE profile URL, record number, BAI or ORCID.');
  const author = await inspire.author(ref);
  const papers = await inspire.papersBy(author.recid);
  const now = Date.now();
  const own = await replaceSource(
    'own',
    papers.map((p) => fromInspire(p, 'own', (id) => `your paper ${id}`, now)),
    author.name,
  );
  let refs: SeedSummary | null = null;
  if (useReferences && papers.length) {
    const ownKeys = new Set(papers.map((p) => p.inspireId));
    const cited = (await inspire.referencesOf(papers.map((p) => p.inspireId))).filter((p) => !ownKeys.has(p.inspireId));
    refs = await replaceSource(
      'refs',
      cited.map((p) => fromInspire(p, 'refs', (id) => `${id} (cited by your paper)`, now)),
      author.name,
    );
  } else {
    await replaceSource('refs', []);
  }
  return { author, own, refs };
}

/** A pasted list of arXiv IDs, with titles and abstracts from the arXiv API. */
export async function seedFromIds(text: string, api = new ArxivApi()): Promise<SeedSummary> {
  const ids = parseIdList(text);
  const entries = await api.byIds(ids);
  const now = Date.now();
  return replaceSource(
    'pasted',
    entries.map((e) => ({
      key: `arxiv:${e.id}`,
      source: 'pasted' as const,
      arxivId: e.id,
      inspireId: null,
      title: e.title,
      abstract: e.abstract,
      label: `${e.id} (from your list)`,
      addedAt: now,
    })),
  );
}

/**
 * Recent papers by followed authors: from INSPIRE when the author has a BAI, otherwise from
 * arXiv's author search (rate-limited, so this takes about 3 s per author).
 */
export async function seedFromFollowed(
  followed: readonly Person[],
  perAuthor = 8,
  onProgress?: (done: number, total: number) => void,
  inspire = new InspireClient(),
  api = new ArxivApi(),
): Promise<SeedSummary> {
  const seeds = new Map<string, SeedRecord>();
  const now = Date.now();
  let done = 0;
  for (const person of followed) {
    const label = (id: string) => `${id} by ${person.name}`;
    try {
      if (person.inspireBai) {
        for (const p of await inspire.recentBy(person.inspireBai, perAuthor)) {
          const s = fromInspire(p, 'followed', label, now);
          seeds.set(s.key, s);
        }
      } else {
        const key = nameKeys(person.name)[0];
        if (key) {
          const surname = person.name.includes(',') ? person.name.split(',')[0]!.trim() : person.name.trim().split(/\s+/).slice(-key.surname.split(' ').length).join(' ');
          for (const e of await api.recentByAuthor(surname, key.initials[0]?.toUpperCase() ?? '', perAuthor)) {
            seeds.set(`arxiv:${e.id}`, {
              key: `arxiv:${e.id}`,
              source: 'followed',
              arxivId: e.id,
              inspireId: null,
              title: e.title,
              abstract: e.abstract,
              label: label(e.id),
              addedAt: now,
            });
          }
        }
      }
    } catch {
      // One author failing (network, unknown name) should not lose the others.
    }
    onProgress?.(++done, followed.length);
  }
  return replaceSource('followed', [...seeds.values()], `${followed.length} authors`);
}
