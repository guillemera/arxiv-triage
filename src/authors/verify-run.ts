/** Background side of the collision check: INSPIRE look-ups with a cache. */

import { InspireClient } from '../sources/inspire';
import * as db from '../storage/db';
import type { Paper } from '../types';
import type { People } from './people';
import { matchesToVerify, rejectedMatches } from './verify';

/** Papers not indexed yet are asked about again after this long; author lists are kept. */
const RETRY_MISSING_MS = 12 * 3_600_000;
/** A look-up INSPIRE has not answered by then is abandoned. */
const LOOKUP_TIMEOUT_MS = 30_000;
/** After INSPIRE failed or timed out, it is not asked again for this long. */
const RETRY_FAILED_MS = 10 * 60_000;

let failedAt = 0;

interface CachedAuthors {
  ids: string[] | null;
  at: number;
}

const cacheKey = (id: string) => `inspire-authors:${id}`;

/**
 * Paper ID → IDs of followed/blocked people whose name match on that paper is a namesake. Never
 * throws: if INSPIRE cannot be reached, every name match stands. It may take up to
 * `LOOKUP_TIMEOUT_MS`, so callers that cannot wait should race it (the answer is cached either way).
 */
export async function verifyMatches(papers: readonly Paper[], people: People, inspire = new InspireClient()): Promise<Record<string, string[]>> {
  const candidates = matchesToVerify(papers, [...people.followed, ...people.blocked]);
  if (!candidates.size) return {};
  const known = new Map<string, string[]>();
  try {
    const ids = [...candidates.keys()];
    const now = Date.now();
    const cached = (await db.getMany('meta', ids.map(cacheKey))) as (CachedAuthors | undefined)[];
    const ask: string[] = [];
    ids.forEach((id, i) => {
      const c = cached[i];
      if (c?.ids) known.set(id, c.ids);
      else if (!c || now - c.at > RETRY_MISSING_MS) ask.push(id);
    });
    if (ask.length && now - failedAt > RETRY_FAILED_MS) {
      const found = await inspire.authorsOfPapers(ask, AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
      await db.putMany(
        'meta',
        ask.map((id): CachedAuthors => ({ ids: found.get(id) ?? null, at: now })),
        ask.map(cacheKey),
      );
      for (const [id, a] of found) known.set(id, a);
    }
  } catch {
    // Offline, INSPIRE down or too slow: keep the name matches, and do not ask again for a while.
    failedAt = Date.now();
  }
  return rejectedMatches(candidates, known);
}
