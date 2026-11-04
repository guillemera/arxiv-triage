import { describe, expect, it } from 'vitest';
import { BAI_PATTERN, newPerson, ORCID_PATTERN, parseAliases, type Person } from '../../src/authors/people';
import { matchesToVerify, rejectedMatches } from '../../src/authors/verify';
import { InspireClient, parseAuthor, parsePaperAuthors } from '../../src/sources/inspire';
import { EXPORT_FORMAT, ImportError, parseImport } from '../../src/storage/backup';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { Paper } from '../../src/types';
import { readFixture } from './helpers';

const paper = (id: string, authors: [string, string | null][]): Paper => ({
  id,
  version: 1,
  title: 't',
  abstract: null,
  authors: authors.map(([name, query]) => ({ name, query })),
  comments: null,
  journalRef: null,
  subjects: ['hep-th'],
  primarySubject: 'hep-th',
  listingCategory: 'hep-th',
  section: 'new',
  isCrossList: false,
  isReplacement: false,
});

const person = (name: string, over: Partial<Person> = {}): Person => ({ ...newPerson(name, 1), id: name, ...over });

describe('telling namesakes apart with INSPIRE', () => {
  // A made-up answer in INSPIRE's format: 2401.01234 (Doe, Smith, Ferreira) and 2402.05678 (Chen, Zhang, Zhang).
  const inspire = parsePaperAuthors(JSON.parse(readFixture('api/inspire-literature-authors.json')).hits.hits);
  const papers = [
    paper('2401.01234', [['Jane Doe', 'Doe, J'], ['Tom Smith', 'Smith, T'], ['Ana Ferreira', 'Ferreira, A']]),
    paper('2402.05678', [['Wei Chen', 'Chen, W'], ['Lin Zhang', 'Zhang, L'], ['Yan Zhang', 'Zhang, Y']]),
    paper('2402.99999', [['Wei Chen', 'Chen, W']]), // not in INSPIRE yet
  ];

  it('reads author identifiers from a literature search', () => {
    expect(inspire.get('2401.01234')).toEqual(expect.arrayContaining(['J.Doe.1', '0000-0002-1825-0097', 'A.Ferreira.1']));
  });

  it('keeps the right person, drops a namesake, and leaves unchecked matches alone', () => {
    const doe = person('Jane Doe', { inspireBai: 'J.Doe.1' });
    const otherChen = person('Wei Chen', { inspireBai: 'W.Chen.7' }); // someone else called Wei Chen
    const noIds = person('Tom Smith');
    const candidates = matchesToVerify(papers, [doe, otherChen, noIds]);
    expect([...candidates.keys()]).toEqual(['2401.01234', '2402.05678', '2402.99999']);
    expect(candidates.get('2401.01234')!.map((p) => p.id)).toEqual(['Jane Doe']); // Smith has no ids to check
    expect(rejectedMatches(candidates, inspire)).toEqual({ '2402.05678': ['Wei Chen'] });
  });

  it('accepts an ORCID as well as a BAI, case-insensitively', () => {
    const byOrcid = person('Yan Zhang', { orcid: '0000-0003-1415-9265' });
    const byBai = person('Yan Zhang 2', { aliases: ['Yan Zhang'], inspireBai: 'y.zhang.40' });
    expect(rejectedMatches(matchesToVerify(papers, [byOrcid, byBai]), inspire)).toEqual({});
  });
});

describe('INSPIRE author search', () => {
  const fixture = JSON.parse(readFixture('api/inspire-authors-search.json'));

  it('parses identifiers and the current affiliation', () => {
    expect(parseAuthor(fixture.hits.hits[0].metadata)).toEqual({
      recid: 1000001,
      name: 'Jane Doe', // INSPIRE's preferred display name
      bai: 'J.Doe.1',
      orcid: '0000-0002-1825-0097',
      affiliation: 'Example U.',
    });
  });

  it('asks the authors endpoint by name', async () => {
    const urls: string[] = [];
    const client = new InspireClient(async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(fixture));
    });
    const found = await client.searchAuthors('Jane Doe');
    expect(found[0]!.bai).toBe('J.Doe.1');
    expect(urls[0]).toContain('/api/authors?q=Jane%20Doe');
  });
});

describe('author fields', () => {
  it('validates identifiers and splits aliases', () => {
    expect(BAI_PATTERN.test('J.A.Doe.1')).toBe(true);
    expect(BAI_PATTERN.test('Lucia.Ferrer.Ibanez.1')).toBe(true);
    expect(BAI_PATTERN.test('Doe')).toBe(false);
    expect(ORCID_PATTERN.test('0000-0002-1825-0097')).toBe(true);
    expect(ORCID_PATTERN.test('0000-0002-1825')).toBe(false);
    expect(parseAliases('J. Doe; Doe J.,  J. Doe ,')).toEqual(['J. Doe', 'Doe J.']);
  });
});

describe('import validation', () => {
  const good = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: '2026-10-25T10:00:00.000Z',
    settings: { ...DEFAULT_SETTINGS, threshold: 0.7, interests: 'holography' },
    people: { followed: [{ id: 'p1', name: 'Jane Doe', aliases: ['J. Doe'], addedAt: 1 }], blocked: [] },
    labels: [
      { id: '2610.27097', paper: { id: '2610.27097', title: 'T', authors: [] }, explicit: 1, explicitAt: 5, signals: { expand: 4 } },
    ],
    seeds: [{ key: 'arxiv:2401.01234', source: 'own', arxivId: '2401.01234', inspireId: 1, title: 'A paper', abstract: null, label: 'your paper', addedAt: 1 }],
    seedSummaries: { own: { source: 'own', count: 1, updatedAt: 1 } },
    modelState: null,
    usage: [],
  };

  it('accepts its own export', () => {
    const { data, skipped } = parseImport(JSON.parse(JSON.stringify(good)));
    expect(skipped).toBe(0);
    expect(data.settings.threshold).toBe(0.7);
    expect(data.people.followed[0]).toMatchObject({ name: 'Jane Doe', aliases: ['J. Doe'] });
    expect(data.labels[0]).toMatchObject({ id: '2610.27097', explicit: 1, signals: { expand: 4 } });
    expect(data.seeds).toHaveLength(1);
    expect(data.apiKeys).toBeUndefined();
  });

  it('rejects other files and newer versions', () => {
    expect(() => parseImport({ hello: 'world' })).toThrow(ImportError);
    expect(() => parseImport([1, 2, 3])).toThrow('not an arXiv Triage export');
    expect(() => parseImport({ ...good, version: 99 })).toThrow('newer version');
  });

  it('skips malformed records, normalises settings and keeps string keys only', () => {
    const { data, skipped } = parseImport({
      ...good,
      settings: { threshold: 7, sortByScore: 'yes' },
      people: { followed: [{ name: 'no id' }, { id: 'p2', name: 'Ok', aliases: [3, 'x'] }], blocked: 'nope' },
      labels: [{ id: 'x' }, ...good.labels],
      seeds: [{ key: 'k', source: 'elsewhere', title: 't' }],
      apiKeys: { openai: 'sk-1', bad: 5 },
    });
    expect(skipped).toBe(3);
    expect(data.settings).toMatchObject({ threshold: 1, sortByScore: false });
    expect(data.people.followed).toEqual([expect.objectContaining({ id: 'p2', aliases: ['x'] })]);
    expect(data.people.blocked).toEqual([]);
    expect(data.labels).toHaveLength(1);
    expect(data.seeds).toEqual([]);
    expect(data.apiKeys).toEqual({ openai: 'sk-1' });
  });
});
