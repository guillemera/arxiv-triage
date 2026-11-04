/**
 * Resolving name collisions with INSPIRE identifiers (spec §3).
 *
 * Followed and blocked authors are matched by normalised name, which cannot tell two "J. Smith"s
 * apart. When a person has an INSPIRE BAI or ORCID attached, each name match is checked against
 * the identifiers INSPIRE lists for that paper's authors: if INSPIRE knows the paper and none of
 * its authors carries the person's identifier, the match is a namesake and is dropped. Papers
 * INSPIRE has not indexed yet keep their name match.
 */

import type { Paper } from '../types';
import { PersonMatcher, type Person } from './people';

/** Identifiers of a person, normalised for comparison. */
function idsOf(p: Person): string[] {
  return [p.inspireBai, p.orcid].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim().toLowerCase());
}

/** Name matches that can be checked: paper ID → people with identifiers who matched by name. */
export function matchesToVerify(papers: readonly Paper[], people: readonly Person[]): Map<string, Person[]> {
  const withIds = people.filter((p) => idsOf(p).length);
  const out = new Map<string, Person[]>();
  if (!withIds.length) return out;
  const matchers = withIds.map((p) => ({ p, m: new PersonMatcher([p]) }));
  for (const paper of papers) {
    const hits = matchers.filter(({ m }) => paper.authors.some((a) => m.match(a))).map(({ p }) => p);
    if (hits.length) out.set(paper.id, hits);
  }
  return out;
}

/**
 * Paper ID → IDs of the people whose name match is a namesake. `inspire` maps each paper INSPIRE
 * knows to its authors' identifiers; papers missing from it are not judged.
 */
export function rejectedMatches(
  candidates: ReadonlyMap<string, readonly Person[]>,
  inspire: ReadonlyMap<string, readonly string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [paperId, persons] of candidates) {
    const authorIds = inspire.get(paperId);
    if (!authorIds) continue;
    const known = new Set(authorIds.map((x) => x.toLowerCase()));
    const rejected = persons.filter((p) => !idsOf(p).some((id) => known.has(id))).map((p) => p.id);
    if (rejected.length) out[paperId] = rejected;
  }
  return out;
}

/** People minus those rejected for this paper. */
export function verifiedPeople(people: readonly Person[], rejected: readonly string[] | undefined): Person[] {
  return rejected?.length ? people.filter((p) => !rejected.includes(p.id)) : [...people];
}
