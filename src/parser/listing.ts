/**
 * Parser for arXiv listing pages (`/list/<cat>/new`, `/recent`, `/pastweek`).
 *
 * This is the only module that knows arXiv's listing markup (see docs/arxiv-dom.md). It reads the
 * DOM and never modifies it. Anything unexpected at page level throws `ListingParseError`, so the
 * caller can leave the page untouched; a malformed single entry is skipped and counted instead.
 */

import type { AuthorName, Paper, SectionKind } from '../types';
import { extractText } from './text';
import { parseListingUrl, type ListingKind } from './url';

export class ListingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingParseError';
  }
}

export interface ParsedAuthor extends AuthorName {
  el: HTMLAnchorElement;
}

export interface ParsedEntry {
  paper: Paper;
  /** Position number shown by arXiv, e.g. 1 for "[1]". */
  index: number | null;
  dt: HTMLElement;
  dd: HTMLElement;
  titleEl: HTMLElement;
  authorsEl: HTMLElement;
  authors: ParsedAuthor[];
  abstractEl: HTMLElement | null;
  links: { abs: string; pdf: HTMLAnchorElement | null; html: HTMLAnchorElement | null };
}

export interface ParsedSection {
  kind: SectionKind;
  heading: HTMLElement | null;
  headingText: string;
  dl: HTMLDListElement;
  entries: ParsedEntry[];
}

export interface ParsedListing {
  kind: ListingKind;
  category: string;
  root: HTMLElement;
  sections: ParsedSection[];
  entries: ParsedEntry[];
  /** True when the page carries abstracts (the `/new` pages do, `/recent` does not). */
  hasAbstracts: boolean;
  /** Number of entries that could not be parsed and were left alone. */
  skipped: number;
}

const ID_PATTERN = /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/;
const ABS_HREF = /\/abs\/([^?#]+?)(?:v(\d+))?\/?(?:[?#].*)?$/;
const VERSIONED = /\/(?:html|pdf|abs)\/([^?#/]+?(?:\/\d{7})?)v(\d+)/;
const SUBJECT_CODE = /\(([a-z-]+(?:\.[A-Za-z-]+)?)\)/g;

/** Fraction of entries that may fail before the whole page counts as unparseable. */
const MAX_SKIPPED_FRACTION = 0.2;

function sectionKind(headingText: string): SectionKind {
  const t = headingText.trim().toLowerCase();
  if (t.startsWith('new submissions')) return 'new';
  if (t.startsWith('cross')) return 'cross';
  if (t.startsWith('replacement')) return 'replacement';
  if (/^(mon|tue|wed|thu|fri|sat|sun)\b/.test(t)) return 'day';
  return 'unknown';
}

function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function parseAuthors(authorsEl: HTMLElement): ParsedAuthor[] {
  const out: ParsedAuthor[] = [];
  for (const a of Array.from(authorsEl.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (a.hasAttribute('data-axt')) continue;
    const name = cleanText(a.textContent);
    if (!name) continue;
    let query: string | null = null;
    try {
      query = new URL(a.getAttribute('href') ?? '', 'https://arxiv.org').searchParams.get('query');
    } catch {
      query = null;
    }
    out.push({ name, query: query ? cleanText(query) : null, el: a });
  }
  return out;
}

function parseSubjects(subjectsEl: HTMLElement | null): { subjects: string[]; primary: string | null } {
  if (!subjectsEl) return { subjects: [], primary: null };
  const primaryEl = subjectsEl.querySelector('.primary-subject');
  const primary = primaryEl ? ([...(primaryEl.textContent ?? '').matchAll(SUBJECT_CODE)][0]?.[1] ?? null) : null;
  const subjects: string[] = [];
  for (const m of extractText(subjectsEl).matchAll(SUBJECT_CODE)) {
    if (!subjects.includes(m[1]!)) subjects.push(m[1]!);
  }
  if (primary) return { subjects: [primary, ...subjects.filter((s) => s !== primary)], primary };
  return { subjects, primary: subjects[0] ?? null };
}

/** True when `subject` belongs to the listing `category` (an archive like `astro-ph` covers `astro-ph.CO`). */
function inCategory(subject: string, category: string): boolean {
  return subject === category || subject.startsWith(category + '.');
}

function parseEntry(
  dt: HTMLElement,
  dd: HTMLElement,
  section: SectionKind,
  category: string,
): ParsedEntry | null {
  const absLink =
    dt.querySelector<HTMLAnchorElement>('a[title="Abstract"]') ??
    dt.querySelector<HTMLAnchorElement>('a[href*="/abs/"]');
  if (!absLink) return null;
  const href = absLink.getAttribute('href') ?? '';
  const hrefMatch = ABS_HREF.exec(href);
  const id = (absLink.id && ID_PATTERN.test(absLink.id) ? absLink.id : hrefMatch?.[1]) ?? '';
  if (!ID_PATTERN.test(id)) return null;

  const titleEl = dd.querySelector<HTMLElement>('.list-title');
  const authorsEl = dd.querySelector<HTMLElement>('.list-authors');
  if (!titleEl || !authorsEl) return null;
  const title = extractText(titleEl);
  if (!title) return null;

  const pdf = dt.querySelector<HTMLAnchorElement>('a[title="Download PDF"], a[href*="/pdf/"]');
  const html = dt.querySelector<HTMLAnchorElement>('a[title="View HTML"], a[href*="/html/"]');
  let version: number | null = hrefMatch?.[2] ? Number(hrefMatch[2]) : null;
  for (const a of [html, pdf]) {
    const m = a ? VERSIONED.exec(a.getAttribute('href') ?? '') : null;
    if (version === null && m) version = Number(m[2]);
  }

  // Bare text nodes of the dt carry "(cross-list from X)" or "(replaced)".
  const dtNote = Array.from(dt.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.nodeValue ?? '')
    .join(' ');
  const crossFrom = /\(cross-list from ([^)]+)\)/.exec(dtNote)?.[1]?.trim() ?? null;
  const replacedNote = /\(replaced\b/.test(dtNote);

  const { subjects, primary } = parseSubjects(dd.querySelector<HTMLElement>('.list-subjects'));
  const abstractEl =
    dd.querySelector<HTMLElement>('.meta > p.mathjax:not([data-axt])') ??
    dd.querySelector<HTMLElement>('p.mathjax:not([data-axt])');
  const commentsEl = dd.querySelector<HTMLElement>('.list-comments');
  const journalEl = dd.querySelector<HTMLElement>('.list-journal-ref');
  const authors = parseAuthors(authorsEl);
  const indexText = dt.querySelector('a[name^="item"]')?.textContent ?? '';
  const indexMatch = /\[(\d+)\]/.exec(indexText);

  const isReplacement = section === 'replacement' || replacedNote;
  const isCrossList = crossFrom !== null || section === 'cross' || (primary !== null && !inCategory(primary, category));

  const paper: Paper = {
    id,
    version,
    title,
    abstract: abstractEl ? extractText(abstractEl) || null : null,
    authors: authors.map(({ name, query }) => ({ name, query })),
    comments: commentsEl ? extractText(commentsEl) || null : null,
    journalRef: journalEl ? extractText(journalEl) || null : null,
    subjects,
    primarySubject: primary,
    listingCategory: category,
    section,
    isCrossList,
    isReplacement,
  };

  return {
    paper,
    index: indexMatch ? Number(indexMatch[1]) : null,
    dt,
    dd,
    titleEl,
    authorsEl,
    authors,
    abstractEl,
    links: { abs: `https://arxiv.org/abs/${id}`, pdf, html },
  };
}

function findListDls(root: HTMLElement): HTMLDListElement[] {
  const byId = Array.from(root.querySelectorAll<HTMLDListElement>('dl#articles'));
  if (byId.length) return byId;
  return Array.from(root.querySelectorAll<HTMLDListElement>('dl')).filter((dl) => dl.querySelector(':scope > dt'));
}

export function parseListing(doc: Document, url: string | URL): ParsedListing {
  const parsedUrl = parseListingUrl(url);
  if (!parsedUrl) throw new ListingParseError(`not a listing URL: ${String(url)}`);
  const { kind, category } = parsedUrl;

  const root = doc.getElementById('dlpage');
  if (!root) throw new ListingParseError('no #dlpage element');
  const dls = findListDls(root);
  if (!dls.length) throw new ListingParseError('no listing <dl> found');

  const sections: ParsedSection[] = [];
  let skipped = 0;
  let total = 0;
  for (const dl of dls) {
    const heading = dl.querySelector<HTMLElement>(':scope > h3') ?? null;
    const headingText = cleanText(heading?.textContent);
    const kindOfSection = kind === 'new' ? sectionKind(headingText) : 'day';
    const entries: ParsedEntry[] = [];
    for (const dt of Array.from(dl.querySelectorAll<HTMLElement>(':scope > dt'))) {
      total++;
      let dd = dt.nextElementSibling;
      while (dd && dd.tagName !== 'DD' && dd.tagName !== 'DT') dd = dd.nextElementSibling;
      const entry = dd && dd.tagName === 'DD' ? parseEntry(dt, dd as HTMLElement, kindOfSection, category) : null;
      if (entry) entries.push(entry);
      else skipped++;
    }
    sections.push({ kind: kindOfSection, heading, headingText, dl, entries });
  }

  const entries = sections.flatMap((s) => s.entries);
  if (!entries.length) throw new ListingParseError('no entries could be parsed');
  if (skipped / total > MAX_SKIPPED_FRACTION) {
    throw new ListingParseError(`${skipped} of ${total} entries could not be parsed`);
  }
  const hasAbstracts = entries.some((e) => e.abstractEl !== null);
  return { kind, category, root, sections, entries, hasAbstracts, skipped };
}
