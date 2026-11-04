import type { AuthorName } from '../types';
import { keysMatch, nameKeys, type NameKey } from './normalize';

/** A followed or blocked author. */
export interface Person {
  id: string;
  name: string;
  aliases: string[];
  /** INSPIRE author identifier, e.g. "J.Doe.1". With an ORCID, it tells namesakes apart. */
  inspireBai?: string;
  orcid?: string;
  /** INSPIRE author record number and current affiliation, when linked from INSPIRE. */
  inspireRecid?: number;
  affiliation?: string;
  addedAt: number;
}

export const BAI_PATTERN = /^[A-Za-z][\w'-]*(\.[\w'-]+)*\.\d+$/;
export const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** Splits a comma- or semicolon-separated list of aliases. */
export function parseAliases(text: string): string[] {
  return [...new Set(text.split(/[;,]/).map((s) => s.trim()).filter(Boolean))];
}

export interface People {
  followed: Person[];
  blocked: Person[];
}

export const EMPTY_PEOPLE: People = { followed: [], blocked: [] };

export function newPerson(name: string, now = Date.now()): Person {
  return { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), aliases: [], addedAt: now };
}

function authorKeys(a: AuthorName): NameKey[] {
  const keys = nameKeys(a.name);
  if (a.query) for (const k of nameKeys(a.query)) if (!keys.some((x) => x.surname === k.surname && x.initials === k.initials)) keys.push(k);
  return keys;
}

/** Matches listing authors against a list of people by normalised name, aliases included. */
export class PersonMatcher {
  private readonly entries: { person: Person; keys: NameKey[] }[];

  constructor(people: readonly Person[]) {
    this.entries = people.map((person) => ({
      person,
      keys: [person.name, ...person.aliases].flatMap((n) => nameKeys(n)),
    }));
  }

  /** First person matching the author, skipping those in `exclude` (namesakes found via INSPIRE). */
  match(author: AuthorName, exclude?: readonly string[]): Person | null {
    if (!this.entries.length) return null;
    const keys = authorKeys(author);
    return this.entries.find((e) => !exclude?.includes(e.person.id) && keysMatch(keys, e.keys))?.person ?? null;
  }
}
